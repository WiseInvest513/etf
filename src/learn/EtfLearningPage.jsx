import { useEffect, useState } from "react";
import { BASKET_IMAGE, MAIN_LEARNING_URL, LEARNING_ARTICLES, LEARNING_CATEGORIES, LEARNING_PATH, articlePath, filterArticles, learningHref } from "./learning-content.js";
import { LEARNING_PAGES, learningStructuredData } from "./learning-seo.js";
import { SITE_ORIGIN } from "../seo/seo-content.js";
import "./etf-learning.css";

function Arrow({ direction = "right" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={direction === "left" ? { transform: "rotate(180deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function LearningHeader() {
  const links = [{ href: "/", text: "首页" }, { href: LEARNING_PATH, text: "ETF 学习" }, { href: "/today/qdii-limits", text: "今日额度" }, { href: "/today/etf-premium", text: "今日溢价" }];
  const items = links.map((link) => <a key={link.href} href={link.href} aria-current={link.href === LEARNING_PATH ? "page" : undefined}>{link.text}</a>);
  return <header className="learn-header"><div className="learn-header-inner">
    <a className="learn-logo" href="/" aria-label="Wise ETF 首页"><img src="/learn/etf/wise-etf-mark.svg" width="36" height="36" alt=""/>Wise <span>ETF</span></a>
    <nav className="learn-desktop-nav" aria-label="学习栏目导航">{items}</nav>
    <details className="learn-mobile-menu"><summary>菜单 <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></summary><nav aria-label="移动端学习导航">{items}</nav></details>
  </div></header>;
}

function LearningFooter() {
  return <footer className="learn-footer"><div><a href={LEARNING_PATH}>Wise ETF · 学习</a><span>先理解，再做选择。</span></div><p>内容仅作知识介绍，不构成投资建议。投资有风险，历史表现不代表未来收益。</p></footer>;
}

function BookBand() {
  return <section className="learn-book"><div><span className="learn-eyebrow">继续学习</span><h2>想系统读下去？</h2><p>主站按基础、进阶、实操整理了完整学习路线。这里保留主题入口，查额度、溢价和基金数据仍在 WiseETF。</p></div><a className="learn-text-link" href={learningHref(MAIN_LEARNING_URL)} target="_blank" rel="noopener noreferrer">进入完整学习路线 <Arrow/></a></section>;
}

function ArticleListItem({ article }) {
  const href = learningHref(articlePath(article));
  const content = <>
    <span className="learn-row-number">{String(article.number).padStart(2, "0")}</span>
    <div className="learn-row-cover">{article.cover ? <img {...article.cover} alt="" decoding="async"/> : <div className="learn-cover-placeholder" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-3-1H4V4Zm9 3a3 3 0 0 1 3-3h5v16h-5a4 4 0 0 0-3 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg><span>{article.category}</span></div>}</div>
    <div className="learn-row-copy">
      <h3>{article.title}</h3>
      <p className="learn-row-excerpt">{article.summary || article.subtitle}</p>
      <div className="learn-row-meta">
        <span className="learn-row-category">{article.category}</span>
        <span>在主站阅读全文 ↗</span>
      </div>
    </div>
    {href ? <span className="learn-row-action" aria-hidden="true"><Arrow/></span> : <span className="learn-row-spacer"/>}
  </>;
  return <li>{href ? <a href={href} className="learn-article-row" data-category={article.category}>{content}</a> : <div className="learn-article-row is-planned" data-category={article.category}>{content}</div>}</li>;
}

function LearningIndex() {
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const articles = filterArticles(category, query);
  return <main className="learn-container learn-index" id="learn-main">
    <nav className="learn-breadcrumb" aria-label="面包屑"><a href="/">首页</a><span>/</span><span>ETF 学习</span></nav>
    <section className="learn-intro"><span className="learn-eyebrow">ETF LEARNING</span><h1>从认识 ETF，开始。</h1><p>在主站学习，在 WiseETF 核对数据。按自己的进度，从基础、进阶或实操开始。</p><a className="learn-text-link" href={learningHref(MAIN_LEARNING_URL)}>进入主站完整学习路线 <Arrow/></a></section>
    <section className="learn-catalog" aria-labelledby="catalog-title"><div className="learn-section-heading"><h2 id="catalog-title">学习目录</h2><p>{LEARNING_ARTICLES.length} 个主题入口 <span>·</span> 正文统一在主站</p></div>
      <div className="learn-filters"><div className="learn-category-filters" role="group" aria-label="按文章分类筛选">{["全部", ...LEARNING_CATEGORIES].map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="learn-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6"/><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg><span className="learn-sr-only">搜索学习主题</span><input type="search" placeholder="搜索主题" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div>
      <div className="learn-results" role="status" aria-live="polite">{category !== "全部" || query ? `找到 ${articles.length} 个主题` : "按顺序阅读，也可以从感兴趣的主题开始。"}</div>
      <ol className="learn-article-list">{articles.map((article) => <ArticleListItem key={article.slug} article={article}/>)}</ol>
      {!articles.length && <div className="learn-empty"><h3>暂时没有匹配的主题</h3><p>换一个关键词，或返回完整学习目录。</p><button type="button" className="learn-text-link" onClick={() => { setQuery(""); setCategory("全部"); }}>清除筛选 <Arrow/></button></div>}
      <p className="learn-plan-note">主站保留完整文章与后续阅读；本页只作主题导航，不再维护第二份正文。</p>
    </section><BookBand/>
  </main>;
}

function ArticleDestination({ article }) {
  return <main id="learn-main" className="learn-container learn-not-found">
    <span className="learn-eyebrow">ETF 学习 · {article.category}</span>
    <h1>{article.title}</h1><p>{article.summary || article.subtitle}</p>
    <p>这篇内容已整合到 Wise Invest 主站。后续更新、完整正文与下一篇，都在主站继续阅读。</p>
    <a href={learningHref(articlePath(article))} className="learn-button">前往主站阅读全文 <Arrow/></a>
    <p><a href={learningHref(MAIN_LEARNING_URL)}>查看完整学习路线</a> · <a href={LEARNING_PATH}>返回 ETF 主题目录</a></p>
  </main>;
}

export default function EtfLearningPage({ path }) {
  const normalized = path.replace(/\/$/, "");
  const isIndex = normalized === LEARNING_PATH;
  const page = LEARNING_PAGES.find((item) => item.path === normalized);
  useEffect(() => {
    document.title = page?.title || "文章未找到 - WiseETF";
    const upsert = (selector, tag, attributes) => {
      let element = document.head.querySelector(selector);
      if (!element) { element = document.createElement(tag); document.head.appendChild(element); }
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    };
    upsert('meta[name="description"]', "meta", { name: "description", content: page?.description || "返回ETF学习目录，阅读已发布的入门文章。" });
    upsert('meta[name="robots"]', "meta", { name: "robots", content: page ? "index,follow" : "noindex,follow" });
    upsert('link[rel="canonical"]', "link", { rel: "canonical", href: page?.canonical || `${SITE_ORIGIN}${page?.path || LEARNING_PATH}` });
    for (const property of ["og:title", "og:description", "og:url", "og:type", "og:image"]) {
      const value = { "og:title": document.title, "og:description": page?.description || "", "og:url": page?.canonical || `${SITE_ORIGIN}${page?.path || LEARNING_PATH}`, "og:type": "website", "og:image": `${SITE_ORIGIN}${page?.article?.cover.src || BASKET_IMAGE.src}` }[property];
      upsert(`meta[property="${property}"]`, "meta", { property, content: value });
    }
    const script = document.head.querySelector("script[data-wise-learning]") || document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.learning = "true";
    if (page) { script.textContent = JSON.stringify(learningStructuredData(page, SITE_ORIGIN)); document.head.appendChild(script); }
    return () => script.remove();
  }, [page, isIndex]);
  return <div className={`etf-learning${isIndex ? " is-learning-index" : ""}`}><a className="learn-skip" href="#learn-main">跳到正文</a><LearningHeader/>{page ? (isIndex ? <LearningIndex/> : <ArticleDestination article={page.article}/>) : <main id="learn-main" className="learn-container learn-not-found"><span className="learn-eyebrow">ETF 学习</span><h1>没有找到这篇文章</h1><p>你可以返回学习目录，前往主站继续学习。</p><a href={LEARNING_PATH} className="learn-button">返回学习目录 <Arrow/></a></main>}<LearningFooter/></div>;
}
