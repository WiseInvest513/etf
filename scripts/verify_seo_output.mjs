import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productRoute } from "../src/product/product-detail-model.js";
import { CATEGORY_PAGE_META, DECISION_PAGE_META, GUIDE_SEO, HOME_SEO, MAIN_SITE_TUTORIALS, ONCHAIN_SEO, PRIVATE_SEO_PAGES, SITE_ORIGIN, TODAY_PAGE_META } from "../src/seo/seo-content.js";
import { LEARNING_PAGES } from "../src/learn/learning-seo.js";
import { LEARNING_ARTICLES, articlePath } from "../src/learn/learning-content.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const origin = SITE_ORIGIN;
const catalog = JSON.parse(await readFile(path.join(root, "catalog/products.v1.json"), "utf8"));
const corePages = [HOME_SEO, GUIDE_SEO, ONCHAIN_SEO];
const routes = [
  ...corePages.map((page) => page.path),
  ...catalog.products.map(productRoute),
  ...Object.values(CATEGORY_PAGE_META).map((page) => page.path),
  ...Object.values(TODAY_PAGE_META).map((page) => page.path),
  ...Object.values(DECISION_PAGE_META).map((page) => page.path),
  ...LEARNING_PAGES.map((page) => page.path),
];
const htmlFile = (route) => route === "/" ? path.join(dist, "index.html") : path.join(dist, route.slice(1), "index.html");

if (new Set(routes).size !== routes.length) throw new Error("SEO routes contain duplicates");

for (const route of routes) {
  const file = htmlFile(route);
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
  const html = await readFile(htmlFile(route), "utf8");
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
  const html = await readFile(htmlFile(route), "utf8");
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
for (const hidden of ["/qdii", "/lazy", "/login"]) {
  if (sitemap.includes(`<loc>${origin}${hidden}</loc>`)) throw new Error(`Private or shell route remains in sitemap: ${hidden}`);
}
if (origin !== "https://www.wise-etf.com") throw new Error("SEO origin must use www.wise-etf.com");

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

const homeHtml = await readFile(path.join(dist, "index.html"), "utf8");
if (!homeHtml.includes('data-wise-home="true"')) throw new Error("Missing home prerender marker");
if (!homeHtml.includes(`<h1>${HOME_SEO.heading}</h1>`)) throw new Error("Missing home H1");

const guideHtml = await readFile(path.join(dist, "guide/index.html"), "utf8");
if (!guideHtml.includes('data-wise-guide="true"')) throw new Error("Missing guide prerender marker");
if (!guideHtml.includes(GUIDE_SEO.heading)) throw new Error("Missing guide H1");
const guideFallback = guideHtml.match(/<main class="seo-fallback">[\s\S]*<\/main>/)?.[0] || "";
if (!guideFallback) throw new Error("Missing guide fallback body");
if (guideFallback.includes("ETF 是什么")) throw new Error("Guide page should not be an ETF 101 essay");

const onchainHtml = await readFile(path.join(dist, "onchain/index.html"), "utf8");
if (!onchainHtml.includes('data-wise-onchain="true"')) throw new Error("Missing onchain prerender marker");
if (!onchainHtml.includes(ONCHAIN_SEO.heading)) throw new Error("Missing onchain H1");

for (const html of [homeHtml, guideHtml, onchainHtml, ...await Promise.all(Object.values(TODAY_PAGE_META).map((page) => readFile(htmlFile(page.path), "utf8")))]) {
  for (const tutorial of MAIN_SITE_TUTORIALS) {
    if (!html.includes(`href="${tutorial.href}"`)) throw new Error(`Missing main-site tutorial link: ${tutorial.href}`);
  }
}

for (const page of PRIVATE_SEO_PAGES) {
  const html = await readFile(htmlFile(page.path), "utf8");
  if (!html.includes('content="noindex,follow"')) throw new Error(`Missing noindex: ${page.path}`);
  if (sitemap.includes(`<loc>${origin}${page.path}</loc>`)) throw new Error(`Private route remains in sitemap: ${page.path}`);
}

const notFound = await readFile(path.join(dist, "404.html"), "utf8");
if (!notFound.includes('content="noindex,follow"')) throw new Error("Missing 404 noindex");
if (!notFound.includes("<h1>页面不存在</h1>")) throw new Error("Missing 404 heading");

console.log(`Verified ${routes.length} statically discoverable SEO routes.`);
