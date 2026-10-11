import { ALL_ARTICLES, ARTICLE_SOURCES, BOOK_URL, LEARNING_ARTICLES, LEARNING_DESCRIPTION, LEARNING_PATH, LEARNING_UPDATED_AT, articlePath, articleStats, sourcesForArticle } from "./learning-content.js";

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export const LEARNING_PAGES = [
  { path: LEARNING_PATH, title: "ETF学习 - 纳斯达克100与标普500入门 - WiseETF", description: LEARNING_DESCRIPTION, updatedAt: LEARNING_UPDATED_AT },
  ...ALL_ARTICLES.map((article) => ({ path: articlePath(article), title: `${article.title} - ${article.subtitle} - WiseETF`, description: article.description, updatedAt: article.updatedAt, article })),
];

export function learningStructuredData(page, origin) {
  const breadcrumb = { "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "首页", item: `${origin}/` },
    { "@type": "ListItem", position: 2, name: "ETF 学习", item: `${origin}${LEARNING_PATH}` },
    ...(page.article ? [{ "@type": "ListItem", position: 3, name: `${page.article.title} · ${page.article.subtitle}`, item: `${origin}${page.path}` }] : []),
  ] };
  const entity = page.article ? {
    "@type": "Article", headline: `${page.article.title} · ${page.article.subtitle}`, description: page.description,
    datePublished: page.updatedAt, dateModified: page.updatedAt, inLanguage: "zh-CN",
    image: `${origin}${page.article.cover.src}`, mainEntityOfPage: `${origin}${page.path}`,
    author: { "@type": "Organization", name: "WiseETF", url: origin },
    publisher: { "@type": "Organization", name: "WiseETF", url: origin },
    articleSection: page.article.category,
    wordCount: articleStats(page.article).wordCount,
  } : {
    "@type": "CollectionPage", name: "ETF 学习", description: page.description, url: `${origin}${page.path}`,
    mainEntity: { "@type": "ItemList", numberOfItems: LEARNING_ARTICLES.filter(articlePath).length,
      itemListElement: LEARNING_ARTICLES.filter(articlePath).map((article, index) => ({ "@type": "ListItem", position: index + 1, name: `${article.title} · ${article.subtitle}`, url: `${origin}${articlePath(article)}` })),
    },
  };
  return { "@context": "https://schema.org", "@graph": [entity, breadcrumb] };
}

function citations(ids = []) {
  return ids.map((id) => {
    const index = ARTICLE_SOURCES.findIndex((source) => source.id === id);
    const source = ARTICLE_SOURCES[index];
    return `<sup><a href="${escape(source.url)}" title="${escape(source.label)}">[${index + 1}]</a></sup>`;
  }).join("");
}

function figure(image, caption) {
  return `<figure><img src="${escape(image.src)}" alt="${escape(image.alt)}" width="${image.width}" height="${image.height}" style="max-width:100%;height:auto"/><figcaption>${escape(caption)}</figcaption></figure>`;
}

function blockHtml(block) {
  const refs = citations(block.cites);
  if (block.type === "paragraph") return `<p>${escape(block.text)}${refs}</p>`;
  if (block.type === "heading") return `<h3>${escape(block.text)}</h3>`;
  if (block.type === "callout") return `<aside class="note"><strong>${escape(block.title)}</strong><p>${escape(block.text)}${refs}</p></aside>`;
  if (block.type === "figure") return figure(block.image, block.caption) + refs;
  if (block.type === "list") return `<ul>${block.items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
  if (block.type === "flow") return `<figure><ol>${block.steps.map((step) => `<li><strong>${escape(step.title)}</strong>：${escape(step.text)}</li>`).join("")}</ol><figcaption>${escape(block.caption)}</figcaption></figure>`;
  if (block.type === "table") return `<div style="overflow-x:auto"><table><caption>${escape(block.caption)}</caption><thead><tr>${block.headers.map((cell) => `<th scope="col">${escape(cell)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${escape(cell)}</th>` : `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${refs}`;
  if (block.type === "example") return `<aside class="note"><h3>${escape(block.title)}</h3><ul>${block.holdings.map((holding) => `<li>${escape(holding.name)}：占比 ${holding.weight}%，价格变动 ${holding.move > 0 ? "+" : ""}${holding.move}%</li>`).join("")}</ul><p>${escape(block.formula)}</p><p>${escape(block.text)}</p></aside>`;
  throw new Error(`Unknown learning content block: ${block.type}`);
}

export function learningFallback(page) {
  const navigation = `<nav><a href="/">WiseETF</a><a href="${LEARNING_PATH}">ETF 学习</a><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a></nav>`;
  if (!page.article) return `<main class="seo-fallback">${navigation}<h1>从认识 ETF，开始。</h1><p class="lead">${escape(page.description)}</p><h2>学习目录</h2><ol>${LEARNING_ARTICLES.map((article) => `<li>${articlePath(article) ? `<a href="${articlePath(article)}" style="display:flex;gap:20px;align-items:center">${article.cover ? `<img src="${escape(article.cover.src)}" alt="" width="150" height="100" style="border-radius:8px;object-fit:cover"/>` : ""}<span>${escape(article.title)}${escape(article.subtitle)}</span></a>` : `${escape(article.title)} — 准备中`}<p>${escape(article.summary || article.subtitle)}</p></li>`).join("")}</ol><p><a href="${BOOK_URL}">阅读完整白皮书</a></p></main>`;
  const article = page.article;
  const stats = articleStats(article);
  const sources = sourcesForArticle(article);
  const adjacent = [ALL_ARTICLES[article.number - 2], ALL_ARTICLES[article.number]].filter(Boolean).map((item) => `<a href="${articlePath(item)}">第${item.number}篇：${escape(item.title)}</a>`).join(" · ");
  return `<main class="seo-fallback">${navigation}<article><header><h1>${escape(article.title)} · ${escape(article.subtitle)}</h1><p class="lead">${escape(article.lead)}</p><p>更新于 <time datetime="${article.updatedAt}">${article.updatedAt}</time> · 约${stats.approximateWords}字 · 预计${stats.minutes}分钟</p></header><nav aria-label="文章目录">${article.sections.map((section) => `<a href="#${section.id}">${escape(section.toc)}</a>`).join("")}</nav>${article.sections.map((section) => `<section id="${section.id}"><h2>${escape(section.title)}</h2>${section.blocks.map(blockHtml).join("")}</section>`).join("")}<h2>资料来源</h2><ol>${sources.map((source) => `<li value="${ARTICLE_SOURCES.findIndex((item) => item.id === source.id) + 1}"><a href="${escape(source.url)}">${escape(source.label)}</a></li>`).join("")}</ol><p>资料核验日期：${article.updatedAt}。数据所属日期和口径见正文；虚构案例和概念图用于教学。本文为知识介绍，不构成投资建议。</p><nav aria-label="相邻文章">${adjacent}</nav><p><a href="${BOOK_URL}">阅读完整白皮书</a> · <a href="${LEARNING_PATH}">返回学习目录</a></p></article></main>`;
}
