import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { LEARNING_ARTICLES, LEARNING_CATEGORIES, MAIN_LEARNING_URL, articlePath, legacyArticlePath, filterArticles } from "./learning-content.js";
import { LEARNING_PAGES, learningFallback, learningStructuredData } from "./learning-seo.js";

test("nine old learning URLs retain summaries pointing to one main canonical each", () => {
  assert.equal(LEARNING_ARTICLES.length, 9);
  assert.equal(new Set(LEARNING_ARTICLES.map(articlePath)).size, 9);
  for (const article of LEARNING_ARTICLES) {
    const page = LEARNING_PAGES.find(page => page.path === legacyArticlePath(article));
    assert.ok(page, article.slug);
    assert.equal(page.canonical, article.mainUrl);
    assert.match(page.canonical, /^https:\/\/www\.wise-invest\.org\/articles\/index\/[A-Za-z0-9]{8}$/);
    assert.equal(article.sections, undefined);
    const html = learningFallback(page);
    assert.ok(html.includes(`href="${article.mainUrl}"`));
    assert.ok(html.includes("前往主站阅读全文"));
    assert.ok(html.length < 1500, "Legacy pages carry only a summary, never the full manuscript");
    assert.equal(learningStructuredData(page, "https://wise-etf.com").url, article.mainUrl);
  }
});
test("the ETF directory exposes three learning stages and main-site destinations", () => {
  assert.deepEqual(LEARNING_CATEGORIES, ["基础", "进阶", "实操"]);
  for (const category of LEARNING_CATEGORIES) assert.ok(filterArticles(category).length > 0);
  assert.equal(filterArticles("全部", "不会存在的标题").length, 0);
  assert.ok(filterArticles("全部", "ETF").length > 0);
  const page = LEARNING_PAGES[0], html = learningFallback(page);
  assert.ok(html.includes(MAIN_LEARNING_URL));
  for (const article of LEARNING_ARTICLES) assert.ok(html.includes(`href="${article.mainUrl}"`));
});
test("satellite production source no longer stores or imports complete manuscripts", () => {
  const source = fs.readFileSync(new URL("./learning-content.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /FIRST_ARTICLE|ALL_ARTICLES|from ["']\.\/articles|sections:/);
  const bodyDirectory = new URL("./articles", import.meta.url);
  assert.equal(fs.existsSync(bodyDirectory) ? fs.readdirSync(bodyDirectory).filter(name => name.endsWith(".js")).length : 0, 0);
});
