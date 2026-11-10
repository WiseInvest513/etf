import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEARNING_PAGES, learningFallback, learningStructuredData } from "../src/learn/learning-seo.js";
import { BASKET_IMAGE } from "../src/learn/learning-content.js";
import {
  categoryLabel,
  productRoute,
} from "../src/product/product-detail-model.js";
import {
  CATEGORY_PAGE_META,
  DECISION_PAGE_META,
  GUIDE_SEO,
  HOME_SEO,
  MAIN_SITE_TUTORIALS,
  ONCHAIN_SEO,
  PRIVATE_SEO_PAGES,
  SITE_ORIGIN,
  TODAY_FAQS,
  TODAY_PAGE_META,
  faqStructuredData,
  productSeoTitle,
} from "../src/seo/seo-content.js";
import { datedDailyText, formatAsOf, formatEtfDaily, formatFundDaily, snapshotByCode } from "../src/seo/daily-snapshot.js";
import { loadDailySnapshot } from "./load-daily-snapshot.mjs";
import { buildSitemapXml, writeSitemap } from "./generate_sitemap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const origin = SITE_ORIGIN;
const catalog = JSON.parse(await readFile(path.join(root, "catalog/products.v1.json"), "utf8"));
const builtIndex = path.join(dist, "index.html");
const templateFile = path.join(root, "scripts/.spa-template.html");
const builtHtml = await readFile(builtIndex, "utf8");
if (!builtHtml.includes("data-wise-home")) {
  await writeFile(templateFile, builtHtml, "utf8");
}
const template = builtHtml.includes("data-wise-home")
  ? await readFile(templateFile, "utf8")
  : builtHtml;
if (template.includes("data-wise-home") || !template.includes('<div id="root"></div>')) {
  throw new Error("SEO generation needs the clean Vite index.html. Run the Vite build first.");
}
const snapshot = await loadDailySnapshot();
const dailyByCode = snapshotByCode(snapshot);
const fundAsOf = formatAsOf(snapshot.funds.as_of);
const etfAsOf = formatAsOf(snapshot.etfs.as_of);

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const jsonForHtml = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const finite = (value) => value !== null && value !== "" && Number.isFinite(Number(value));
const display = (value, suffix = "") => finite(value) ? `${Number(value).toFixed(2)}${suffix}` : "暂无";
const staticDescription = (product) => {
  const details = [];
  if (product.tracking_index) details.push(`跟踪${product.tracking_index}`);
  const snapshotData = product.static_snapshot || {};
  if (finite(snapshotData.scale)) details.push(`规模${Number(snapshotData.scale).toFixed(2)}亿元`);
  if (finite(snapshotData.fee)) details.push(`运作费率${Number(snapshotData.fee).toFixed(2)}%`);
  if (finite(snapshotData.annual_return_2025)) details.push(`2025年收益${Number(snapshotData.annual_return_2025).toFixed(2)}%`);
  const intent = product.product_type === "etf"
    ? "查询最新溢价率、场内价格、基金净值、成交额和运作费率"
    : "查询今日申购额度、限购状态、运作费率、基金规模和近一年收益";
  return `${product.name}（${product.code}）${categoryLabel(product)}：${intent}${details.length ? `；${details.join("，")}` : ""}。动态数据以页面标注日期为准。`;
};

function replaceHead(html, { title, description, url, structured, marker, robots }) {
  let next = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${escapeHtml(url)}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, url
      ? `<link rel="canonical" href="${escapeHtml(url)}" />`
      : "");
  const robotsTag = robots ? `<meta name="robots" content="${escapeHtml(robots)}" />\n    ` : "";
  const structuredTag = structured
    ? `<script type="application/ld+json" ${marker}>${jsonForHtml(structured)}</script>\n  `
    : "";
  next = next.replace("</head>", `    ${robotsTag}<meta name="twitter:title" content="${escapeHtml(title)}" />\n    <meta name="twitter:description" content="${escapeHtml(description)}" />\n    ${structuredTag}</head>`);
  return next;
}

function withFallback(html, content) {
  return html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}

const fallbackStyle = `<style>
  .seo-fallback{box-sizing:border-box;max-width:1120px;margin:0 auto;padding:46px 24px 70px;color:#182238;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}.seo-fallback *{box-sizing:border-box}.seo-fallback a{color:#2164d7;text-decoration:none}.seo-fallback nav{display:flex;gap:16px;padding-bottom:28px;border-bottom:1px solid #e7ebf1;font-size:14px;font-weight:700}.seo-fallback .hero{padding:52px 0 36px}.seo-fallback .eyebrow{color:#2d68dc;font-size:12px;font-weight:800;letter-spacing:.12em}.seo-fallback h1{max-width:900px;margin:14px 0 16px;font-size:clamp(32px,6vw,62px);line-height:1.08;letter-spacing:-.04em}.seo-fallback h2{margin:42px 0 16px;font-size:24px}.seo-fallback .lead{max-width:800px;color:#667389;font-size:17px;line-height:1.8}.seo-fallback .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.seo-fallback .card{padding:22px;border:1px solid #e1e6ef;border-radius:16px;background:#f8faff}.seo-fallback .card small{display:block;color:#8a96aa}.seo-fallback .card b{display:block;margin-top:8px;font-size:20px}.seo-fallback .note{margin-top:24px;padding:20px;border-radius:14px;background:#edf5ff;color:#365070;line-height:1.7}.seo-fallback .links{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.seo-fallback .links a{padding:9px 12px;border:1px solid #d8e2f3;border-radius:10px;background:#fff;font-size:13px;font-weight:700}.seo-fallback .faq{display:grid;gap:10px}.seo-fallback .faq article{padding:18px 20px;border:1px solid #e1e6ef;border-radius:12px}.seo-fallback .faq h3{margin:0 0 8px;font-size:16px}.seo-fallback .faq p{margin:0;color:#667389;line-height:1.7}@media(max-width:720px){.seo-fallback{padding:24px 16px 48px}.seo-fallback .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.seo-fallback .hero{padding-top:34px}}
</style>`;

function siteNav() {
  return `<nav><a href="/">WiseETF</a><a href="/guide">怎么买</a><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a><a href="/onchain">链上美股</a></nav>`;
}

function tutorialLinks() {
  const links = MAIN_SITE_TUTORIALS.map((item) => `<a href="${escapeHtml(item.href)}" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`).join("");
  return `<h2>接着看主站教程</h2><div class="links">${links}<a href="https://www.wise-invest.org/articles/series/nasdaq-investing" rel="noopener noreferrer">纳指投资系列</a></div>`;
}

function dailyForProduct(product) {
  const hit = dailyByCode.get(String(product.code));
  if (!hit) {
    return product.product_type === "etf"
      ? { label: "今日溢价", daily: { text: "待确认", asOf: null, usable: false } }
      : { label: "今日额度", daily: { text: "待确认", asOf: null, usable: false } };
  }
  return hit.kind === "etf"
    ? { label: "今日溢价", daily: formatEtfDaily(hit.row) }
    : { label: "今日额度", daily: formatFundDaily(hit.row) };
}

function productFallback(product) {
  const snapshotData = product.static_snapshot || {};
  const route = productRoute(product);
  const todayRoute = product.product_type === "etf" ? "/today/etf-premium" : "/today/qdii-limits";
  const todayLabel = product.product_type === "etf" ? "查看今日溢价" : "查看今日申购额度";
  const daily = dailyForProduct(product);
  return `${fallbackStyle}<main class="seo-fallback">
    ${siteNav()}
    <section class="hero"><span class="eyebrow">${escapeHtml(categoryLabel(product))} · ${escapeHtml(product.code)}</span><h1>${escapeHtml(product.name)}</h1><p class="lead">${escapeHtml(staticDescription(product))}</p></section>
    <section class="grid">
      <div class="card"><small>${escapeHtml(daily.label)}</small><b>${escapeHtml(datedDailyText(daily.daily))}</b></div>
      <div class="card"><small>跟踪指数</small><b>${escapeHtml(product.tracking_index || "主动管理")}</b></div>
      <div class="card"><small>基金规模</small><b>${display(snapshotData.scale, " 亿元")}</b></div>
      <div class="card"><small>运作费率</small><b>${display(snapshotData.fee, "%")}</b></div>
    </section>
    <p class="note">申购额度和场内溢价只采用带日期的当日快照；获取失败时显示“待确认”，不会用目录里的旧字段冒充今日数据。</p>
    <div class="links"><a href="${todayRoute}">${todayLabel}</a><a href="${route}">打开交互详情</a><a href="/guide">比较购买路径</a></div>
    ${tutorialLinks()}
  </main>`;
}

const todayPages = Object.entries(TODAY_PAGE_META).map(([kind, meta]) => ({
  ...meta,
  kind,
  title: `${meta.title} - WiseETF`,
  heading: meta.title,
  lead: meta.description,
  faqs: TODAY_FAQS[kind],
  products: catalog.products.filter((item) => kind === "limits" ? item.product_type === "fund" : item.product_type === "etf"),
}));

const categoryPages = Object.entries(CATEGORY_PAGE_META).map(([key, meta]) => ({
  ...meta,
  key,
  products: catalog.products.filter((item) => meta.productType
    ? item.product_type === meta.productType
    : item.categories.includes(meta.category)),
}));

const decisionPages = Object.entries(DECISION_PAGE_META).map(([key, meta]) => ({ ...meta, key }));

function categoryFallback(page) {
  const links = page.products.map((product) => {
    const daily = dailyForProduct(product);
    return `<a href="${productRoute(product)}">${escapeHtml(product.name)}（${escapeHtml(product.code)}）${daily.daily.usable ? ` · ${escapeHtml(datedDailyText(daily.daily))}` : ""}</a>`;
  }).join("");
  const asOf = page.productType === "etf" ? etfAsOf : fundAsOf;
  return `${fallbackStyle}<main class="seo-fallback">
    ${siteNav()}
    <section class="hero"><span class="eyebrow">FUND COMPARISON${asOf ? ` · ${escapeHtml(asOf)}` : ""}</span><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(page.lead)}</p></section>
    <p class="note">页面加载后会读取带日期的每日快照；获取失败时保留可核验的低频产品资料，并明确标记动态字段不可用。</p>
    <h2>可比较的产品</h2><div class="links">${links}</div>
    ${tutorialLinks()}
  </main>`;
}

async function writeRoute(route, html) {
  const destination = route === "/"
    ? path.join(dist, "index.html")
    : path.join(dist, route.slice(1), "index.html");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, "utf8");
}

function websiteStructured(name, description, url) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url,
    isPartOf: { "@type": "WebSite", name: "WiseETF", url: origin },
  };
}

for (const product of catalog.products) {
  const route = productRoute(product);
  const url = `${origin}${route}`;
  const title = productSeoTitle(product);
  const description = staticDescription(product);
  const structured = {
    ...websiteStructured(title, description, url),
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "WiseETF", item: origin },
        { "@type": "ListItem", position: 2, name: categoryLabel(product) },
        { "@type": "ListItem", position: 3, name: product.name, item: url },
      ],
    },
  };
  let html = replaceHead(template, {
    title,
    description,
    url,
    structured,
    marker: `data-wise-product="${escapeHtml(product.code)}"`,
  });
  html = withFallback(html, productFallback(product));
  await writeRoute(route, html);
}

for (const page of categoryPages) {
  const url = `${origin}${page.path}`;
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.heading,
    description: page.description,
    url,
    isPartOf: { "@type": "WebSite", name: "WiseETF", url: origin },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: page.products.length,
      itemListElement: page.products.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: `${product.name}（${product.code}）`,
        url: `${origin}${productRoute(product)}`,
      })),
    },
  };
  let html = replaceHead(template, {
    title: page.title,
    description: page.description,
    url,
    structured,
    marker: `data-wise-category="${page.key}"`,
  });
  html = withFallback(html, categoryFallback(page));
  await writeRoute(page.path, html);
}

for (const page of todayPages) {
  const url = `${origin}${page.path}`;
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.title.replace(" - WiseETF", ""),
    description: page.description,
    url,
    isPartOf: { "@type": "WebSite", name: "WiseETF", url: origin },
    mainEntity: faqStructuredData(page.faqs),
  };
  const asOf = page.kind === "limits" ? fundAsOf : etfAsOf;
  const links = page.products.map((product) => {
    const daily = dailyForProduct(product);
    return `<a href="${productRoute(product)}">${escapeHtml(product.name)}（${escapeHtml(product.code)}） · ${escapeHtml(datedDailyText(daily.daily))}</a>`;
  }).join("");
  const faq = page.faqs.map((item) => `<article><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p></article>`).join("");
  const eyebrow = asOf ? `DAILY DATA · ${asOf}` : "DAILY DATA";
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(page.lead)}</p></section><p class="note">下列数字只来自带日期的当日快照。若当日来源不可用，对应字段显示“待确认”，不会把目录旧值标成今天。</p><div class="links">${links}</div><h2>常见问题</h2><section class="faq">${faq}</section>${tutorialLinks()}</main>`;
  let html = replaceHead(template, {
    title: page.title,
    description: page.description,
    url,
    structured,
    marker: `data-wise-today="${page.kind}"`,
  });
  html = withFallback(html, fallback);
  await writeRoute(page.path, html);
}

for (const page of decisionPages) {
  const url = `${origin}${page.path}`;
  const structured = websiteStructured(page.heading, page.description, url);
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">ON-EXCHANGE OR OFF-EXCHANGE</span><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(page.lead)}</p></section><section class="grid"><div class="card"><small>场外第一步</small><b>先看能否申购</b></div><div class="card"><small>场内第一步</small><b>先看是否溢价</b></div><div class="card"><small>长期持有</small><b>比较费率与误差</b></div><div class="card"><small>交易体验</small><b>检查成交与账户</b></div></section><p class="note">交互页面加载后读取 WiseETF 每日只读快照。动态数据不可用时只展示待确认，不使用目录旧值冒充今日额度或溢价。</p><div class="links"><a href="${page.path}">打开场内外选择器</a><a href="/guide">三种购买路径对比</a><a href="/nasdaq">比较纳指产品</a><a href="/sp500">比较标普500产品</a></div>${tutorialLinks()}</main>`;
  let html = replaceHead(template, {
    title: page.title,
    description: page.description,
    url,
    structured,
    marker: `data-wise-decision="${page.key}"`,
  });
  html = withFallback(html, fallback);
  await writeRoute(page.path, html);
}

for (const page of LEARNING_PAGES) {
  let html = replaceHead(template, {
    title: page.title, description: page.description, url: page.canonical || `${origin}${page.path}`,
    structured: learningStructuredData(page, origin), marker: 'data-wise-learning="true"',
  });
  html = html.replace(/<meta property="og:type" content="[^"]*"\s*\/>/, `<meta property="og:type" content="website" />`)
    .replace(/<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${origin}${page.article?.cover.src || BASKET_IMAGE.src}" />`);
  html = withFallback(html, `${fallbackStyle}<style>.seo-fallback article>section{margin-top:42px}.seo-fallback article p{line-height:1.95;margin:18px 0}.seo-fallback figure{margin:28px 0}.seo-fallback figcaption{font-size:12px;color:#73839b}.seo-fallback table{border-collapse:collapse;width:100%;min-width:520px;font-size:14px}.seo-fallback th,.seo-fallback td{padding:14px;border:1px solid #e1e6ef;text-align:left}.seo-fallback caption{text-align:left;margin:12px 0}.seo-fallback li{margin:12px 0}</style>${learningFallback(page)}${tutorialLinks()}`);
  await writeRoute(page.path, html);
}

const guideMethods = [
  { title: "场外 QDII", detail: "用支付宝、天天基金或基金公司直销，按公布净值申购。先看今日是否开放、限额多少，再比较费率和确认规则。" },
  { title: "场内 ETF", detail: "用 A 股证券账户买卖。交易时段内按市场价格成交，买之前先看溢价、成交额和净值日期。" },
  { title: "美股直购", detail: "通过海外券商直接买 QQQ、VOO 等美国市场 ETF。需要先开户，并了解外汇额度与交易规则。" },
];
{
  const url = `${origin}${GUIDE_SEO.path}`;
  const cards = guideMethods.map((item) => `<div class="card"><small>购买路径</small><b>${escapeHtml(item.title)}</b><p class="lead" style="margin:12px 0 0;font-size:14px">${escapeHtml(item.detail)}</p></div>`).join("");
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">HOW TO BUY</span><h1>${escapeHtml(GUIDE_SEO.heading)}</h1><p class="lead">${escapeHtml(GUIDE_SEO.lead)}</p></section><section class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">${cards}</section><p class="note">额度、溢价和产品状态以带日期的当日快照为准。选好路径后，再去今日工具页核对数字，或打开场内外选择器做筛选。</p><div class="links"><a href="/today/qdii-limits">查看今日额度</a><a href="/today/etf-premium">查看今日溢价</a><a href="/chooser">打开场内外选择器</a><a href="/onchain">比较链上美股</a></div>${tutorialLinks()}</main>`;
  let html = replaceHead(template, {
    title: GUIDE_SEO.title,
    description: GUIDE_SEO.description,
    url,
    structured: websiteStructured(GUIDE_SEO.heading, GUIDE_SEO.description, url),
    marker: 'data-wise-guide="true"',
  });
  await writeRoute(GUIDE_SEO.path, withFallback(html, fallback));
}

{
  const url = `${origin}${ONCHAIN_SEO.path}`;
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">TOKENIZED US STOCKS</span><h1>${escapeHtml(ONCHAIN_SEO.heading)}</h1><p class="lead">${escapeHtml(ONCHAIN_SEO.lead)}</p></section><section class="grid"><div class="card"><small>场外 QDII</small><b>先看额度</b></div><div class="card"><small>场内 ETF</small><b>先看溢价</b></div><div class="card"><small>链上现货</small><b>先看产品结构</b></div><div class="card"><small>开户准备</small><b>先看主站教程</b></div></section><p class="note">链上路径适合已经理解稳定币和交易平台规则的人。若你主要在国内账户配置纳指或标普500，可先回到三种购买方式对比，并核对今日额度和溢价。</p><div class="links"><a href="/guide">三种购买路径对比</a><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a><a href="https://www.wise-invest.org/articles/crypto/k3RVVcw4" rel="noopener noreferrer">Bitget 教程</a><a href="https://www.wise-invest.org/articles/crypto/GaM38JYk" rel="noopener noreferrer">币安教程</a></div>${tutorialLinks()}</main>`;
  let html = replaceHead(template, {
    title: ONCHAIN_SEO.title,
    description: ONCHAIN_SEO.description,
    url,
    structured: websiteStructured(ONCHAIN_SEO.heading, ONCHAIN_SEO.description, url),
    marker: 'data-wise-onchain="true"',
  });
  await writeRoute(ONCHAIN_SEO.path, withFallback(html, fallback));
}

{
  const url = `${origin}/`;
  const fundRows = (snapshot.funds.data || []).slice(0, 8).map((row) => {
    const product = catalog.products.find((item) => String(item.code) === String(row.code));
    const href = product ? productRoute(product) : "/today/qdii-limits";
    return `<a href="${href}">${escapeHtml(row.name || row.code)} · ${escapeHtml(datedDailyText(formatFundDaily(row)))}</a>`;
  }).join("");
  const etfRows = (snapshot.etfs.data || []).slice(0, 8).map((row) => {
    const product = catalog.products.find((item) => String(item.code) === String(row.code));
    const href = product ? productRoute(product) : "/today/etf-premium";
    return `<a href="${href}">${escapeHtml(row.name || row.code)} · ${escapeHtml(datedDailyText(formatEtfDaily(row)))}</a>`;
  }).join("");
  const homeAsOf = fundAsOf || etfAsOf;
  const dailyIntro = snapshot.ok
    ? `今日快照已写入静态页${homeAsOf ? `，数据日期 ${homeAsOf}` : ""}。若某个产品没有当日数字，会显示“待确认”。`
    : "今日快照暂时不可用，额度和溢价显示为“待确认”，不会用目录旧值代替。";
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">WISEETF${homeAsOf ? ` · ${escapeHtml(homeAsOf)}` : ""}</span><h1>${escapeHtml(HOME_SEO.heading)}</h1><p class="lead">${escapeHtml(HOME_SEO.lead)}</p></section><p class="note">${escapeHtml(dailyIntro)}</p><h2>今日申购额度</h2><div class="links">${fundRows || "<span>待确认</span>"}<a href="/today/qdii-limits">打开今日额度</a></div><h2>今日场内溢价</h2><div class="links">${etfRows || "<span>待确认</span>"}<a href="/today/etf-premium">打开今日溢价</a></div><div class="links"><a href="/guide">纳指和标普500怎么买</a><a href="/chooser">场内还是场外</a><a href="/nasdaq">纳指基金对比</a><a href="/sp500">标普500基金对比</a></div>${tutorialLinks()}</main>`;
  let html = replaceHead(template, {
    title: HOME_SEO.title,
    description: HOME_SEO.description,
    url,
    structured: websiteStructured(HOME_SEO.heading, HOME_SEO.description, url),
    marker: 'data-wise-home="true"',
  });
  await writeRoute("/", withFallback(html, fallback));
}

for (const page of PRIVATE_SEO_PAGES) {
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">WISEETF</span><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(page.lead)}</p></section><div class="links"><a href="/">回到首页</a><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a></div></main>`;
  let html = replaceHead(template, {
    title: page.title,
    description: page.description,
    url: `${origin}${page.path}`,
    structured: null,
    marker: "",
    robots: "noindex,follow",
  });
  html = withFallback(html, fallback);
  await writeRoute(page.path, html);
}

{
  const fallback = `${fallbackStyle}<main class="seo-fallback">${siteNav()}<section class="hero"><span class="eyebrow">404</span><h1>页面不存在</h1><p class="lead">这个地址没有对应的页面。请回到首页，或从今日额度和今日溢价继续查看公开数据。</p></section><div class="links"><a href="/">回到首页</a><a href="/guide">怎么买</a><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a></div></main>`;
  let html = replaceHead(template, {
    title: "页面不存在 - WiseETF",
    description: "这个地址在 WiseETF 上不存在。请回到首页或今日工具页查看公开数据。",
    url: "",
    structured: null,
    marker: "",
    robots: "noindex,follow",
  });
  html = withFallback(html, fallback);
  await writeFile(path.join(dist, "404.html"), html, "utf8");
  await writeRoute("/404", html);
}

const { xml, entries } = buildSitemapXml({ catalog, snapshot });
await writeSitemap(xml, [path.join(root, "public/sitemap.xml"), path.join(dist, "sitemap.xml")]);

console.log(`Generated ${catalog.products.length} product pages, ${categoryPages.length} category pages, ${todayPages.length} daily collection pages, ${decisionPages.length} decision pages, ${LEARNING_PAGES.length} learning pages, plus home/guide/onchain and ${PRIVATE_SEO_PAGES.length} noindex shells. Sitemap ${entries.length} URLs. Daily snapshot: ${snapshot.ok ? "ok" : snapshot.reason}.`);
