import { useEffect, useMemo, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import catalog from "../../catalog/products.v1.json";
import {
  categoryLabel,
  extractProductRows,
  mergeProductData,
  productRoute,
  subscriptionState,
} from "../product/product-detail-model.js";
import { sortTodayRows } from "./today-data-model.js";
import "./today-data.css";

const SITE_ORIGIN = "https://wise-etf.com";
const PAGE_META = {
  limits: {
    path: "/today/qdii-limits",
    eyebrow: "QDII PURCHASE STATUS",
    title: "今日 QDII 申购额度",
    description: "查看纳指、标普500和美股主动QDII基金今天是否开放申购、每日限额及数据日期。额度获取失败时明确显示待确认，不使用旧额度冒充当前状态。",
  },
  premium: {
    path: "/today/etf-premium",
    eyebrow: "ETF PREMIUM WATCH",
    title: "今日场内 ETF 溢价",
    description: "查看纳指与标普500场内ETF最新收盘溢价率、场内涨跌、成交额及净值日期，识别高溢价风险。",
  },
};

const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const percent = (value) => hasNumber(value) ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%` : "—";

function setMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement(selector.startsWith("link") ? "link" : "meta");
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
}

function useTodayMetadata(kind) {
  useEffect(() => {
    const meta = PAGE_META[kind];
    const url = `${SITE_ORIGIN}${meta.path}`;
    document.title = `${meta.title} · WiseETF`;
    setMeta('meta[name="description"]', { name: "description", content: meta.description });
    setMeta('meta[property="og:title"]', { property: "og:title", content: `${meta.title} · WiseETF` });
    setMeta('meta[property="og:description"]', { property: "og:description", content: meta.description });
    setMeta('meta[property="og:url"]', { property: "og:url", content: url });
    setMeta('link[rel="canonical"]', { rel: "canonical", href: url });
    let structured = document.head.querySelector(`script[data-wise-today="${kind}"]`);
    const created = !structured;
    if (!structured) {
      structured = document.createElement("script");
      structured.type = "application/ld+json";
      structured.dataset.wiseToday = kind;
      document.head.appendChild(structured);
    }
    structured.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: meta.title,
      description: meta.description,
      url,
      isPartOf: { "@type": "WebSite", name: "WiseETF", url: SITE_ORIGIN },
    });
    return () => { if (created) structured.remove(); };
  }, [kind]);
}

function stateLabel(row) {
  if (row.subscription_snapshot_status === "stale") {
    return { key: "stale", label: "历史参考", note: row.subscription_as_of ? `上次确认于 ${row.subscription_as_of}` : "不是今日状态" };
  }
  if (row.subscription_snapshot_status === "unavailable") {
    return { key: "unknown", label: "待确认", note: "本次未取得有效状态" };
  }
  const state = subscriptionState(row);
  if (state === "suspended") return { key: state, label: "暂停申购", note: "当前不可申购" };
  if (state === "limited") return { key: state, label: "限额申购", note: row.daily_limit || "额度以渠道为准" };
  if (state === "open") return { key: state, label: "开放申购", note: "未返回明确限额" };
  return { key: "unknown", label: "待确认", note: "本次未取得有效状态" };
}

function premiumRisk(row) {
  if (row.premium_snapshot_status === "stale") return { key: "stale", label: "历史参考" };
  if (row.premium_snapshot_status === "unavailable") return { key: "unknown", label: "待确认" };
  if (!hasNumber(row.premium)) return { key: "unknown", label: "待确认" };
  const value = Number(row.premium);
  if (value >= 3) return { key: "high", label: "高溢价" };
  if (value >= 1.5) return { key: "watch", label: "注意溢价" };
  if (value < 0) return { key: "discount", label: "折价" };
  return { key: "normal", label: "正常区间" };
}

function categoryKey(row, isLimits) {
  if (isLimits) return row.daily_board_category || row.categories?.[0] || "other";
  const index = `${row.tracking_index || ""} ${row.name || ""}`.toLowerCase();
  if (/纳斯达克|纳指|nasdaq/.test(index)) return "nasdaq";
  if (/标普|s&p|sp500|s&p 500/.test(index)) return "sp500";
  return "other";
}

function initialQueryState(name, fallback) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) || fallback;
}

function SortHeader({ field, activeField, direction, onSort, children }) {
  const active = field === activeField;
  return <button type="button" className={active ? "active" : ""} onClick={() => onSort(field)} aria-label={`${children}排序`}>
    <span>{children}</span><i>{active ? direction === "asc" ? "↑" : "↓" : "↕"}</i>
  </button>;
}

export default function TodayDataPage({ kind }) {
  const meta = PAGE_META[kind] || PAGE_META.limits;
  const isLimits = kind === "limits";
  useTodayMetadata(kind);
  const staticProducts = useMemo(
    () => catalog.products.filter((item) => isLimits ? item.product_type === "fund" : item.product_type === "etf"),
    [isLimits],
  );
  const [liveByCode, setLiveByCode] = useState({});
  const [dataset, setDataset] = useState({ status: "loading", source: null, asOf: null, error: null });
  const [filter, setFilter] = useState(() => initialQueryState("status", "all"));
  const [categoryFilter, setCategoryFilter] = useState(() => initialQueryState("category", "all"));
  const [query, setQuery] = useState(() => initialQueryState("q", ""));
  const [sortKey, setSortKey] = useState(() => initialQueryState("sort", isLimits ? "status" : "premium"));
  const [sortDirection, setSortDirection] = useState(() => initialQueryState("direction", isLimits ? "asc" : "desc"));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25000);
    const load = async () => {
      try {
        const response = await fetch("/api/daily-board", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const section = isLimits ? payload.funds : payload.etfs;
        const next = {};
        extractProductRows(section).forEach((row) => { next[row.code] = row; });
        if (!active) return;
        setLiveByCode(next);
        const source = typeof section?.source === "string"
          ? section.source
          : [...new Set(Object.values(section?.source || {}))].join(" / ");
        setDataset({
          status: section?.status || "unavailable",
          source,
          asOf: section?.as_of || null,
          expectedAsOf: isLimits ? payload.expected?.fund_subscription_date : payload.expected?.etf_close_date,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        setDataset({
          status: "unavailable",
          source: "catalog",
          asOf: catalog.metadata_as_of,
          expectedAsOf: null,
          error: error.name === "AbortError" ? "请求超时" : error.message,
        });
      }
    };
    load().finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isLimits]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (query.trim()) params.set("q", query.trim());
    const defaultSort = isLimits ? "status" : "premium";
    const defaultDirection = isLimits ? "asc" : "desc";
    if (sortKey !== defaultSort) params.set("sort", sortKey);
    if (sortDirection !== defaultDirection) params.set("direction", sortDirection);
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, [categoryFilter, filter, isLimits, query, sortDirection, sortKey]);

  const rows = useMemo(() => staticProducts.map((product) => mergeProductData(product, liveByCode[product.code])), [liveByCode, staticProducts]);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const matchesText = !needle || `${row.code} ${row.name} ${row.tracking_index || ""}`.toLowerCase().includes(needle);
      const matchesCategory = categoryFilter === "all" || categoryKey(row, isLimits) === categoryFilter;
      if (!matchesText || !matchesCategory) return false;
      if (filter === "all") return true;
      return isLimits ? stateLabel(row).key === filter : premiumRisk(row).key === filter;
    });
    return sortTodayRows(filtered, sortKey, sortDirection);
  }, [categoryFilter, filter, isLimits, query, rows, sortDirection, sortKey]);

  const counts = useMemo(() => rows.reduce((result, row) => {
    const key = isLimits ? stateLabel(row).key : premiumRisk(row).key;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {}), [isLimits, rows]);
  const filters = isLimits
    ? [["all", "全部"], ["open", "开放"], ["limited", "限额"], ["suspended", "暂停"], ["stale", "历史参考"], ["unknown", "待确认"]]
    : [["all", "全部"], ["high", "高溢价"], ["watch", "需注意"], ["normal", "正常"], ["discount", "折价"], ["stale", "历史参考"], ["unknown", "待确认"]];
  const categoryFilters = isLimits
    ? [["all", "全部类型"], ["nasdaq_passive", "纳指被动"], ["sp500_passive", "标普被动"], ["us_active", "美股主动"]]
    : [["all", "全部指数"], ["nasdaq", "纳指"], ["sp500", "标普500"], ["other", "其他"]];
  const sortOptions = isLimits
    ? [
        ["status:asc", "风险状态优先"], ["status:desc", "可申购优先"],
        ["limit:desc", "额度从高到低"], ["limit:asc", "额度从低到高"],
        ["rolling:desc", "近一年从高到低"], ["rolling:asc", "近一年从低到高"],
        ["date:desc", "数据日期从新到旧"], ["name:asc", "按产品名称"],
      ]
    : [
        ["premium:desc", "溢价从高到低"], ["premium:asc", "溢价从低到高"],
        ["change:desc", "场内涨幅从高到低"], ["change:asc", "场内涨幅从低到高"],
        ["turnover:desc", "成交额从高到低"], ["turnover:asc", "成交额从低到高"],
        ["date:desc", "数据日期从新到旧"], ["name:asc", "按产品名称"],
      ];
  const sortValue = `${sortKey}:${sortDirection}`;
  const sortLabel = sortOptions.find(([value]) => value === sortValue)?.[1] || "自定义排序";
  const sortBy = (field) => {
    if (sortKey === field) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(field);
    setSortDirection(["status", "name"].includes(field) ? "asc" : "desc");
  };
  const chooseSort = (event) => {
    const [field, direction] = event.target.value.split(":");
    setSortKey(field);
    setSortDirection(direction);
  };

  return (
    <div className="td-page">
      <header className="td-nav">
        <a href="/" className="td-brand"><b>W</b><span>Wise <em>ETF</em></span></a>
        <nav><a href="/today/qdii-limits" className={isLimits ? "active" : ""}>今日额度</a><a href="/today/etf-premium" className={!isLimits ? "active" : ""}>今日溢价</a><a href="/">完整数据</a></nav>
      </header>
      <main className="td-main">
        <section className="td-hero">
          <p>{meta.eyebrow}</p><h1>{meta.title}</h1><div>{meta.description}</div>
          <aside><span>{isLimits ? "覆盖场外基金" : "覆盖场内 ETF"}</span><strong>{rows.length}</strong><small>所有动态字段均保留数据日期</small></aside>
        </section>
        <section className={`td-dataset td-${dataset.status}`}>
          <span />
          <div><b>{dataset.status === "loading" ? "正在读取今日快照" : dataset.status === "fresh" ? "今日数据已载入" : dataset.status === "partial" ? "今日快照部分可用" : dataset.status === "stale" ? "当前仅有历史参考" : "今日快照暂不可用"}</b><small>{dataset.asOf ? `数据截至 ${dataset.asOf}` : "等待数据日期"}{dataset.expectedAsOf ? ` · 应更新至 ${dataset.expectedAsOf}` : ""}{dataset.source ? ` · ${dataset.source}` : ""}{dataset.error ? ` · ${dataset.error}` : ""}</small></div>
        </section>
        <section className="td-toolbar">
          <div className="td-filter-groups">
            <div className="td-filter-group"><span>范围</span><div className="td-filters">{categoryFilters.map(([key, label]) => <button type="button" key={key} className={categoryFilter === key ? "active" : ""} onClick={() => setCategoryFilter(key)}>{label}</button>)}</div></div>
            <div className="td-filter-group"><span>{isLimits ? "申购" : "溢价"}</span><div className="td-filters">{filters.map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}{key !== "all" && <small>{counts[key] || 0}</small>}</button>)}</div></div>
          </div>
          <div className="td-tools">
            <label className="td-sort"><span>排序</span><select value={sortValue} onChange={chooseSort}>{sortOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="td-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、代码或指数" /></label>
          </div>
        </section>
        <section className="td-table-wrap">
          <div className="td-table-heading"><div><h2>{isLimits ? "今日申购状态清单" : "ETF 溢价快照清单"}</h2><p>{isLimits ? "待确认不代表开放申购。" : "溢价必须同时结合场内价格日期与基金净值日期理解。"}</p></div><div className="td-result-meta"><strong>{visibleRows.length} 只</strong><small>{sortLabel}</small></div></div>
          <div className="td-table">
            <div className="td-row td-head">
              <SortHeader field="name" activeField={sortKey} direction={sortDirection} onSort={sortBy}>产品</SortHeader>
              <SortHeader field={isLimits ? "status" : "premium"} activeField={sortKey} direction={sortDirection} onSort={sortBy}>{isLimits ? "申购状态" : "溢价率"}</SortHeader>
              <SortHeader field={isLimits ? "limit" : "change"} activeField={sortKey} direction={sortDirection} onSort={sortBy}>{isLimits ? "每日额度" : "场内涨跌"}</SortHeader>
              <SortHeader field={isLimits ? "rolling" : "turnover"} activeField={sortKey} direction={sortDirection} onSort={sortBy}>{isLimits ? "近一年" : "当日成交"}</SortHeader>
              <SortHeader field="date" activeField={sortKey} direction={sortDirection} onSort={sortBy}>数据日期</SortHeader>
            </div>
            {visibleRows.map((row) => {
              const state = isLimits ? stateLabel(row) : premiumRisk(row);
              const date = isLimits ? row.subscription_as_of || row.nav_date : row.premium_as_of || row.quote_as_of || row.nav_as_of;
              return <a className="td-row" href={productRoute(row)} key={row.code}>
                <span className="td-product" data-label="产品"><b>{row.name}</b><small>{row.code} · {categoryLabel(row)}</small></span>
                <span data-label={isLimits ? "申购状态" : "溢价率"}><i className={`td-badge td-badge-${state.key}`}>{isLimits ? state.label : percent(row.premium)}</i><small>{isLimits ? state.note : state.label}</small></span>
                <span data-label={isLimits ? "每日额度" : "场内涨跌"}><b>{isLimits ? row.daily_limit || (state.key === "open" ? "未披露上限" : "—") : percent(row.market_change_pct ?? row.change_pct)}</b></span>
                <span data-label={isLimits ? "近一年" : "当日成交"}><b>{isLimits ? percent(row.rolling_1y) : hasNumber(row.turnover_cny_100m ?? row.volume) ? `${Number(row.turnover_cny_100m ?? row.volume).toFixed(2)}亿` : "—"}</b></span>
                <span data-label="数据日期"><small>{date || "待确认"}</small><em>查看详情 →</em></span>
              </a>;
            })}
            {visibleRows.length === 0 && <div className="td-empty"><b>没有符合当前条件的产品</b><p>可以清除筛选条件，或换一个名称、代码与指数关键词。</p><button type="button" onClick={() => { setFilter("all"); setCategoryFilter("all"); setQuery(""); }}>清除筛选</button></div>}
          </div>
        </section>
        <section className="td-explain">
          <article><span>01</span><h3>{isLimits ? "待确认不等于可以买" : "溢价不是额外收益"}</h3><p>{isLimits ? "只有上游明确返回开放、限额或暂停时才展示对应状态。接口失败时保留产品资料，但状态降级为待确认。" : "溢价表示场内价格高于对应净值。买入后即使指数不跌，溢价回落也可能造成损失。"}</p></article>
          <article><span>02</span><h3>{isLimits ? "额度可能随公告变化" : "必须检查两侧日期"}</h3><p>{isLimits ? "销售渠道、份额类别和单日累计规则可能不同，页面适合用于筛选，最终下单前仍需核对销售渠道。" : "场内价格与基金净值可能处于不同披露时点。WiseETF同时保留报价日期和净值日期，避免把错位数据当成实时IOPV。"}</p></article>
          <article><span>03</span><h3>找到替代路径</h3><p>{isLimits ? "场外额度不足时，可以比较同指数的其他份额、场内ETF以及链上代币化现货，而不是只盯着一只产品。" : "高溢价时不必追价，可以比较其他同指数ETF、等待溢价回落，或者选择场外及链上购买路径。"}</p></article>
        </section>
        <footer className="td-footer"><p>仅提供信息参考，不构成投资建议。动态数据获取失败时不会使用目录中的旧额度或旧溢价冒充今日值。</p><div><a href={isLimits ? "/today/etf-premium" : "/today/qdii-limits"}>查看{isLimits ? "今日溢价" : "今日额度"}</a><a href="/onchain">了解链上美股</a></div></footer>
      </main>
      <Analytics />
    </div>
  );
}
