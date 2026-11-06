import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productRoute } from "../src/product/product-detail-model.js";
import { CATEGORY_PAGE_META, DECISION_PAGE_META, TODAY_PAGE_META } from "../src/seo/seo-content.js";
import { LEARNING_PAGES } from "../src/learn/learning-seo.js";
import { LEARNING_ARTICLES, articlePath } from "../src/learn/learning-content.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const origin = "https://wise-etf.com";
const catalog = JSON.parse(await readFile(path.join(root, "catalog/products.v1.json"), "utf8"));
const routes = [
  ...catalog.products.map(productRoute),
  ...Object.values(CATEGORY_PAGE_META).map((page) => page.path),
  ...Object.values(TODAY_PAGE_META).map((page) => page.path),
  ...Object.values(DECISION_PAGE_META).map((page) => page.path),
  ...LEARNING_PAGES.map((page) => page.path),
];

if (new Set(routes).size !== routes.length) throw new Error("SEO routes contain duplicates");

for (const route of routes) {
  const file = path.join(dist, route.slice(1), "index.html");
  await access(file);
  const html = await readFile(file, "utf8");
  const target = LEARNING_PAGES.find(page => page.path === route)?.canonical || `${origin}${route}`;
  const canonical = `<link rel="canonical" href="${target}" />`;
  if (!html.includes(canonical)) throw new Error(`Missing canonical: ${route}`);
  if (!html.includes('type="application/ld+json"')) throw new Error(`Missing structured data: ${route}`);
  if (!html.includes('<div id="root">') || !html.includes("seo-fallback")) throw new Error(`Missing static fallback: ${route}`);
}

const pageTitles = [];
for (const route of routes) {
  const html = await readFile(path.join(dist, route.slice(1), "index.html"), "utf8");
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
  const description = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || "";
  if (!title.endsWith("WiseETF")) throw new Error(`SEO title must end with site name: ${route}`);
  if (description.length < 35) throw new Error(`SEO description is too short: ${route}`);
  pageTitles.push(title);
}
if (new Set(pageTitles).size !== pageTitles.length) throw new Error("SEO page titles contain duplicates");

for (const page of Object.values(TODAY_PAGE_META)) {
  const html = await readFile(path.join(dist, page.path.slice(1), "index.html"), "utf8");
  if (!html.includes('"@type":"Question"')) throw new Error(`Missing FAQ structured data: ${page.path}`);
}

for (const [key, page] of Object.entries(CATEGORY_PAGE_META)) {
  const html = await readFile(path.join(dist, page.path.slice(1), "index.html"), "utf8");
  if (!html.includes(`data-wise-category="${key}"`)) throw new Error(`Missing category marker: ${page.path}`);
}

for (const [key, page] of Object.entries(DECISION_PAGE_META)) {
  const html = await readFile(path.join(dist, page.path.slice(1), "index.html"), "utf8");
  if (!html.includes(`data-wise-decision="${key}"`)) throw new Error(`Missing decision marker: ${page.path}`);
}

for (const product of catalog.products) {
  const route = productRoute(product);
  const html = await readFile(path.join(dist, route.slice(1), "index.html"), "utf8");
  if (!html.includes(`data-wise-product="${product.code}"`)) throw new Error(`Missing product marker: ${product.code}`);
  // Catalog migration fields can be stale. They must never leak into static SEO as current daily data.
  const description = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || "";
  if (/申购上限\s*[-+]?\d|溢价率\s*[-+]?\d/.test(description)) {
    throw new Error(`Legacy daily value leaked into SEO: ${product.code}`);
  }
}

const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
for (const route of routes.filter(route => !LEARNING_PAGES.some(page => page.path === route && page.canonical))) {
  if (!sitemap.includes(`<loc>${origin}${route}</loc>`)) throw new Error(`Route missing from sitemap: ${route}`);
}
if (sitemap.includes("<changefreq>") || sitemap.includes("<priority>")) throw new Error("Sitemap contains ignored priority hints");

for (const page of LEARNING_PAGES) {
  const html = await readFile(path.join(dist, page.path.slice(1), "index.html"), "utf8");
  if (!html.includes('data-wise-learning="true"')) throw new Error(`Missing learning marker: ${page.path}`);
  if (!page.article) for (const article of LEARNING_ARTICLES) {
    if (!html.includes(`<img src="${article.cover.src}"`)) throw new Error(`Learning list cover missing: ${article.slug}`);
    if (!html.includes(`href="${articlePath(article)}"`)) throw new Error(`Published article missing from index: ${article.slug}`);
    await access(path.join(dist, article.cover.src.slice(1)));
  }
  if (page.article) {
    if (!html.includes(`href="${page.canonical}"`)) throw new Error(`Missing main article link: ${page.path}`);
    if (!html.includes("前往主站阅读全文")) throw new Error(`Missing migration notice: ${page.path}`);
    if (html.includes("learn-prose-section") || html.includes("articleBody")) throw new Error(`Duplicated body: ${page.path}`);
    if (sitemap.includes(`<loc>${origin}${page.path}</loc>`)) throw new Error(`Legacy page remains in sitemap: ${page.path}`);
  }
}

console.log(`Verified ${routes.length} statically discoverable SEO routes.`);
