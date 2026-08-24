import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  categoryLabel,
  productRoute,
} from "../src/product/product-detail-model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const origin = "https://wise-etf.com";
const catalog = JSON.parse(await readFile(path.join(root, "catalog/products.v1.json"), "utf8"));
const template = await readFile(path.join(dist, "index.html"), "utf8");

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
  const snapshot = product.static_snapshot || {};
  const details = [];
  if (product.tracking_index) details.push(`跟踪${product.tracking_index}`);
  if (finite(snapshot.scale)) details.push(`规模${Number(snapshot.scale).toFixed(2)}亿元`);
  if (finite(snapshot.fee)) details.push(`运作费率${Number(snapshot.fee).toFixed(2)}%`);
  if (finite(snapshot.annual_return_2025)) details.push(`2025年收益${Number(snapshot.annual_return_2025).toFixed(2)}%`);
  return `${product.name}（${product.code}）${categoryLabel(product)}资料${details.length ? `：${details.join("，")}` : ""}。今日申购额度、滚动收益或场内溢价以页面动态快照和数据日期为准。`;
};

function replaceHead(html, { title, description, url, structured, marker }) {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${escapeHtml(url)}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${escapeHtml(url)}" />`)
    .replace("</head>", `    <meta name="twitter:title" content="${escapeHtml(title)}" />\n    <meta name="twitter:description" content="${escapeHtml(description)}" />\n    <script type="application/ld+json" ${marker}>${jsonForHtml(structured)}</script>\n  </head>`);
}

function withFallback(html, content) {
  return html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}

const fallbackStyle = `<style>
  .seo-fallback{box-sizing:border-box;max-width:1120px;margin:0 auto;padding:46px 24px 70px;color:#182238;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}.seo-fallback *{box-sizing:border-box}.seo-fallback a{color:#2164d7;text-decoration:none}.seo-fallback nav{display:flex;gap:16px;padding-bottom:28px;border-bottom:1px solid #e7ebf1;font-size:14px;font-weight:700}.seo-fallback .hero{padding:52px 0 36px}.seo-fallback .eyebrow{color:#2d68dc;font-size:12px;font-weight:800;letter-spacing:.12em}.seo-fallback h1{max-width:900px;margin:14px 0 16px;font-size:clamp(32px,6vw,62px);line-height:1.08;letter-spacing:-.04em}.seo-fallback .lead{max-width:800px;color:#667389;font-size:17px;line-height:1.8}.seo-fallback .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.seo-fallback .card{padding:22px;border:1px solid #e1e6ef;border-radius:16px;background:#f8faff}.seo-fallback .card small{display:block;color:#8a96aa}.seo-fallback .card b{display:block;margin-top:8px;font-size:20px}.seo-fallback .note{margin-top:24px;padding:20px;border-radius:14px;background:#edf5ff;color:#365070;line-height:1.7}.seo-fallback .links{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.seo-fallback .links a{padding:9px 12px;border:1px solid #d8e2f3;border-radius:10px;background:#fff;font-size:13px;font-weight:700}@media(max-width:720px){.seo-fallback{padding:24px 16px 48px}.seo-fallback .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.seo-fallback .hero{padding-top:34px}}
</style>`;

function productFallback(product) {
  const snapshot = product.static_snapshot || {};
  const route = productRoute(product);
  const todayRoute = product.product_type === "etf" ? "/today/etf-premium" : "/today/qdii-limits";
  const todayLabel = product.product_type === "etf" ? "查看今日溢价" : "查看今日申购额度";
  return `${fallbackStyle}<main class="seo-fallback">
    <nav><a href="/">WiseETF</a><a href="${todayRoute}">${todayLabel}</a><a href="/onchain">链上美股</a></nav>
    <section class="hero"><span class="eyebrow">${escapeHtml(categoryLabel(product))} · ${escapeHtml(product.code)}</span><h1>${escapeHtml(product.name)}</h1><p class="lead">${escapeHtml(staticDescription(product))}</p></section>
    <section class="grid">
      <div class="card"><small>跟踪指数</small><b>${escapeHtml(product.tracking_index || "主动管理")}</b></div>
      <div class="card"><small>基金规模</small><b>${display(snapshot.scale, " 亿元")}</b></div>
      <div class="card"><small>运作费率</small><b>${display(snapshot.fee, "%")}</b></div>
      <div class="card"><small>2025 年收益</small><b>${display(snapshot.annual_return_2025, "%")}</b></div>
    </section>
    <p class="note">当前页面先展示低频、可核验的产品资料。申购额度、场内溢价、滚动收益和昨日涨跌需要从 WiseETF 当日快照读取；获取失败时不会用目录中的旧状态冒充今日数据。</p>
    <div class="links"><a href="${todayRoute}">${todayLabel}</a><a href="${route}">打开交互详情</a><a href="/">比较全部产品</a></div>
  </main>`;
}

const todayPages = [
  {
    kind: "limits",
    route: "/today/qdii-limits",
    title: "今日 QDII 申购额度 · WiseETF",
    description: "查看纳指、标普500和美股主动QDII基金今天是否开放申购、每日限额及数据日期。获取失败时明确显示待确认。",
    heading: "今天哪些 QDII 还能买？",
    lead: "集中查看纳指、标普500与美股主动基金的开放、限额、暂停状态。页面只读取 WiseETF 已有的每日缓存，不会因为用户访问而反复请求全部上游。",
    products: catalog.products.filter((item) => item.product_type === "fund"),
  },
  {
    kind: "premium",
    route: "/today/etf-premium",
    title: "今日场内 ETF 溢价 · WiseETF",
    description: "查看纳指与标普500场内ETF最新收盘溢价率、场内涨跌、成交额及净值日期，识别高溢价风险。",
    heading: "今天场内 ETF 贵不贵？",
    lead: "比较同指数场内 ETF 的收盘溢价、场内涨跌与成交额。只有报价和净值日期都有效时才计算正式溢价，盘中或旧快照会明确标注状态。",
    products: catalog.products.filter((item) => item.product_type === "etf"),
  },
];

for (const product of catalog.products) {
  const route = productRoute(product);
  const url = `${origin}${route}`;
  const title = `${product.name}（${product.code}）${product.product_type === "etf" ? "行情与溢价信息" : "数据与申购信息"} · WiseETF`;
  const description = staticDescription(product);
  const structured = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url,
    isPartOf: { "@type": "WebSite", name: "WiseETF", url: origin },
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
  const destination = path.join(dist, route.slice(1), "index.html");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, "utf8");
}

for (const page of todayPages) {
  const url = `${origin}${page.route}`;
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.title.replace(" · WiseETF", ""),
    description: page.description,
    url,
    isPartOf: { "@type": "WebSite", name: "WiseETF", url: origin },
  };
  const links = page.products.slice(0, 18).map((product) => `<a href="${productRoute(product)}">${escapeHtml(product.name)}（${escapeHtml(product.code)}）</a>`).join("");
  const fallback = `${fallbackStyle}<main class="seo-fallback"><nav><a href="/">WiseETF</a><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a></nav><section class="hero"><span class="eyebrow">DAILY DATA · ${escapeHtml(catalog.metadata_as_of)}</span><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(page.lead)}</p></section><p class="note">每日动态数据将在页面加载后从 WiseETF 缓存快照展示。若当日来源不可用，页面保留产品入口并明确显示“待确认”，不会把旧数据标成今天。</p><div class="links">${links}</div></main>`;
  let html = replaceHead(template, {
    title: page.title,
    description: page.description,
    url,
    structured,
    marker: `data-wise-today="${page.kind}"`,
  });
  html = withFallback(html, fallback);
  const destination = path.join(dist, page.route.slice(1), "index.html");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, "utf8");
}

console.log(`Generated ${catalog.products.length} product pages and ${todayPages.length} daily collection pages.`);
