import { BASKET_IMAGE, LEARNING_ARTICLES, LEARNING_DESCRIPTION, LEARNING_PATH, LEARNING_UPDATED_AT, MAIN_LEARNING_URL, articlePath, legacyArticlePath } from "./learning-content.js";
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const LEARNING_PAGES = [
  { path: LEARNING_PATH, title: "ETF 学习 - 基础、进阶与实操 - WiseETF", description: LEARNING_DESCRIPTION, updatedAt: LEARNING_UPDATED_AT },
  ...LEARNING_ARTICLES.map(article => ({ path: legacyArticlePath(article), canonical: articlePath(article), title: `${article.title} - 前往主站学习 - WiseETF`, description: `${article.summary || article.subtitle}。完整内容已整合到 Wise Invest 主站，点击继续阅读；本页保留旧链接与主题入口。`, updatedAt: LEARNING_UPDATED_AT, article })),
];
export function learningStructuredData(page, origin) {
  return { "@context": "https://schema.org", "@type": page.article ? "WebPage" : "CollectionPage",
    name: page.title, description: page.description, url: page.canonical || `${origin}${page.path}`,
    ...(page.article ? { about: { "@type": "Article", url: page.canonical, headline: page.article.title } } : {
      mainEntity: { "@type": "ItemList", numberOfItems: LEARNING_ARTICLES.length, itemListElement: LEARNING_ARTICLES.map((article, index) => ({ "@type": "ListItem", position: index + 1, name: article.title, url: articlePath(article) })) },
    }),
  };
}
export function learningFallback(page) {
  const nav = `<nav><a href="/">WiseETF</a><a href="${LEARNING_PATH}">ETF 学习</a><a href="${MAIN_LEARNING_URL}">主站学习路线</a><a href="/today/etf-premium">查溢价</a></nav>`;
  if (page.article) return `<main class="seo-fallback">${nav}<h1>${escape(page.article.title)}</h1><p>${escape(page.article.summary || page.article.subtitle)}</p><p>这篇内容已整合到 Wise Invest 主站，本页保留旧链接与主题入口。</p><p><a href="${articlePath(page.article)}">前往主站阅读全文</a></p></main>`;
  return `<main class="seo-fallback">${nav}<h1>从认识 ETF，开始。</h1><p>${escape(page.description)}</p><ol>${LEARNING_ARTICLES.map(article => `<li><a href="${articlePath(article)}"><img src="${escape(article.cover?.src || BASKET_IMAGE.src)}" width="150" height="100" alt=""/>${escape(article.title)}</a><p>${escape(article.summary || article.subtitle)}</p><small>${article.category} · 在主站阅读全文</small></li>`).join("")}</ol><a href="${MAIN_LEARNING_URL}">进入完整学习路线</a></main>`;
}
