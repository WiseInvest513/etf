export const CATEGORY_LABELS = {
  nasdaq_passive: "纳指被动",
  sp500_passive: "标普 500 被动",
  us_active: "美股主动",
  etfs: "场内 ETF",
};

export function productRoute(product) {
  if (!product?.code) return "/";
  return `/${product.product_type === "etf" ? "etf" : "fund"}/${product.code}`;
}

export function productApiPath(product) {
  if (!product) return null;
  if (product.product_type === "etf") return "/api/etfs";
  const category = product.categories?.find((item) => item !== "funds");
  return category ? `/api/funds/${category}` : null;
}

export function categoryLabel(product) {
  if (product?.product_type === "etf") return CATEGORY_LABELS.etfs;
  const category = product?.categories?.find((item) => CATEGORY_LABELS[item]);
  return CATEGORY_LABELS[category] || "QDII 基金";
}

export function mergeProductData(product, liveRow) {
  if (!product) return null;
  const snapshot = product.static_snapshot || {};
  const base = {
    ...product,
    ...snapshot,
    fee_rate: snapshot.fee ?? snapshot.fee_rate ?? null,
    metadata_as_of: product.metadata_as_of || snapshot.metadata_as_of || null,
    // 目录中的这些字段只用于旧版本迁移，不能作为“当前”行情或申购状态展示。
    daily_limit: null,
    subscription_status: "unknown",
    premium: null,
    volume: null,
    turnover_cny_100m: null,
    change_pct: null,
    market_change_pct: null,
    market_price: null,
    nav: null,
  };
  if (!liveRow) return base;
  for (const [key, value] of Object.entries(liveRow)) {
    if (value !== null && value !== undefined && value !== "") base[key] = value;
  }
  return base;
}

export function buildProductDescription(product, row = product) {
  if (!product) return "WiseETF 美股 ETF 与 QDII 基金数据";
  const label = categoryLabel(product);
  const details = [];
  if (row?.tracking_index) details.push(`跟踪${row.tracking_index}`);
  if (Number.isFinite(row?.rolling_1y)) details.push(`近一年滚动${row.rolling_1y.toFixed(2)}%`);
  if (product.product_type === "etf" && Number.isFinite(row?.premium)) {
    details.push(`溢价率${row.premium.toFixed(2)}%`);
  } else if (subscriptionState(row) === "suspended") {
    details.push("当前暂停申购");
  } else if (row?.daily_limit) {
    details.push(`申购上限${row.daily_limit}`);
  } else if (subscriptionState(row) === "open") {
    details.push("当前开放申购");
  }
  const intent = product.product_type === "etf"
    ? "查询最新溢价率、场内价格、基金净值、成交额和运作费率"
    : "查询今日申购额度、限购状态、运作费率、基金规模和近一年收益";
  return `${product.name}（${product.code}）${label}：${intent}${details.length ? `；${details.join("，")}` : ""}。动态数据以页面标注日期为准。`;
}

export function findProductRow(payload, code) {
  const rows = extractProductRows(payload);
  return rows.find((row) => String(row.code) === String(code)) || null;
}

export function extractProductRows(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

export function subscriptionState(row) {
  const raw = String(row?.subscription_status || row?.buy_status || "unknown").toLowerCase();
  if (raw === "suspended" || raw === "closed") return "suspended";
  if (raw === "limited" || row?.daily_limit) return "limited";
  if (raw === "open") return "open";
  return "unknown";
}
