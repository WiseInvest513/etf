import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { ALL_ARTICLES, ARTICLE_SOURCES, ARTICLE_STATS, FIRST_ARTICLE, LEARNING_ARTICLES, articlePath, articleStats, exampleReturn, filterArticles, sourcesForArticle } from "./learning-content.js";
import { LEARNING_PAGES, learningFallback, learningStructuredData } from "./learning-seo.js";

test("nine ordered complete manuscripts have nine independent published routes", () => {
  assert.deepEqual(LEARNING_ARTICLES.map((article) => article.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(LEARNING_ARTICLES.filter(articlePath).length, 9);
  assert.equal(ALL_ARTICLES.length, 9);
  assert.equal(new Set(ALL_ARTICLES.map(articlePath)).size, 9);
  assert.equal(LEARNING_PAGES.length, 10);
  for (const article of ALL_ARTICLES) {
    const page = LEARNING_PAGES.find((item) => item.path === articlePath(article));
    assert.equal(page.article, article);
    assert.ok(article.sections.length >= 7);
  }
});

test("category and keyword filters preserve the learning order", () => {
  assert.deepEqual(filterArticles("基础认识").map((article) => article.number), [1, 3, 4]);
  assert.deepEqual(filterArticles("全部", "   ETF  ").map((article) => article.number), [1, 3]);
  assert.equal(filterArticles("购买与比较", "不存在的主题").length, 0);
});

test("every manuscript has resolvable citations, unique chapters and complete table rows", () => {
  const sources = new Set(ARTICLE_SOURCES.map((source) => source.id));
  assert.equal(sources.size, ARTICLE_SOURCES.length);
  for (const article of ALL_ARTICLES) {
  const ids = article.sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of article.sections) for (const block of section.blocks) {
    for (const cite of block.cites || []) assert.ok(sources.has(cite), cite);
    if (block.type === "table") for (const row of block.rows) assert.equal(row.length, block.headers.length);
  }
  const bibliography = sourcesForArticle(article);
  const cited = new Set(article.sections.flatMap((section) => section.blocks.flatMap((block) => block.cites || [])));
  cited.add("whitepaper");
  assert.deepEqual(new Set(bibliography.map((source) => source.id)), cited);
  }
});

test("fictional weighted-return example totals 100 percent and calculates four percent", () => {
  const example = FIRST_ARTICLE.sections.flatMap((section) => section.blocks).find((block) => block.type === "example");
  assert.equal(example.holdings.reduce((sum, holding) => sum + holding.weight, 0), 100);
  assert.equal(exampleReturn(example.holdings), 4);
});

test("search engines receive the full manuscript, real image paths and published-only schema", () => {
  const articlePage = LEARNING_PAGES.find((page) => page.article);
  const html = learningFallback(articlePage);
  for (const section of FIRST_ARTICLE.sections) assert.ok(html.includes(section.title));
  assert.ok(!html.includes('<img src="/learn/etf/etf-basket.jpg"'));
  assert.ok(html.includes("/learn/etf/index-baskets.jpg"));
  assert.ok(html.includes("资料来源"));
  const schema = learningStructuredData(LEARNING_PAGES[0], "https://wise-etf.com");
  assert.equal(schema["@graph"][0].mainEntity.numberOfItems, 9);
  assert.equal(learningStructuredData(articlePage, "https://wise-etf.com")["@graph"][0]["@type"], "Article");
  const indexHtml = learningFallback(LEARNING_PAGES[0]);
  assert.ok(indexHtml.includes('<img src="/learn/etf/etf-basket.jpg"'));
  assert.equal((indexHtml.match(/href="\/learn\/etf\/articles\//g) || []).length, 9);
  assert.ok(!indexHtml.includes("准备中"));
});

test("the expanded article explains value, mechanics, returns and costs with truthful reading metadata", () => {
  const ids = new Set(FIRST_ARTICLE.sections.map((section) => section.id));
  for (const id of ["etf-value", "how-it-works", "return-sources", "costs-and-price", "types-and-risks"]) assert.ok(ids.has(id));
  const stats = articleStats(FIRST_ARTICLE);
  assert.ok(stats.wordCount >= 4700 && stats.wordCount <= 5500);
  assert.equal(stats.minutes, Math.ceil(stats.wordCount / 300));
  assert.equal(articleStats({ sections: [] }).wordCount, 0);
  assert.equal(articleStats({ sections: [{ title: "测试", blocks: [{ type: "paragraph", text: "ETF 的价值", cites: ["not-visible"] }] }] }).wordCount, 6);
  const html = learningFallback(LEARNING_PAGES[1]);
  for (const block of FIRST_ARTICLE.sections.flatMap((section) => section.blocks)) {
    if (block.type === "heading") assert.ok(html.includes(`<h3>${block.text}</h3>`));
  }
  assert.equal(learningStructuredData(LEARNING_PAGES[1], "https://wise-etf.com")["@graph"][0].wordCount, stats.wordCount);
});

test("all articles are around 5000 words with distinct static copy and honest per-article metadata", () => {
  for (const page of LEARNING_PAGES.filter((item) => item.article)) {
    const article = page.article;
    const stats = ARTICLE_STATS[article.slug];
    assert.ok(stats.wordCount >= 4700 && stats.wordCount <= 5500, `${article.slug}: ${stats.wordCount}`);
    const html = learningFallback(page);
    for (const section of article.sections) {
      assert.ok(html.includes(section.title), `${article.slug}: ${section.id}`);
      assert.ok(html.includes(`id="${section.id}"`));
    }
    assert.ok(!html.includes(`<img src="${article.cover.src}"`));
    assert.ok(html.includes(`预计${stats.minutes}分钟`));
    assert.equal(learningStructuredData(page, "https://wise-etf.com")["@graph"][0].wordCount, stats.wordCount);
    assert.equal(learningStructuredData(page, "https://wise-etf.com")["@graph"][0].image, `https://wise-etf.com${article.cover.src}`);
    for (const neighbor of [ALL_ARTICLES[article.number - 2], ALL_ARTICLES[article.number]].filter(Boolean)) assert.ok(html.includes(`href="${articlePath(neighbor)}"`));
  }
});

test("all list covers and explanatory illustrations exist, have dimensions and are separate assets", async () => {
  for (const article of ALL_ARTICLES) {
    await access(new URL(`../../public${article.cover.src}`, import.meta.url));
    const figures = article.sections.flatMap((section) => section.blocks).filter((block) => block.type === "figure");
    assert.ok(figures.length >= 1, article.slug);
    for (const { image } of figures) {
      assert.notEqual(image.src, article.cover.src);
      assert.ok(image.alt && image.width > 0 && image.height > 0);
      await access(new URL(`../../public${image.src}`, import.meta.url));
    }
  }
});

test("product snapshots retain dates, third-party attribution and incomparable drawdown warning", () => {
  const article = ALL_ARTICLES.find((item) => item.slug === "major-us-etfs");
  const size = article.sections.find((item) => item.id === "size-snapshot").blocks.find((block) => block.type === "table");
  const returns = article.sections.find((item) => item.id === "return-snapshot").blocks.find((block) => block.type === "table");
  assert.equal(size.rows.length, 10);
  assert.equal(returns.rows.length, 10);
  assert.ok(size.caption.includes("日期不同"));
  assert.ok(size.rows.find((row) => row[0] === "QQQM")[3].includes("第三方"));
  assert.ok(returns.caption.includes("非同区间"));
  assert.ok(returns.cites.every((id) => id.startsWith("history-")));
});
