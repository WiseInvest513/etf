import { subscriptionState } from "../product/product-detail-model.js";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function parseLimitAmount(value) {
  if (finite(value)) return Number(value);
  const text = String(value || "").replaceAll(",", "").trim();
  if (!text) return null;
  if (/不限|无上限|无限/.test(text)) return Infinity;
  const match = text.match(/([\d.]+)\s*(亿|万|千)?/);
  if (!match) return null;
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : match[2] === "千" ? 1_000 : 1;
  const amount = Number(match[1]) * multiplier;
  return Number.isFinite(amount) ? amount : null;
}

function statusRank(row) {
  if (row.subscription_snapshot_status && row.subscription_snapshot_status !== "fresh") return null;
  const order = { suspended: 0, limited: 1, open: 2 };
  const status = subscriptionState(row);
  return status === "unknown" ? null : order[status];
}

function sortValue(row, key) {
  if (key === "status") return statusRank(row);
  if (key === "limit") return parseLimitAmount(row.daily_limit);
  if (key === "rolling") return finite(row.rolling_1y) ? Number(row.rolling_1y) : null;
  if (key === "premium") return finite(row.premium) ? Number(row.premium) : null;
  if (key === "change") return finite(row.market_change_pct ?? row.change_pct) ? Number(row.market_change_pct ?? row.change_pct) : null;
  if (key === "turnover") return finite(row.turnover_cny_100m ?? row.volume) ? Number(row.turnover_cny_100m ?? row.volume) : null;
  if (key === "date") return row.subscription_as_of || row.premium_as_of || row.quote_as_of || row.nav_as_of || row.nav_date || null;
  if (key === "name") return row.name || row.code || "";
  return row.code || "";
}

function freshnessTier(row, key) {
  const snapshot = ["status", "limit"].includes(key)
    ? row.subscription_snapshot_status
    : key === "premium" ? row.premium_snapshot_status : null;
  if (!snapshot || snapshot === "fresh") return 0;
  if (snapshot === "stale") return 1;
  return 2;
}

export function sortTodayRows(rows, key, direction = "asc") {
  const factor = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const freshnessDifference = freshnessTier(a, key) - freshnessTier(b, key);
    if (freshnessDifference) return freshnessDifference;
    const aValue = sortValue(a, key);
    const bValue = sortValue(b, key);
    const aMissing = aValue === null || aValue === undefined || aValue === "";
    const bMissing = bValue === null || bValue === undefined || bValue === "";
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return String(a.code || "").localeCompare(String(b.code || ""));
      return aMissing ? 1 : -1;
    }
    const compared = typeof aValue === "string"
      ? aValue.localeCompare(String(bValue), "zh-CN", { numeric: true })
      : aValue === bValue ? 0 : aValue > bValue ? 1 : -1;
    return compared * factor || String(a.code || "").localeCompare(String(b.code || ""));
  });
}
