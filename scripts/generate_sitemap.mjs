import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { LEARNING_PAGES } from "../src/learn/learning-seo.js";
import { formatAsOf, formatLastmod } from "../src/seo/daily-snapshot.js";
import { SITE_ORIGIN } from "../src/seo/seo-content.js";
import { loadDailySnapshot } from "./load-daily-snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = SITE_ORIGIN;
const corePaths = ["/", "/guide", "/nasdaq", "/sp500", "/etf", "/active", "/onchain", "/chooser", "/today/qdii-limits", "/today/etf-premium"];
const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

function productLastmod(product, snapshot, fallback) {
  const rows = product.product_type === "etf" ? snapshot?.etfs?.data : snapshot?.funds?.data;
  const row = (rows || []).find((item) => String(item?.code) === String(product.code));
  if (product.product_type === "etf") {
    return formatLastmod(row?.premium_as_of || row?.premium_quote_as_of) || fallback;
  }
  return formatLastmod(row?.subscription_as_of) || fallback;
}

export function buildSitemapXml({ catalog, snapshot }) {
  const catalogAsOf = formatAsOf(catalog.metadata_as_of) || catalog.metadata_as_of || null;
  const fundAsOf = formatLastmod(snapshot?.funds?.as_of) || catalogAsOf;
  const etfAsOf = formatLastmod(snapshot?.etfs?.as_of) || catalogAsOf;
  const lastmodFor = (route) => {
    if (route === "/today/qdii-limits" || route === "/nasdaq" || route === "/sp500" || route === "/active") return fundAsOf;
    if (route === "/today/etf-premium" || route === "/etf") return etfAsOf;
    if (route === "/") return formatLastmod(snapshot?.funds?.as_of || snapshot?.etfs?.as_of) || catalogAsOf;
    return catalogAsOf;
  };
  const entries = [
    ...corePaths.map((route) => ({ route, lastmod: lastmodFor(route) })),
    ...LEARNING_PAGES.filter((page) => !page.canonical).map((page) => ({ route: page.path, lastmod: page.updatedAt || catalogAsOf })),
    ...catalog.products.map((product) => ({
      route: `/${product.product_type === "etf" ? "etf" : "fund"}/${product.code}`,
      lastmod: productLastmod(product, snapshot, product.metadata_as_of || catalogAsOf),
    })),
  ];
  const urls = entries.map(({ route, lastmod }) => [
    "  <url>",
    `    <loc>${escapeXml(`${origin}${route}`)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    "  </url>",
  ].filter(Boolean).join("\n")).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return { xml, entries };
}

export async function writeSitemap(xml, destinations) {
  for (const destination of destinations) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, xml, "utf8");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalog = JSON.parse(await readFile(path.join(root, "catalog/products.v1.json"), "utf8"));
  const snapshot = await loadDailySnapshot();
  const { xml, entries } = buildSitemapXml({ catalog, snapshot });
  const destinations = [path.join(root, "public/sitemap.xml")];
  if ((await readFile(path.join(root, "dist/sitemap.xml"), "utf8").catch(() => null))) {
    destinations.push(path.join(root, "dist/sitemap.xml"));
  }
  await writeSitemap(xml, destinations);
  console.log(`Generated sitemap with ${entries.length} URLs${snapshot.ok ? ` from daily snapshot (${snapshot.funds.as_of || "funds"}, ${snapshot.etfs.as_of || "etfs"})` : ` without live snapshot (${snapshot.reason})`}.`);
}
