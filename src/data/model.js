/**
 * Pure data-model helpers shared by future API and UI adapters.
 *
 * This module deliberately has no React, browser, storage, or network
 * dependencies so it can be exercised with Node's built-in test runner.
 */

export const DATASET_STATE = Object.freeze({
  LOADING: "loading",
  FRESH: "fresh",
  STALE: "stale",
  PARTIAL: "partial",
  EMPTY: "empty",
  ERROR: "error",
});

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Resolve the local-only UI auth bypass. The Vite development flag, an
 * explicit opt-in, and a loopback browser hostname must all agree.
 */
export function resolveLocalAuthBypass({ isDev = false, flag = "", hostname = "" } = {}) {
  return Boolean(
    isDev
    && flag === "true"
    && LOOPBACK_HOSTNAMES.has(String(hostname).trim().toLowerCase()),
  );
}

export function shouldRequireAuth({ isProtected = false, hasUser = false, localBypass = false } = {}) {
  return Boolean(isProtected && !hasUser && !localBypass);
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectionSize(value) {
  if (value == null) return 0;
  if (Array.isArray(value) || typeof value === "string") return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  if (isRecord(value)) return Object.keys(value).length;
  return 1;
}

function toTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function errorMessage(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || value.name;
  if (isRecord(value)) {
    return value.message || value.msg || value.reason || value.code || "request_failed";
  }
  return String(value);
}

/**
 * Resolve the single display state of a dataset.
 *
 * Retained data wins over loading/error so stale-while-revalidate callers do
 * not replace useful content with a spinner or a fatal error. An error with
 * retained data is represented as partial; an error without data is error.
 */
export function deriveDatasetState({
  data = null,
  count,
  loading = false,
  error = null,
  partial = false,
  asOf = null,
  staleAfterMs = Infinity,
  now = Date.now(),
} = {}) {
  const resolvedCount = Number.isInteger(count) && count >= 0
    ? count
    : collectionSize(data);
  const hasData = resolvedCount > 0;

  if (!hasData) {
    if (loading) return DATASET_STATE.LOADING;
    if (error) return DATASET_STATE.ERROR;
    return DATASET_STATE.EMPTY;
  }

  if (partial || error) return DATASET_STATE.PARTIAL;

  if (Number.isFinite(staleAfterMs)) {
    const timestamp = toTimestamp(asOf);
    const currentTime = toTimestamp(now);
    if (timestamp === null || currentTime === null || currentTime - timestamp > staleAfterMs) {
      return DATASET_STATE.STALE;
    }
  }

  return DATASET_STATE.FRESH;
}

function inferredCount(data) {
  return collectionSize(data);
}

/**
 * Normalize legacy and v2 API payloads into one predictable envelope.
 * Raw arrays/values are accepted to make adapters tolerant during migration.
 */
export function normalizeApiEnvelope(payload, { defaultData = [] } = {}) {
  const envelope = isRecord(payload);
  const hasDataField = envelope && hasOwn(payload, "data");
  const failedEnvelope = envelope && (payload.ok === false || Boolean(payload.error));
  const rawData = hasDataField ? payload.data : failedEnvelope ? defaultData : payload;
  const data = rawData == null ? defaultData : rawData;
  const meta = envelope && isRecord(payload.meta) ? payload.meta : {};
  const source = envelope
    ? (payload.source ?? meta.source ?? "unknown")
    : "raw";

  let error = null;
  if (payload == null) {
    error = "empty_response";
  } else if (envelope && payload.ok === false) {
    error = errorMessage(payload.error || payload.message || payload.msg) || "request_failed";
  } else if (envelope && payload.error) {
    error = errorMessage(payload.error);
  }

  const declaredCount = envelope ? Number(payload.count ?? meta.count) : NaN;
  const count = Number.isInteger(declaredCount) && declaredCount >= 0
    ? declaredCount
    : inferredCount(data);

  return {
    ok: error === null,
    data,
    count,
    source,
    partial: Boolean(
      (envelope && payload.partial) || meta.partial || source === "partial"
    ),
    error,
    asOf: envelope
      ? (payload.as_of ?? payload.asOf ?? payload.generated_at ?? meta.as_of ?? meta.asOf ?? null)
      : null,
    runId: envelope ? (payload.run_id ?? payload.runId ?? meta.run_id ?? meta.runId ?? null) : null,
    schemaVersion: envelope
      ? (payload.schema_version ?? payload.schemaVersion ?? meta.schema_version ?? meta.schemaVersion ?? null)
      : null,
  };
}

/** Normalize an object-valued API envelope and reject metadata-only/empty data. */
export function normalizeObjectDataset(payload, { fields = [] } = {}) {
  const envelope = normalizeApiEnvelope(payload, { defaultData: {} });
  const record = isRecord(envelope.data) ? envelope.data : {};
  const candidates = fields.length ? fields : Object.keys(record);
  const meaningfulFieldCount = candidates.reduce((count, key) => {
    const value = record[key];
    if (Array.isArray(value)) return count + (value.length > 0 ? 1 : 0);
    if (isRecord(value)) return count + (Object.keys(value).length > 0 ? 1 : 0);
    return count + (value != null && value !== "" ? 1 : 0);
  }, 0);
  const explicitStatus = isRecord(payload) ? payload.status : null;
  const hasData = meaningfulFieldCount > 0;
  const status = !hasData
    ? (envelope.error ? DATASET_STATE.ERROR : DATASET_STATE.EMPTY)
    : explicitStatus === "stale"
      ? DATASET_STATE.STALE
      : explicitStatus === "partial" || envelope.partial || explicitStatus === "empty"
        ? DATASET_STATE.PARTIAL
        : DATASET_STATE.FRESH;

  return {
    status,
    data: hasData ? record : null,
    source: envelope.source,
    asOf: envelope.asOf,
    error: envelope.error,
    meaningfulFieldCount,
  };
}

function selectorFunction(selector) {
  if (typeof selector === "function") return selector;
  if (typeof selector === "string") return value => value?.[selector];
  return value => value;
}

/**
 * Average only actual finite numbers. Numeric strings, null, NaN, and
 * infinities do not silently enter the sample.
 */
export function finiteAverage(values, selector) {
  const rows = Array.isArray(values) ? values : [];
  const select = selectorFunction(selector);
  let sum = 0;
  let sampleCount = 0;

  rows.forEach((row, index) => {
    const value = select(row, index);
    if (!Number.isFinite(value)) return;
    sum += value;
    sampleCount += 1;
  });

  return {
    average: sampleCount > 0 ? sum / sampleCount : null,
    sampleCount,
    totalCount: rows.length,
    missingCount: rows.length - sampleCount,
  };
}

function toFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/%$/, "").replaceAll(",", "").trim();
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return null;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/** Format a percentage without ever producing malformed strings like "+-1%". */
export function formatPercent(value, {
  digits = 2,
  showPlus = true,
  unavailable = "—",
} = {}) {
  const number = toFiniteNumber(value);
  if (number === null) return unavailable;

  const safeDigits = Math.max(0, Math.min(20, Number.isInteger(digits) ? digits : 2));
  const normalized = Object.is(number, -0) ? 0 : number;
  const sign = normalized < 0 ? "-" : normalized > 0 && showPlus ? "+" : "";
  return `${sign}${Math.abs(normalized).toFixed(safeDigits)}%`;
}

function defaultCompare(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function isMissingSortValue(value) {
  return value == null || (typeof value === "number" && !Number.isFinite(value));
}

/**
 * Build a comparator whose missing values remain last in both sort directions.
 */
export function nullLastComparator(selector, direction = "asc", compare = defaultCompare) {
  const select = selectorFunction(selector);
  const multiplier = direction === "desc" ? -1 : 1;

  return (left, right) => {
    const leftValue = select(left);
    const rightValue = select(right);
    const leftMissing = isMissingSortValue(leftValue);
    const rightMissing = isMissingSortValue(rightValue);

    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return multiplier * compare(leftValue, rightValue);
  };
}

function dailyLimitModel(value) {
  if (value == null) return { text: null, kind: "unknown", amount: null };
  const text = String(value).trim();
  if (!text) return { text: null, kind: "unknown", amount: null };

  const lower = text.toLowerCase();
  if (/暂停(?:申购|认购)|停止申购|关闭申购|不可申购|禁止申购/.test(text)
    || /suspend|closed|unavailable/.test(lower)) {
    return { text, kind: "suspended", amount: null };
  }
  if (/不限|无限/.test(text) || /unlimited|no\s*limit/.test(lower)) {
    return { text, kind: "unlimited", amount: null };
  }

  const numeric = text.replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  if (numeric) {
    const amount = Number(numeric[0]);
    if (Number.isFinite(amount)) return { text, kind: "limited", amount };
  }
  if (/暂停大额|限大额|限制大额|限额|大额申购限制/.test(text)) {
    return { text, kind: "limited", amount: null };
  }
  return { text, kind: "unknown", amount: null };
}

/**
 * Normalize subscription status and its daily-limit context.
 * Accepts either (status, dailyLimit) or a fund-like object.
 */
export function normalizeSubscriptionStatus(statusOrFund, dailyLimit) {
  const fund = isRecord(statusOrFund) ? statusOrFund : null;
  const rawStatus = fund
    ? (fund.subscription_status ?? fund.buy_status ?? fund.status)
    : statusOrFund;
  const rawLimit = fund ? (fund.daily_limit ?? fund.dailyLimit) : dailyLimit;
  const statusText = rawStatus == null ? "" : String(rawStatus).trim();
  const lower = statusText.toLowerCase();
  const limit = dailyLimitModel(rawLimit);

  const explicitSuspended = /暂停(?:申购|认购)|停止申购|关闭申购|不可申购|禁止申购/.test(statusText)
    || /^(suspended|closed|unavailable|pause|paused)$/.test(lower);
  const explicitLimited = /暂停大额|限大额|限制大额|限额|大额申购限制/.test(statusText)
    || lower === "limited";
  const explicitOpen = /开放|可申购|正常申购/.test(statusText)
    || /^(open|available|enabled)$/.test(lower);

  let status = "unknown";
  if (explicitSuspended || limit.kind === "suspended") {
    status = "suspended";
  } else if (explicitLimited || limit.kind === "limited") {
    status = "limited";
  } else if (explicitOpen || limit.kind === "unlimited") {
    status = "open";
  }

  return {
    status,
    label: status === "open" ? "可申购" : status === "limited" ? "限额申购" : status === "suspended" ? "暂停申购" : "状态未知",
    canSubscribe: status === "open" || status === "limited",
    isOpen: status === "open" || status === "limited",
    isSuspended: status === "suspended",
    isLimited: status === "limited",
    isUnlimited: status === "open" && limit.kind === "unlimited",
    dailyLimit: limit.text,
    limitAmount: limit.amount,
  };
}

/**
 * Produce a semantic premium model. Negative values are discounts rather than
 * malformed or misleading negative "premiums".
 */
export function premiumDisplayModel(value, {
  digits = 2,
  warningAt = 1.5,
  dangerAt = 3,
} = {}) {
  const premium = toFiniteNumber(value);
  if (premium === null) {
    return {
      available: false,
      value: null,
      kind: "unavailable",
      severity: "unavailable",
      label: "不可用",
      percentText: "—",
      signedPercentText: "—",
      displayText: "—",
    };
  }

  const normalized = Object.is(premium, -0) ? 0 : premium;
  const warn = Number.isFinite(warningAt) ? Math.max(0, warningAt) : 1.5;
  const danger = Number.isFinite(dangerAt) ? Math.max(warn, dangerAt) : Math.max(warn, 3);
  const absoluteText = formatPercent(Math.abs(normalized), { digits, showPlus: false });
  const signedPercentText = formatPercent(normalized, { digits, showPlus: false });

  if (normalized < 0) {
    return {
      available: true,
      value: normalized,
      kind: "discount",
      severity: "discount",
      label: "折价",
      percentText: absoluteText,
      signedPercentText,
      displayText: `折价 ${absoluteText}`,
    };
  }

  if (normalized === 0) {
    return {
      available: true,
      value: 0,
      kind: "par",
      severity: "normal",
      label: "平价",
      percentText: absoluteText,
      signedPercentText,
      displayText: `平价 ${absoluteText}`,
    };
  }

  const severity = normalized > danger
    ? "danger"
    : normalized >= warn
      ? "warning"
      : "normal";
  return {
    available: true,
    value: normalized,
    kind: "premium",
    severity,
    label: "溢价",
    percentText: absoluteText,
    signedPercentText,
    displayText: `溢价 ${absoluteText}`,
  };
}
