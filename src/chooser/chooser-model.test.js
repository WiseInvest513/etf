import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPathSummary,
  isCoreIndexProduct,
  productIndexKey,
  rankEtfCandidates,
  rankFundCandidates,
} from "./chooser-model.js";

test("maps products to the supported core indices", () => {
  assert.equal(productIndexKey({ categories: ["nasdaq_passive"] }), "nasdaq");
  assert.equal(productIndexKey({ tracking_index: "标普500", product_type: "etf" }), "sp500");
  assert.equal(isCoreIndexProduct({ categories: ["sp500_passive"], name: "标普500等权基金" }, "sp500"), false);
});

test("fund ranking does not present stale limits as current availability", () => {
  const ranked = rankFundCandidates([
    { code: "OLD", subscription_status: "open", daily_limit: "不限额", subscription_snapshot_status: "stale", fee_rate: 0.5 },
    { code: "NOW", subscription_status: "limited", daily_limit: "1000元", subscription_snapshot_status: "fresh", fee_rate: 0.8 },
  ], { amount: 800 });
  assert.equal(ranked[0].code, "NOW");
  assert.equal(ranked.find((item) => item.code === "OLD").signal.key, "stale");
  assert.ok(ranked.find((item) => item.code === "OLD").dataScore <= 32);
});

test("fund ranking recognizes when the requested amount exceeds the daily limit", () => {
  const [candidate] = rankFundCandidates([
    { code: "LOW", subscription_status: "limited", daily_limit: "50元", subscription_snapshot_status: "fresh", fee_rate: 0.6 },
  ], { amount: 1000 });
  assert.equal(candidate.signal.key, "partial");
});

test("ETF ranking keeps unknown premium behind a fresh low premium", () => {
  const ranked = rankEtfCandidates([
    { code: "NONE", premium: null, premium_snapshot_status: "unavailable", fee_rate: 0.6 },
    { code: "LOW", premium: 0.3, premium_snapshot_status: "fresh", fee_rate: 0.8, turnover_cny_100m: 1 },
  ]);
  assert.equal(ranked[0].code, "LOW");
  assert.equal(ranked[1].signal.key, "unknown");
  assert.ok(ranked[1].dataScore <= 32);
});

test("path summary refuses to choose a route from stale daily data", () => {
  const summary = buildPathSummary(
    [{ dataScore: 50, signal: { key: "stale" } }],
    [{ dataScore: 60, signal: { key: "stale" } }],
  );
  assert.equal(summary.key, "unknown");
});

test("path summary respects the lack of a securities account", () => {
  const summary = buildPathSummary(
    [{ dataScore: 70, signal: { key: "fit" } }],
    [{ dataScore: 90, signal: { key: "low" } }],
    { hasBroker: false },
  );
  assert.equal(summary.key, "fund");
});
