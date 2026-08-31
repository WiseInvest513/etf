import { parseLimitAmount } from "../seo/today-data-model.js";
import { subscriptionState } from "../product/product-detail-model.js";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export const INDEX_OPTIONS = {
  nasdaq: { label: "纳斯达克 100", shortLabel: "纳指100" },
  sp500: { label: "标普 500", shortLabel: "标普500" },
};

export function productIndexKey(product) {
  if (!product) return null;
  if (product.categories?.includes("nasdaq_passive")) return "nasdaq";
  if (product.categories?.includes("sp500_passive")) return "sp500";
  const target = `${product.tracking_index || ""} ${product.name || ""}`.toLowerCase();
  if (/纳斯达克100|纳指100|nasdaq\s*100/.test(target)) return "nasdaq";
  if (/标普500|s&p\s*500|sp500/.test(target)) return "sp500";
  return null;
}

export function isCoreIndexProduct(product, indexKey) {
  if (productIndexKey(product) !== indexKey) return false;
  const target = `${product.tracking_index || ""} ${product.name || ""}`;
  if (indexKey === "nasdaq" && /科技市值加权|高收益|增强/.test(target)) return false;
  if (indexKey === "sp500" && /等权|信息科技|增强/.test(target)) return false;
  return true;
}

function fundAvailability(row, amount) {
  const snapshot = row.subscription_snapshot_status;
  if (snapshot && snapshot !== "fresh") {
    return { key: snapshot === "stale" ? "stale" : "unknown", label: snapshot === "stale" ? "历史状态" : "额度待确认", score: -18 };
  }
  const state = subscriptionState(row);
  if (state === "suspended") return { key: "blocked", label: "暂停申购", score: -55 };
  const limit = parseLimitAmount(row.daily_limit);
  if (state === "limited" && finite(amount) && limit !== null && limit < Number(amount)) {
    return { key: "partial", label: `额度不足（${row.daily_limit}）`, score: -12 };
  }
  if (state === "limited") return { key: "fit", label: `额度可覆盖（${row.daily_limit || "限额"}）`, score: 28 };
  if (state === "open") return { key: "fit", label: "开放申购", score: 30 };
  return { key: "unknown", label: "额度待确认", score: -18 };
}

function premiumModel(row) {
  const snapshot = row.premium_snapshot_status;
  if (snapshot && snapshot !== "fresh") {
    return { key: snapshot === "stale" ? "stale" : "unknown", label: snapshot === "stale" ? "历史溢价" : "溢价待确认", score: -16 };
  }
  if (!finite(row.premium)) return { key: "unknown", label: "溢价待确认", score: -16 };
  const premium = Number(row.premium);
  if (premium < 0) return { key: "low", label: `折价 ${Math.abs(premium).toFixed(2)}%`, score: 28 };
  if (premium < 0.8) return { key: "low", label: `低溢价 ${premium.toFixed(2)}%`, score: 26 };
  if (premium < 1.5) return { key: "watch", label: `溢价 ${premium.toFixed(2)}%`, score: 14 };
  if (premium < 3) return { key: "watch", label: `需留意 ${premium.toFixed(2)}%`, score: 0 };
  return { key: "high", label: `高溢价 ${premium.toFixed(2)}%`, score: -30 };
}

function qualityScore(row) {
  let score = 0;
  if (finite(row.fee_rate)) score += Math.max(-8, 14 - Number(row.fee_rate) * 12);
  if (finite(row.track_error) && Number(row.track_error) > 0) score += Math.max(-5, 9 - Number(row.track_error) * 3);
  return score;
}

function liquidityScore(row) {
  const turnover = Number(row.turnover_cny_100m ?? row.volume);
  if (!Number.isFinite(turnover)) return 0;
  if (turnover >= 2) return 12;
  if (turnover >= 0.5) return 8;
  if (turnover >= 0.1) return 4;
  return -4;
}

export function rankFundCandidates(rows, { amount = 1000 } = {}) {
  return rows.map((row) => {
    const availability = fundAvailability(row, amount);
    let score = Math.round(Math.max(0, Math.min(100, 56 + availability.score + qualityScore(row))));
    if (["stale", "unknown"].includes(availability.key)) score = Math.min(score, 32);
    if (availability.key === "blocked") score = Math.min(score, 8);
    if (availability.key === "partial") score = Math.min(score, 50);
    return {
      ...row,
      routeType: "fund",
      dataScore: score,
      signal: availability,
      reasons: [availability.label, finite(row.fee_rate) ? `运作费率 ${Number(row.fee_rate).toFixed(2)}%` : "费率待确认"],
    };
  }).sort((a, b) => b.dataScore - a.dataScore || String(a.code).localeCompare(String(b.code)));
}

export function rankEtfCandidates(rows, { hasBroker = true } = {}) {
  return rows.map((row) => {
    const premium = premiumModel(row);
    const brokerAdjustment = hasBroker ? 0 : -60;
    let score = Math.round(Math.max(0, Math.min(100, 56 + premium.score + qualityScore(row) + liquidityScore(row) + brokerAdjustment)));
    if (["stale", "unknown"].includes(premium.key)) score = Math.min(score, 32);
    if (premium.key === "high") score = Math.min(score, 40);
    if (!hasBroker) score = 0;
    return {
      ...row,
      routeType: "etf",
      dataScore: score,
      signal: hasBroker ? premium : { key: "blocked", label: "需要证券账户", score: -60 },
      reasons: [hasBroker ? premium.label : "当前没有证券账户", finite(row.turnover_cny_100m ?? row.volume) ? `成交额 ${Number(row.turnover_cny_100m ?? row.volume).toFixed(2)}亿` : "成交额待确认"],
    };
  }).sort((a, b) => b.dataScore - a.dataScore || String(a.code).localeCompare(String(b.code)));
}

export function buildPathSummary(funds, etfs, { hasBroker = true } = {}) {
  const bestFund = funds.find((item) => ["fit", "partial"].includes(item.signal?.key));
  const bestEtf = etfs.find((item) => ["low", "watch", "high"].includes(item.signal?.key));
  if (!bestFund && !bestEtf) return { key: "unknown", title: "今日动态数据不足，暂不判断路径", text: "额度或溢价尚未更新到有效日期，可以查看低频资料，但不应据此判断今天优先买哪一侧。" };
  if (!hasBroker) return { key: "fund", title: "先看场外路径", text: "你当前选择了没有证券账户，场外基金操作门槛更低；仍需确认今日额度。" };
  if (!bestFund) return { key: "etf", title: "当前仅有场内候选", text: "场外产品资料暂不可用，请继续核对场内溢价与成交情况。" };
  if (!bestEtf) return { key: "fund", title: "当前仅有场外候选", text: "场内产品资料暂不可用，请继续核对场外申购额度。" };
  const difference = bestFund.dataScore - bestEtf.dataScore;
  if (difference >= 12) return { key: "fund", title: "今天可以优先比较场外路径", text: "当前场外额度与费用数据的匹配度更高，仍请在下单渠道复核实际申购上限。" };
  if (difference <= -12) return { key: "etf", title: "今天可以优先比较场内路径", text: "当前场内溢价与流动性数据的匹配度更高，实际交易前仍需查看实时价格。" };
  return { key: "balanced", title: "两条路径都值得比较", text: "当前没有明显单边优势，可结合操作便利、交易佣金和持有周期选择。" };
}
