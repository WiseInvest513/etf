export const PENDING_DAILY = "待确认";

export function isUsableSnapshotStatus(status) {
  return status === "fresh" || status === "stale";
}

export function formatAsOf(value) {
  if (!value) return null;
  const text = String(value).trim();
  const date = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function formatLastmod(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return formatAsOf(text);
  return text.replace(/\.\d+/, "");
}

export function emptyDailySnapshot(reason = "unavailable") {
  return {
    ok: false,
    reason,
    generatedAt: null,
    expected: null,
    funds: { data: [], count: 0, status: "unavailable", as_of: null, source: {} },
    etfs: { data: [], count: 0, status: "unavailable", as_of: null, source: null },
  };
}

export function snapshotByCode(snapshot) {
  const map = new Map();
  for (const row of snapshot?.funds?.data || []) {
    if (row?.code) map.set(String(row.code), { kind: "fund", row });
  }
  for (const row of snapshot?.etfs?.data || []) {
    if (row?.code) map.set(String(row.code), { kind: "etf", row });
  }
  return map;
}

function subscriptionLabel(row) {
  const raw = String(row?.subscription_status || row?.buy_status || "").toLowerCase();
  if (raw === "suspended" || raw === "closed") return "暂停申购";
  if (raw === "limited") return "限额申购";
  if (raw === "open") return "开放申购";
  return null;
}

export function formatFundDaily(row) {
  const asOf = formatAsOf(row?.subscription_as_of);
  const usable = isUsableSnapshotStatus(row?.subscription_snapshot_status) && Boolean(asOf);
  if (!usable) return { text: PENDING_DAILY, asOf: null, usable: false };
  const status = subscriptionLabel(row);
  const limit = String(row?.daily_limit || "").trim();
  if (status === "暂停申购" || /暂停申购/.test(limit)) {
    return { text: "暂停申购", asOf, usable: true };
  }
  if (limit && status && !limit.includes(status)) {
    return { text: `${status} · ${limit}`, asOf, usable: true };
  }
  if (limit) return { text: limit, asOf, usable: true };
  if (status) return { text: status, asOf, usable: true };
  return { text: PENDING_DAILY, asOf, usable: false };
}

export function formatEtfDaily(row) {
  const asOf = formatAsOf(row?.premium_as_of || row?.premium_quote_as_of || row?.quote_as_of);
  const usable = isUsableSnapshotStatus(row?.premium_snapshot_status) && Boolean(asOf);
  const premium = row?.premium ?? row?.premium_pct;
  if (!usable || premium === null || premium === "" || !Number.isFinite(Number(premium))) {
    return { text: PENDING_DAILY, asOf: usable ? asOf : null, usable: false };
  }
  return { text: `${Number(premium).toFixed(2)}%`, asOf, usable: true };
}

export function datedDailyText(daily) {
  if (!daily?.usable) return PENDING_DAILY;
  return daily.asOf ? `${daily.text}（${daily.asOf}）` : daily.text;
}
