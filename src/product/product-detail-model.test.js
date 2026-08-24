import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductDescription,
  findProductRow,
  mergeProductData,
  productApiPath,
  productRoute,
  subscriptionState,
} from "./product-detail-model.js";

const fund = {
  code: "017436",
  name: "测试基金A",
  product_type: "fund",
  categories: ["us_active"],
  static_snapshot: { scale: 100, fee: 1.2, annual_return_2025: 20 },
};
const etf = { code: "513100", name: "测试ETF", product_type: "etf", categories: ["etfs"] };

test("builds stable public routes and API paths", () => {
  assert.equal(productRoute(fund), "/fund/017436");
  assert.equal(productApiPath(fund), "/api/funds/us_active");
  assert.equal(productRoute(etf), "/etf/513100");
  assert.equal(productApiPath(etf), "/api/etfs");
});

test("merges live values without deleting static fallback", () => {
  const row = mergeProductData(fund, { code: "017436", rolling_1y: 18.5, scale: null });
  assert.equal(row.scale, 100);
  assert.equal(row.fee_rate, 1.2);
  assert.equal(row.rolling_1y, 18.5);
  assert.equal(row.subscription_status, "unknown");
});

test("finds a row in an API envelope", () => {
  assert.equal(findProductRow({ data: [{ code: "017436", nav: 2.1 }] }, "017436")?.nav, 2.1);
});

test("description includes the product and useful live context", () => {
  const description = buildProductDescription(fund, { daily_limit: "1000元", rolling_1y: 12.34 });
  assert.match(description, /017436/);
  assert.match(description, /近一年滚动12.34%/);
  assert.match(description, /申购上限1000元/);
});

test("subscription state never treats an explicit limit as fully open", () => {
  assert.equal(subscriptionState({ subscription_status: "open", daily_limit: "1000元" }), "limited");
  assert.equal(subscriptionState({ subscription_status: "suspended", daily_limit: "1000元" }), "suspended");
  assert.equal(subscriptionState({ subscription_status: "open" }), "open");
  assert.equal(subscriptionState({}), "unknown");
});
