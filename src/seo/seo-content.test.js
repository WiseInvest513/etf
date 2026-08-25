import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_PAGE_META,
  HOME_SEO,
  TODAY_FAQS,
  TODAY_PAGE_META,
  productSeoTitle,
} from "./seo-content.js";

test("core SEO pages have unique intent-led titles and descriptions", () => {
  const pages = [HOME_SEO, ...Object.values(CATEGORY_PAGE_META), ...Object.values(TODAY_PAGE_META)];
  assert.equal(new Set(pages.map((page) => page.path)).size, pages.length);
  assert.equal(new Set(pages.map((page) => page.title)).size, pages.length);
  for (const page of pages) {
    assert.ok(page.title.includes("WiseETF") || page.path.startsWith("/today/"));
    assert.ok(page.description.length >= 35);
  }
});

test("daily search pages answer the user intent they target", () => {
  assert.match(TODAY_PAGE_META.limits.title, /纳指.*标普500.*申购额度/);
  assert.match(TODAY_PAGE_META.premium.title, /纳指ETF.*标普500 ETF.*溢价率/);
  assert.ok(TODAY_FAQS.limits.some((item) => item.question.includes("限购10元")));
  assert.ok(TODAY_FAQS.premium.some((item) => item.question.includes("溢价率高")));
});

test("product titles match fund and ETF search intent", () => {
  assert.match(productSeoTitle({ name: "测试基金", code: "000001", product_type: "fund" }), /申购额度、费率与收益 - WiseETF$/);
  assert.match(productSeoTitle({ name: "测试ETF", code: "500001", product_type: "etf" }), /溢价率、净值与成交额 - WiseETF$/);
});
