import { useEffect, useMemo, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import catalog from "../../catalog/products.v1.json";
import { extractProductRows, mergeProductData, productRoute } from "../product/product-detail-model.js";
import { DECISION_PAGE_META, SITE_ORIGIN } from "../seo/seo-content.js";
import {
  buildPathSummary,
  INDEX_OPTIONS,
  isCoreIndexProduct,
  rankEtfCandidates,
  rankFundCandidates,
} from "./chooser-model.js";
import { calculateCostProjection } from "./cost-model.js";
import "./path-chooser.css";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const percent = (value) => finite(value) ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%` : "—";
const currency = (value) => `¥${Math.round(Number(value) || 0).toLocaleString("zh-CN")}`;

function queryValue(name, fallback) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) || fallback;
}

function queryNumber(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function updateMetadata() {
  const meta = DECISION_PAGE_META.chooser;
  document.title = meta.title;
  const url = `${SITE_ORIGIN}${meta.path}`;
  const values = [
    ['meta[name="description"]', "meta", { name: "description", content: meta.description }],
    ['meta[property="og:title"]', "meta", { property: "og:title", content: meta.title }],
    ['meta[property="og:description"]', "meta", { property: "og:description", content: meta.description }],
    ['meta[property="og:url"]', "meta", { property: "og:url", content: url }],
    ['link[rel="canonical"]', "link", { rel: "canonical", href: url }],
  ];
  values.forEach(([selector, tag, attributes]) => {
    let node = document.head.querySelector(selector);
    if (!node) { node = document.createElement(tag); document.head.appendChild(node); }
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  });
}

function CandidateCard({ item, path }) {
  const isEtf = path === "etf";
  const currentEtfPremium = ["low", "watch", "high"].includes(item.signal.key);
  const currentFundStatus = ["fit", "partial", "blocked"].includes(item.signal.key);
  return <a className="pc-candidate" href={productRoute(item)}>
    <div className="pc-candidate-top"><span>{item.code}</span><i className={`pc-signal pc-signal-${item.signal.key}`}>{item.signal.label}</i></div>
    <h3>{item.name}</h3>
    <div className="pc-candidate-metrics">
      <span><small>{isEtf ? "最新溢价" : "每日额度"}</small><b>{isEtf ? currentEtfPremium ? percent(item.premium) : "待确认" : currentFundStatus ? item.daily_limit || item.signal.label : "待确认"}</b></span>
      <span><small>运作费率</small><b>{finite(item.fee_rate) ? `${Number(item.fee_rate).toFixed(2)}%` : "—"}</b></span>
      <span><small>{isEtf ? "当日成交" : "跟踪误差"}</small><b>{isEtf ? finite(item.turnover_cny_100m ?? item.volume) ? `${Number(item.turnover_cny_100m ?? item.volume).toFixed(2)}亿` : "—" : finite(item.track_error) ? `${Number(item.track_error).toFixed(2)}%` : "—"}</b></span>
    </div>
    <div className="pc-score"><span>数据匹配</span><b>{item.dataScore}</b><i><em style={{ width: `${item.dataScore}%` }} /></i></div>
    <small className="pc-card-date">{isEtf ? item.premium_as_of || item.quote_as_of || "溢价日期待确认" : item.subscription_as_of || "额度日期待确认"}</small>
  </a>;
}

export default function PathChooserPage() {
  const [indexKey, setIndexKey] = useState(() => queryValue("index", "nasdaq"));
  const [amount, setAmount] = useState(() => Math.max(1, Number(queryValue("amount", "1000")) || 1000));
  const [mode, setMode] = useState(() => queryValue("mode", "monthly"));
  const [hasBroker, setHasBroker] = useState(() => queryValue("broker", "yes") !== "no");
  const [years, setYears] = useState(() => Math.max(1, queryNumber("years", 5)));
  const [grossReturn, setGrossReturn] = useState(() => queryNumber("return", 8));
  const [fundSubscriptionFee, setFundSubscriptionFee] = useState(() => queryNumber("subscribe_fee", 0.1));
  const [etfPremium, setEtfPremium] = useState(() => queryNumber("premium", 0.5));
  const [etfCommissionRate, setEtfCommissionRate] = useState(() => queryNumber("commission", 0.03));
  const [etfMinimumCommission, setEtfMinimumCommission] = useState(() => queryNumber("min_commission", 5));
  const [shareState, setShareState] = useState("idle");
  const [live, setLive] = useState({ funds: {}, etfs: {} });
  const [dataset, setDataset] = useState({ status: "loading", asOf: null, error: null });

  useEffect(() => { updateMetadata(); }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      index: indexKey, amount: String(amount), mode, broker: hasBroker ? "yes" : "no", years: String(years),
      return: String(grossReturn), subscribe_fee: String(fundSubscriptionFee), premium: String(etfPremium),
      commission: String(etfCommissionRate), min_commission: String(etfMinimumCommission),
    });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`);
  }, [amount, etfCommissionRate, etfMinimumCommission, etfPremium, fundSubscriptionFee, grossReturn, hasBroker, indexKey, mode, years]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    fetch("/api/daily-board", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((payload) => {
        if (!active) return;
        const funds = Object.fromEntries(extractProductRows(payload.funds).map((row) => [row.code, row]));
        const etfs = Object.fromEntries(extractProductRows(payload.etfs).map((row) => [row.code, row]));
        setLive({ funds, etfs });
        setDataset({
          status: payload.funds?.status === "fresh" && payload.etfs?.status === "fresh" ? "fresh" : "partial",
          asOf: [payload.funds?.as_of, payload.etfs?.as_of].filter(Boolean).join(" / ") || null,
          error: null,
        });
      })
      .catch((error) => {
        if (active) setDataset({ status: "unavailable", asOf: null, error: error.name === "AbortError" ? "请求超时" : error.message });
      })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, []);

  const products = useMemo(() => catalog.products.filter((product) => isCoreIndexProduct(product, indexKey)), [indexKey]);
  const funds = useMemo(() => rankFundCandidates(
    products.filter((product) => product.product_type === "fund").map((product) => mergeProductData(product, live.funds[product.code])),
    { amount },
  ), [amount, live.funds, products]);
  const etfs = useMemo(() => rankEtfCandidates(
    products.filter((product) => product.product_type === "etf").map((product) => mergeProductData(product, live.etfs[product.code])),
    { amount, hasBroker },
  ), [amount, hasBroker, live.etfs, products]);
  const summary = useMemo(() => buildPathSummary(funds, etfs, { hasBroker }), [etfs, funds, hasBroker]);
  const label = INDEX_OPTIONS[indexKey] || INDEX_OPTIONS.nasdaq;
  const topFund = funds[0] || null;
  const topEtf = etfs[0] || null;
  const fundAnnualFee = finite(topFund?.fee_rate) ? Number(topFund.fee_rate) : 0.8;
  const etfAnnualFee = finite(topEtf?.fee_rate) ? Number(topEtf.fee_rate) : 0.8;
  const projection = useMemo(() => calculateCostProjection({
    amount, years, mode, grossReturn, fundAnnualFee, etfAnnualFee, fundSubscriptionFee,
    etfPremium, etfCommissionRate, etfMinimumCommission, fundCandidate: topFund,
  }), [amount, etfAnnualFee, etfCommissionRate, etfMinimumCommission, etfPremium, fundAnnualFee, fundSubscriptionFee, grossReturn, mode, topFund, years]);
  const shareComparison = async () => {
    const text = `我用 WiseETF 比较了${label.shortLabel}场内外路径：${mode === "monthly" ? "每月" : "一次"}投入${currency(amount)}、${years}年；统一假设年化${grossReturn}%时，场外测算${currency(projection.totals.fundValue)}，场内测算${currency(projection.totals.etfValue)}。这只是数学演示，不构成投资建议。`;
    try {
      if (navigator.share) await navigator.share({ title: `${label.shortLabel}场内外路径比较`, text, url: window.location.href });
      else await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch (error) {
      if (error?.name !== "AbortError") setShareState("error");
    }
  };

  return <div className="pc-page">
    <header className="pc-nav">
      <a href="/" className="pc-brand"><b>W</b><span>Wise <em>ETF</em></span></a>
      <nav><a href="/today/qdii-limits">今日额度</a><a href="/today/etf-premium">今日溢价</a><a href="/">完整数据</a></nav>
    </header>
    <main className="pc-main">
      <section className="pc-hero">
        <div><p>ON-EXCHANGE OR OFF-EXCHANGE</p><h1>今天买{label.shortLabel}，<br/>场内还是场外？</h1><span>把申购额度、ETF 溢价、费率、跟踪误差和成交情况放到同一个页面比较。</span></div>
        <aside><b>不是“买入推荐”</b><p>结果是根据公开数据形成的路径筛选，帮助缩小范围；最终交易仍需核对实时价格、渠道额度和费用。</p></aside>
      </section>

      <section className="pc-controls" aria-label="比较条件">
        <label><span>跟踪指数</span><div className="pc-segment">{Object.entries(INDEX_OPTIONS).map(([key, item]) => <button type="button" className={indexKey === key ? "active" : ""} onClick={() => setIndexKey(key)} key={key}>{item.shortLabel}</button>)}</div></label>
        <label><span>{mode === "monthly" ? "每月计划投入" : "本次计划投入"}</span><div className="pc-amount"><i>¥</i><input type="number" min="1" max="10000000" value={amount} onChange={(event) => setAmount(Math.max(1, Number(event.target.value) || 1))}/></div></label>
        <label><span>投入方式</span><div className="pc-segment"><button type="button" className={mode === "monthly" ? "active" : ""} onClick={() => setMode("monthly")}>每月定投</button><button type="button" className={mode === "once" ? "active" : ""} onClick={() => setMode("once")}>一次投入</button></div></label>
        <label><span>证券账户</span><div className="pc-segment"><button type="button" className={hasBroker ? "active" : ""} onClick={() => setHasBroker(true)}>已有</button><button type="button" className={!hasBroker ? "active" : ""} onClick={() => setHasBroker(false)}>没有</button></div></label>
      </section>

      <section className={`pc-dataset pc-dataset-${dataset.status}`}><i/><div><b>{dataset.status === "loading" ? "正在读取今日额度与溢价" : dataset.status === "fresh" ? "今日两侧数据均已载入" : dataset.status === "partial" ? "部分动态数据需要确认" : "动态数据暂不可用"}</b><small>{dataset.asOf ? `数据日期 ${dataset.asOf}` : "低频资料仍可比较，动态字段不会使用旧值补位"}{dataset.error ? ` · ${dataset.error}` : ""}</small></div></section>

      <section className={`pc-summary pc-summary-${summary.key}`}>
        <div><span>本次筛选结论</span><h2>{summary.title}</h2><p>{summary.text}</p></div>
        <aside><small>比较对象</small><b>{funds.length} 只场外 · {etfs.length} 只场内</b></aside>
      </section>

      <section className="pc-cost">
        <header className="pc-cost-head">
          <div><span>LONG-TERM COST SIMULATION</span><h2>同样投入，路径摩擦会留下怎样的曲线？</h2><p>统一使用相同的标的毛收益假设，只比较额度、申购费、场内佣金、溢价与运作费率。</p></div>
          <div className="pc-year-picker"><small>测算周期</small><div>{[1,3,5,10].map((item) => <button type="button" className={years === item ? "active" : ""} onClick={() => setYears(item)} key={item}>{item}年</button>)}</div></div>
        </header>
        <div className="pc-cost-metrics">
          <div><small>计划投入本金</small><b>{currency(projection.totals.plannedPrincipal)}</b><span>{mode === "monthly" ? `${years * 12} 期` : "一次投入"}</span></div>
          <div><small>场外路径测算</small><b>{currency(projection.totals.fundValue)}</b><span>{topFund?.code || "参考路径"} · 年费 {fundAnnualFee.toFixed(2)}%</span></div>
          <div><small>场内路径测算</small><b>{currency(projection.totals.etfValue)}</b><span>{topEtf?.code || "参考路径"} · 年费 {etfAnnualFee.toFixed(2)}%</span></div>
          <div className={projection.totals.difference >= 0 ? "positive" : "negative"}><small>期末测算差额</small><b>{projection.totals.difference >= 0 ? "+" : "−"}{currency(Math.abs(projection.totals.difference))}</b><span>{projection.totals.difference >= 0 ? "场内测算较高" : "场外测算较高"}</span></div>
        </div>
        <div className="pc-cost-body">
          <div className="pc-chart">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={projection.data} margin={{ top: 16, right: 14, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 6" stroke="#e5eaf2" vertical={false}/>
                <XAxis dataKey="label" tick={{ fill: "#7b8799", fontSize: 10 }} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={(value) => value >= 10000 ? `${Math.round(value / 10000)}万` : String(value)} tick={{ fill: "#7b8799", fontSize: 10 }} axisLine={false} tickLine={false} width={42}/>
                <Tooltip formatter={(value, name) => [currency(value), name]} contentStyle={{ borderRadius: 12, border: "1px solid #dfe5ee", fontSize: 11 }}/>
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }}/>
                <Line type="monotone" dataKey="principal" name="累计计划本金" stroke="#a8b2c1" strokeWidth={2} strokeDasharray="5 5" dot={false}/>
                <Line type="monotone" dataKey="fund" name="场外基金" stroke="#1ba77a" strokeWidth={3} dot={false}/>
                <Line type="monotone" dataKey="etf" name="场内ETF" stroke="#3574e8" strokeWidth={3} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <aside className="pc-cost-notes">
            <div><small>额度影响</small><b>{projection.fundCapacity.label}</b>{projection.totals.fundUninvested > 0 && <p>按当前额度，计划中约有 {currency(projection.totals.fundUninvested)} 无法通过该场外产品投入。</p>}</div>
            <div><small>买入阶段摩擦</small><b>场外约 {currency(projection.totals.fundEntryCost)} · 场内约 {currency(projection.totals.etfEntryCost)}</b><p>这里只统计输入的申购费、佣金和买入溢价，不包含税费、价差、汇兑与卖出费用。</p></div>
            {!hasBroker && <div className="pc-account-note"><small>账户条件</small><b>场内曲线仅作假设比较</b><p>你当前选择了没有证券账户，因此场内路径暂时不能直接执行。</p></div>}
          </aside>
        </div>
        <details className="pc-assumptions">
          <summary>调整测算假设 <span>当前统一毛收益 {grossReturn}% · 场外申购费 {fundSubscriptionFee}% · 场内买入溢价 {etfPremium}%</span></summary>
          <div>
            <label><span>标的年化毛收益</span><div><input type="number" step="0.5" value={grossReturn} onChange={(event) => setGrossReturn(Number(event.target.value) || 0)}/><i>%</i></div></label>
            <label><span>场外申购费</span><div><input type="number" min="0" step="0.01" value={fundSubscriptionFee} onChange={(event) => setFundSubscriptionFee(Math.max(0, Number(event.target.value) || 0))}/><i>%</i></div></label>
            <label><span>场内买入溢价</span><div><input type="number" step="0.1" value={etfPremium} onChange={(event) => setEtfPremium(Number(event.target.value) || 0)}/><i>%</i></div></label>
            <label><span>佣金比例</span><div><input type="number" min="0" step="0.01" value={etfCommissionRate} onChange={(event) => setEtfCommissionRate(Math.max(0, Number(event.target.value) || 0))}/><i>%</i></div></label>
            <label><span>单笔最低佣金</span><div><input type="number" min="0" step="1" value={etfMinimumCommission} onChange={(event) => setEtfMinimumCommission(Math.max(0, Number(event.target.value) || 0))}/><i>元</i></div></label>
          </div>
          <p>这是可解释的纯数学演示，不预测指数收益。产品运作费率取当前候选的静态资料，其余假设由你调整。</p>
        </details>
        <div className="pc-share-row"><div><b>把本次条件保存下来</b><span>所有测算参数都会保留在链接中，方便下次复查或发给朋友。</span></div><button type="button" onClick={shareComparison}>{shareState === "done" ? "✓ 已复制结果" : shareState === "error" ? "复制失败，请重试" : "分享本次比较 →"}</button></div>
      </section>

      <section className="pc-paths">
        <article className="pc-path pc-fund-path">
          <header><div><span>场外路径</span><h2>QDII 场外基金</h2><p>重点看今天能否申购、额度能否覆盖本次投入，以及长期运作费率。</p></div><b>无需证券账户</b></header>
          <div className="pc-list">{funds.slice(0, 3).map((item) => <CandidateCard item={item} path="fund" key={item.code}/>)}</div>
          <a className="pc-more" href={`/today/qdii-limits?category=${indexKey === "nasdaq" ? "nasdaq_passive" : "sp500_passive"}&sort=limit&direction=desc`}>查看完整额度清单 →</a>
        </article>
        <article className="pc-path pc-etf-path">
          <header><div><span>场内路径</span><h2>QDII 场内 ETF</h2><p>重点看最新有效溢价、成交活跃度、运作费率，并在交易时核对实时价格。</p></div><b>需要证券账户</b></header>
          <div className="pc-list">{etfs.slice(0, 3).map((item) => <CandidateCard item={item} path="etf" key={item.code}/>)}</div>
          <a className="pc-more" href={`/today/etf-premium?category=${indexKey}&sort=premium&direction=asc`}>查看完整溢价清单 →</a>
        </article>
      </section>

      <section className="pc-method">
        <div><span>01</span><h3>先判断能不能买</h3><p>场外优先检查当日额度是否覆盖计划投入；状态待确认时，不把历史额度当成今天可用。</p></div>
        <div><span>02</span><h3>再判断买得贵不贵</h3><p>场内优先检查有效收盘溢价。高溢价可能在回落时形成额外损耗，盘中仍需核对实时价格。</p></div>
        <div><span>03</span><h3>最后比较长期摩擦</h3><p>同时查看运作费率、跟踪误差和流动性。数据匹配分只用于排序，不代表预期收益。</p></div>
      </section>
      <footer className="pc-footer"><p>仅提供公开信息整理和产品路径比较，不构成投资建议。申购状态、额度、溢价和成交额可能随日期及渠道变化。</p><a href="/">返回 WiseETF 首页</a></footer>
    </main>
    <Analytics />
  </div>;
}
