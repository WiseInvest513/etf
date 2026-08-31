import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(path.join(root, "catalog/products.v1.json"), "utf8"));
const origin = "https://wise-etf.com";
const corePaths = ["/", "/guide", "/nasdaq", "/sp500", "/etf", "/active", "/onchain", "/lazy", "/qdii", "/chooser", "/today/qdii-limits", "/today/etf-premium"];
const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const entries = [
  ...corePaths.map((route) => ({ route, lastmod: catalog.metadata_as_of || null })),
  ...catalog.products.map((product) => ({
    route: `/${product.product_type === "etf" ? "etf" : "fund"}/${product.code}`,
    lastmod: product.metadata_as_of || catalog.metadata_as_of || null,
  })),
];
const urls = entries.map(({ route, lastmod }) => [
  "  <url>",
  `    <loc>${escapeXml(`${origin}${route}`)}</loc>`,
  lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
  "  </url>",
].filter(Boolean).join("\n")).join("\n");
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
await writeFile(path.join(root, "public/sitemap.xml"), xml, "utf8");
console.log(`Generated sitemap with ${entries.length} URLs.`);
