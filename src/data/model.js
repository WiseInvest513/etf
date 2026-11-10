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
  status,
  alignment,
} = {}) {
  const premium = toFiniteNumber(value);
  const explicitStatus = status || (alignment === "misaligned" ? "misaligned" : alignment === "unknown" ? "unavailable" : null);

  if (premium === null) {
    const unknown = explicitStatus === "unavailable" || explicitStatus === "unknown";
    return {
      available: false,
      canAlert: false,
      value: null,
      kind: "unavailable",
      severity: "unavailable",
      label: unknown ? "待确认" : "不可用",
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

  if (explicitStatus === "misaligned") {
    return {
      available: true,
      canAlert: false,
      value: normalized,
      kind: "misaligned",
      severity: "misaligned",
      label: "口径未对齐",
      percentText: absoluteText,
      signedPercentText,
      displayText: `溢价 ${signedPercentText}（口径未对齐）`,
    };
  }

  if (explicitStatus === "stale") {
    return {
      available: true,
      canAlert: false,
      value: normalized,
      kind: "stale",
      severity: "stale",
      label: "历史参考",
      percentText: absoluteText,
      signedPercentText,
      displayText: `溢价 ${signedPercentText}（历史参考）`,
    };
  }

  if (explicitStatus === "unavailable" || explicitStatus === "unknown") {
    return {
      available: true,
      canAlert: false,
      value: normalized,
      kind: "unavailable",
      severity: "unavailable",
      label: "待确认",
      percentText: absoluteText,
      signedPercentText,
      displayText: `溢价 ${signedPercentText}（待确认）`,
    };
  }

  if (normalized < 0) {
    return {
      available: true,
      canAlert: false,
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
      canAlert: false,
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
    canAlert: severity === "warning" || severity === "danger",
    value: normalized,
    kind: "premium",
    severity,
    label: "溢价",
    percentText: absoluteText,
    signedPercentText,
    displayText: `溢价 ${absoluteText}`,
  };
}

/**
 * Pick the premium a page should show: same-day IOPV first, otherwise the
 * official NAV premium, including a misaligned official number that must not
 * trigger a high-premium warning.
 */
export function etfPremiumView(row = {}, options = {}) {
  const iopvFresh = row?.iopv_premium_status === "fresh" && toFiniteNumber(row?.iopv_premium) !== null;
  const value = iopvFresh ? row.iopv_premium : row?.premium;
  const status = iopvFresh
    ? row.iopv_premium_status
    : (row?.premium_status || row?.premium_snapshot_status);
  const alignment = iopvFresh ? row.iopv_premium_alignment : row?.premium_alignment;
  const model = premiumDisplayModel(value, { ...options, status, alignment });
  return {
    ...model,
    source: iopvFresh ? "iopv" : "official_nav",
    basis: iopvFresh
      ? (row.iopv_basis || "market_price_vs_iopv")
      : (row?.premium_basis || "market_close_vs_latest_published_nav"),
    basisLabel: iopvFresh ? "IOPV 溢价" : "官方净值溢价",
    quoteAsOf: iopvFresh
      ? (row.iopv_premium_quote_as_of || row.quote_as_of)
      : (row?.premium_quote_as_of || row?.quote_as_of),
    referenceAsOf: iopvFresh
      ? (row.iopv_as_of || row.iopv_premium_as_of)
      : (row?.premium_nav_as_of || row?.nav_as_of || row?.nav_date),
  };
}


const SAME_DAY_PREMIUM_BASIS = "same_day_close_vs_same_day_nav";
const PREMIUM_HISTORY_MIN_POINTS = { 30: 15, 90: 40 };

function premiumHistoryBand(percentile) {
  if (!Number.isFinite(percentile)) return null;
  if (percentile >= 80) return "偏高";
  if (percentile <= 20) return "偏低";
  return "中等";
}

function emptyPremiumWindow(size, label) {
  return {
    window: size,
    status: "unavailable",
    count: 0,
    minPoints: PREMIUM_HISTORY_MIN_POINTS[size],
    min: null,
    max: null,
    median: null,
    percentile: null,
    band: null,
    label,
  };
}

export function premiumHistoryView(points = [], {
  currentPremium,
  canAlert = false,
  usable = true,
  unusableReason = null,
} = {}) {
  const rows = (Array.isArray(points) ? points : [])
    .filter((item) => item && (item.basis == null || item.basis === SAME_DAY_PREMIUM_BASIS))
    .map((item) => {
      const premium = toFiniteNumber(item.premium);
      const date = item.full_date || item.date;
      return premium === null || !date ? null : { date: String(date), premium };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  let reason = usable ? null : (unusableReason || "reference_snapshot");
  let canUse = Boolean(usable && rows.length);
  if (!rows.length) {
    canUse = false;
    reason = reason || "empty";
  }

  const windowStats = (size) => {
    const minPoints = PREMIUM_HISTORY_MIN_POINTS[size];
    if (!canUse) {
      const label = reason === "reference_snapshot" ? "参考快照不用于判断当前溢价" : "暂无同口径历史";
      return emptyPremiumWindow(size, label);
    }
    const values = rows.slice(-size).map((item) => item.premium);
    if (values.length < minPoints) {
      return { ...emptyPremiumWindow(size, "样本不足，暂不判断"), count: values.length };
    }
    const ordered = [...values].sort((a, b) => a - b);
    const mid = Math.floor(ordered.length / 2);
    const median = ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
    const current = canAlert ? toFiniteNumber(currentPremium) : null;
    let percentile = null;
    let band = null;
    let label = `近${size}个交易日区间 ${Math.min(...values).toFixed(2)}%～${Math.max(...values).toFixed(2)}%`;
    if (current !== null) {
      const rank = values.filter((value) => value <= current).length;
      percentile = Math.round(rank / values.length * 100);
      band = premiumHistoryBand(percentile);
      label = `近${size}个交易日${band}（${percentile}%分位，区间 ${Math.min(...values).toFixed(2)}%～${Math.max(...values).toFixed(2)}%）`;
    }
    return {
      window: size,
      status: "ok",
      count: values.length,
      minPoints,
      min: Number(Math.min(...values).toFixed(2)),
      max: Number(Math.max(...values).toFixed(2)),
      median: Number(median.toFixed(2)),
      percentile,
      band,
      label,
    };
  };

  const windows = { 30: windowStats(30), 90: windowStats(90) };
  let caption;
  if (!canUse) {
    caption = reason === "reference_snapshot"
      ? "这笔历史是参考快照，不用于判断当前溢价是否偏高。"
      : "暂无同口径历史溢价，无法判断当前是否偏高。";
  } else {
    const parts = [windows[30].label, windows[90].label];
    const prefix = canAlert
      ? "相对自身同日口径历史："
      : "当前溢价日期未对齐，只展示历史区间，不给出分位。";
    caption = `${prefix}${parts.join("；")}`;
  }

  return {
    basis: SAME_DAY_PREMIUM_BASIS,
    usable: canUse,
    reason: canUse ? null : reason,
    pointCount: rows.length,
    windows,
    caption,
  };
}

const FRESH_SUBSCRIPTION = new Set(["fresh"]);

function snapshotIsFresh(row) {
  const snapshot = row?.subscription_status_status || row?.subscription_snapshot_status;
  return !snapshot || FRESH_SUBSCRIPTION.has(snapshot);
}

/**
 * Lower ranks are better purchase candidates. Suspended or clearly
 * insufficient quotas stay behind open/adequate funds when the snapshot is fresh.
 */
export function fundPurchaseAvailabilityRank(row, amount = null) {
  const model = normalizeSubscriptionStatus(row);
  const fresh = snapshotIsFresh(row);
  if (!fresh) {
    if (model.status === "suspended") return 80;
    return 70;
  }
  if (model.status === "open") return 0;
  if (model.status === "limited") {
    const limit = Number.isFinite(model.limitAmount) ? model.limitAmount : null;
    if (amount != null && Number.isFinite(Number(amount)) && limit != null && limit < Number(amount)) {
      return 40;
    }
    return 10;
  }
  if (model.status === "suspended") return 90;
  return 60;
}

export function fundMatchesQualityFilters(row, filters = []) {
  const selected = new Set(Array.isArray(filters) ? filters : []);
  if (selected.size === 0) return true;
  if (selected.has("fee")) {
    if (!Number.isFinite(Number(row?.fee_rate)) || Number(row.fee_rate) > 0.8) return false;
  }
  if (selected.has("track")) {
    if (!Number.isFinite(Number(row?.track_error)) || Number(row.track_error) <= 0 || Number(row.track_error) > 2) return false;
  }
  if (selected.has("scale")) {
    if (!Number.isFinite(Number(row?.scale)) || Number(row.scale) < 10) return false;
  }
  return true;
}

export function defaultSameIndexFundOrder(rows, amount = null) {
  return [...(rows || [])].sort((left, right) => {
    const availability = fundPurchaseAvailabilityRank(left, amount) - fundPurchaseAvailabilityRank(right, amount);
    if (availability) return availability;
    const feeLeft = Number.isFinite(Number(left?.fee_rate)) ? Number(left.fee_rate) : Infinity;
    const feeRight = Number.isFinite(Number(right?.fee_rate)) ? Number(right.fee_rate) : Infinity;
    if (feeLeft !== feeRight) return feeLeft - feeRight;
    const errorLeft = Number.isFinite(Number(left?.track_error)) && Number(left.track_error) > 0 ? Number(left.track_error) : Infinity;
    const errorRight = Number.isFinite(Number(right?.track_error)) && Number(right.track_error) > 0 ? Number(right.track_error) : Infinity;
    if (errorLeft !== errorRight) return errorLeft - errorRight;
    const scaleLeft = Number.isFinite(Number(left?.scale)) ? Number(left.scale) : -Infinity;
    const scaleRight = Number.isFinite(Number(right?.scale)) ? Number(right.scale) : -Infinity;
    if (scaleLeft !== scaleRight) return scaleRight - scaleLeft;
    return String(left?.code || "").localeCompare(String(right?.code || ""));
  });
}
