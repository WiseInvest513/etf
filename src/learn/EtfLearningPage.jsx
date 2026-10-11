import { useEffect, useRef, useState } from "react";
import { ALL_ARTICLES, ARTICLE_SOURCES, ARTICLE_STATS, BASKET_IMAGE, BOOK_URL, LEARNING_ARTICLES, LEARNING_CATEGORIES, LEARNING_PATH, LEARNING_UPDATED_AT, articlePath, filterArticles, sourcesForArticle } from "./learning-content.js";
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
  return <section className="learn-book"><div><span className="learn-eyebrow">继续学习</span><h2>想系统读下去？</h2><p>这组文章以《纳指 / 标普投资白皮书》的主题为线索，重新整理成适合网页阅读的入门内容。</p></div><a className="learn-text-link" href={BOOK_URL} target="_blank" rel="noopener noreferrer">阅读完整白皮书 <Arrow/></a></section>;
}

const READING_META_PATHS = {
  time: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>,
  words: <><path d="M6 3h9l3 3v15H6V3Z"/><path d="M14 3v4h4M9 11h6m-6 4h6"/></>,
  date: <><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M8 3v5m8-5v5M4 11h16"/></>,
};

function ReadingMetaIcon({ type }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{READING_META_PATHS[type]}</svg>;
}

function ArticleListItem({ article }) {
  const href = articlePath(article);
  const stats = ARTICLE_STATS[article.slug];
  const content = <>
    <span className="learn-row-number">{String(article.number).padStart(2, "0")}</span>
    <div className="learn-row-cover">{article.cover ? <img {...article.cover} alt="" decoding="async"/> : <div className="learn-cover-placeholder" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-3-1H4V4Zm9 3a3 3 0 0 1 3-3h5v16h-5a4 4 0 0 0-3 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg><span>{article.category}</span></div>}</div>
    <div className="learn-row-copy">
      <h3>{article.title}</h3>
      <p className="learn-row-excerpt">{article.summary || article.subtitle}</p>
      <div className="learn-row-meta">
        <span className="learn-row-category">{article.category}</span>
        {href ? <>
          <span><ReadingMetaIcon type="time"/>约 {stats.minutes} 分钟</span>
          <span><ReadingMetaIcon type="words"/>约 {stats.approximateWords.toLocaleString("zh-CN")} 字</span>
          <time dateTime={LEARNING_UPDATED_AT}><ReadingMetaIcon type="date"/>更新于 {LEARNING_UPDATED_AT}</time>
        </> : <span className="learn-planned">准备中</span>}
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
    <section className="learn-intro"><span className="learn-eyebrow">ETF LEARNING</span><h1>从认识 ETF，开始。</h1><p>看懂指数、购买方式与投资风险，再做自己的选择。</p></section>
    <section className="learn-catalog" aria-labelledby="catalog-title"><div className="learn-section-heading"><h2 id="catalog-title">学习目录</h2><p>{LEARNING_ARTICLES.length} 篇完整教程 <span>·</span> 每篇约 5,000 字</p></div>
      <div className="learn-filters"><div className="learn-category-filters" role="group" aria-label="按文章分类筛选">{["全部", ...LEARNING_CATEGORIES].map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="learn-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6"/><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg><span className="learn-sr-only">搜索学习主题</span><input type="search" placeholder="搜索主题" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div>
      <div className="learn-results" role="status" aria-live="polite">{category !== "全部" || query ? `找到 ${articles.length} 个主题` : "按顺序阅读，也可以从感兴趣的主题开始。"}</div>
      <ol className="learn-article-list">{articles.map((article) => <ArticleListItem key={article.slug} article={article}/>)}</ol>
      {!articles.length && <div className="learn-empty"><h3>暂时没有匹配的主题</h3><p>换一个关键词，或返回完整学习目录。</p><button type="button" className="learn-text-link" onClick={() => { setQuery(""); setCategory("全部"); }}>清除筛选 <Arrow/></button></div>}
      <p className="learn-plan-note">从基础认识到购买比较，再到收益与长期计划；每篇可独立阅读，也可以按顺序学习。</p>
    </section><BookBand/>
  </main>;
}

function Citations({ ids = [] }) {
  return ids.map((id) => {
    const index = ARTICLE_SOURCES.findIndex((source) => source.id === id);
    const source = ARTICLE_SOURCES[index];
    return <sup key={id} className="learn-citation"><a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`资料来源 ${index + 1}：${source.label}`}>[{index + 1}]</a></sup>;
  });
}

function ArticleBlock({ block }) {
  const refs = <Citations ids={block.cites}/>;
  if (block.type === "paragraph") return <p>{block.text}{refs}</p>;
  if (block.type === "heading") return <h3>{block.text}</h3>;
  if (block.type === "callout") return <aside className="learn-callout"><strong>{block.title}</strong><p>{block.text}{refs}</p></aside>;
  if (block.type === "figure") return <figure className="learn-inline-figure"><img {...block.image} loading="lazy" decoding="async"/><figcaption>{block.caption}{refs}</figcaption></figure>;
  if (block.type === "list") return <ul className="learn-checklist">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
  if (block.type === "flow") return <figure className="learn-flow"><ol>{block.steps.map((step, index) => <li key={step.title}><span className="learn-flow-step">0{index + 1}</span><strong>{step.title}</strong><span>{step.text}</span>{index < block.steps.length - 1 && <span className="learn-flow-arrow"><Arrow/></span>}</li>)}</ol><figcaption>{block.caption}</figcaption></figure>;
  if (block.type === "table") return <div className="learn-table-block"><span className="learn-table-hint">左右滑动查看完整表格 ↔</span><div className="learn-table-scroll" tabIndex={0} role="region" aria-label={`${block.caption}，窄屏可横向滚动`}><table><caption>{block.caption}</caption><thead><tr>{block.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>{block.cites && <div className="learn-table-sources">规则与产品资料 <Citations ids={block.cites}/></div>}</div>;
  if (block.type === "example") return <aside className="learn-example"><span className="learn-eyebrow">虚构案例 · 不是真实持仓</span><h3>{block.title}</h3><div className="learn-weight-bar" aria-hidden="true">{block.holdings.map((holding) => <span key={holding.name} style={{ flex: holding.weight }}>{holding.weight}%</span>)}</div><dl>{block.holdings.map((holding) => <div key={holding.name}><dt>{holding.name} · 占比 {holding.weight}%</dt><dd>价格变动 <strong>{holding.move > 0 ? "+" : ""}{holding.move}%</strong></dd></div>)}</dl><div className="learn-formula">{block.formula}</div><p>{block.text}</p></aside>;
  return null;
}

function TableOfContents({ article, activeId, onSelect }) {
  return <nav aria-label="文章目录"><p className="learn-toc-title">本文目录</p><ol>{article.sections.map((section, index) => <li key={section.id}><a href={`#${section.id}`} aria-current={activeId === section.id ? "location" : undefined} onClick={onSelect}><span>{String(index + 1).padStart(2, "0")}</span>{section.toc}</a></li>)}</ol></nav>;
}

function ArticleReader({ article }) {
  const stats = ARTICLE_STATS[article.slug];
  const sources = sourcesForArticle(article);
  const previous = ALL_ARTICLES[article.number - 2];
  const next = ALL_ARTICLES[article.number];
  const [activeId, setActiveId] = useState(article.sections[0].id);
  const [copyState, setCopyState] = useState("idle");
  const mobileToc = useRef(null);
  const manualLink = useRef(null);
  useEffect(() => {
    // The article is lazy-loaded, so the browser's initial anchor lookup may
    // happen before its sections exist. Restore valid chapter links after mount.
    const section = article.sections.find((item) => `#${item.id}` === window.location.hash);
    if (section) document.getElementById(section.id)?.scrollIntoView({ block: "start" });
  }, [article]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-100px 0px -55% 0px" });
    article.sections.forEach((section) => { const element = document.getElementById(section.id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [article]);
  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = setTimeout(() => setCopyState("idle"), 3000);
    return () => clearTimeout(timeout);
  }, [copyState]);
  useEffect(() => { if (copyState === "manual") manualLink.current?.select(); }, [copyState]);
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}${articlePath(article)}`); setCopyState("copied"); }
    catch { setCopyState("manual"); }
  }
  return <main id="learn-main" className="learn-reader"><div className="learn-container"><nav className="learn-breadcrumb" aria-label="面包屑"><a href="/">首页</a><span>/</span><a href={LEARNING_PATH}>ETF 学习</a><span>/</span><span>{article.category}</span></nav>
    <header className="learn-article-heading"><span className="learn-eyebrow">第 {String(article.number).padStart(2, "0")} 篇 · {article.category} <span className="learn-reading-time">/ 约 {stats.approximateWords.toLocaleString("zh-CN")} 字 · {stats.minutes} 分钟</span></span><h1>{article.title}<span>{article.subtitle}</span></h1><p>{article.lead}</p><div className="learn-article-meta"><span>更新于 <time dateTime={article.updatedAt}>{article.updatedAt}</time></span><button type="button" onClick={copyLink}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 15 6-6m-7 4-2 2a4.2 4.2 0 0 0 6 6l3-3m1-7 2-2a4.2 4.2 0 0 0-6-6L9 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>{copyState === "copied" ? "链接已复制" : "复制文章链接"}</button><span className="learn-sr-only" role="status">{copyState === "copied" ? "文章链接已复制" : ""}</span></div>{copyState === "manual" && <label className="learn-copy-fallback">浏览器未允许自动复制，可选择下方链接手动复制：<input ref={manualLink} value={`${window.location.origin}${articlePath(article)}`} readOnly/></label>}</header>
  </div><div className="learn-article-band"><div className="learn-container learn-reading-grid"><article className="learn-prose" aria-label={`${article.title}${article.subtitle}`}>
    <details ref={mobileToc} className="learn-mobile-toc"><summary>本文目录 <span>{article.sections.length} 个章节</span><svg className="learn-toc-chevron" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></summary><TableOfContents article={article} activeId={activeId} onSelect={() => { if (mobileToc.current) mobileToc.current.open = false; }}/></details>
    {article.sections.map((section, index) => <section id={section.id} key={section.id} className="learn-prose-section"><h2><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</h2>{section.blocks.map((block, blockIndex) => <ArticleBlock key={blockIndex} block={block}/>)}</section>)}
    <section className="learn-takeaway"><span className="learn-eyebrow">一句话记住</span><h2>{article.takeaway || "ETF 是载体，指数是规则，持仓才是内容。"}</h2><p>{article.takeawayText || "理解这三者的关系，比先记住一个产品代码更重要。"}</p></section>
    <details className="learn-sources"><summary>资料来源与说明 <span>本篇引用 · {sources.length} 项</span></summary><p>资料核验于 {article.updatedAt}，各数据所属日期和口径见正文。规则可能更新，具体产品以最新文件为准。标注为虚构的案例与概念图仅用于教学，不是真实行情。</p><ol>{sources.map((source) => <li key={source.id} value={ARTICLE_SOURCES.findIndex((item) => item.id === source.id) + 1}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a></li>)}</ol><p>本文以《纳指 / 标普投资白皮书》为学习线索，补充产品、投资者教育资料和明确标注的历史统计。内容仅作知识介绍，不构成投资建议。</p></details>
    <section className="learn-use-tools"><h2>把概念和实际产品放在一起看</h2><p>先核对跟踪目标，再看对应产品的额度和交易价格。</p><div><a href="/nasdaq">查看纳指基金 <Arrow/></a><a href="/sp500">查看标普基金 <Arrow/></a><a href="/today/etf-premium">查看 ETF 溢价 <Arrow/></a></div></section>
    <nav className="learn-article-pagination" aria-label="上一篇与下一篇">{previous && <a href={articlePath(previous)}><span>上一篇 · {String(previous.number).padStart(2, "0")}</span><strong><Arrow direction="left"/>{previous.title}</strong></a>}{next && <a href={articlePath(next)} className="learn-next-article"><span>下一篇 · {String(next.number).padStart(2, "0")}</span><strong>{next.title}<Arrow/></strong></a>}</nav>
    <div className="learn-reader-end"><a className="learn-text-link" href={LEARNING_PATH}><Arrow direction="left"/> 返回学习目录</a><span>{next ? "按顺序继续，也可以回目录选择主题。" : "九篇学习完成，回到目录复习或核验实际产品。"}</span></div>
  </article><aside className="learn-toc"><div className="learn-toc-sticky"><TableOfContents article={article} activeId={activeId}/><div className="learn-toc-tools"><span>边学边看</span><a href="/nasdaq">查看纳指基金 <Arrow/></a><a href="/sp500">查看标普基金 <Arrow/></a></div></div></aside></div></div><div className="learn-container"><BookBand/></div></main>;
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
    upsert('link[rel="canonical"]', "link", { rel: "canonical", href: `${SITE_ORIGIN}${page?.path || LEARNING_PATH}` });
    for (const property of ["og:title", "og:description", "og:url", "og:type", "og:image"]) {
      const value = { "og:title": document.title, "og:description": page?.description || "", "og:url": `${SITE_ORIGIN}${page?.path || LEARNING_PATH}`, "og:type": isIndex ? "website" : "article", "og:image": `${SITE_ORIGIN}${page?.article?.cover.src || BASKET_IMAGE.src}` }[property];
      upsert(`meta[property="${property}"]`, "meta", { property, content: value });
    }
    const script = document.head.querySelector("script[data-wise-learning]") || document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.learning = "true";
    if (page) { script.textContent = JSON.stringify(learningStructuredData(page, SITE_ORIGIN)); document.head.appendChild(script); }
    return () => script.remove();
  }, [page, isIndex]);
  return <div className={`etf-learning${isIndex ? " is-learning-index" : ""}`}><a className="learn-skip" href="#learn-main">跳到正文</a><LearningHeader/>{page ? (isIndex ? <LearningIndex/> : <ArticleReader key={page.article.slug} article={page.article}/>) : <main id="learn-main" className="learn-container learn-not-found"><span className="learn-eyebrow">ETF 学习</span><h1>没有找到这篇文章</h1><p>你可以返回学习目录，阅读九篇完整教程。</p><a href={LEARNING_PATH} className="learn-button">返回学习目录 <Arrow/></a></main>}<LearningFooter/></div>;
}
