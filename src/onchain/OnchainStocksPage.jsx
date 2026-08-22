import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./onchain-stocks.css";

const BITGET_GUIDE = "https://www.wise-invest.org/articles/crypto/k3RVVcw4";
const BINANCE_GUIDE = "https://www.wise-invest.org/articles/crypto/GaM38JYk";
const BITGET_SOURCE = "https://www.bitget.com/academy/what-is-bitget-rtoken-tokenized-us-stocks-with-usdt-how-it-works";
const BINANCE_SOURCE = "https://www.bnbchain.org/en/blog/introducing-bstocks-on-bnb-chain-trade-24-7-with-zero-fees-deploy-across-defi-protocols-with-full-self-custody";

const ROUTES = [
  { key: "otc", name: "场外 QDII", color: "#7b87a1" },
  { key: "exchange", name: "场内 ETF", color: "#f2a43a" },
  { key: "onchain", name: "链上现货", color: "#16ad8b" },
];

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 6l6 6-6 6"/></svg>;
}

function SummaryIcon({ type }) {
  const paths = {
    quota: <><path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4M10 16h2"/><path d="m4 5 16 14"/></>,
    premium: <><path d="M4 19V5M4 19h16"/><path d="m7 14 4-4 3 2 5-6"/><path d="M16 6h3v3"/></>,
    stablecoin: <><circle cx="12" cy="12" r="9"/><path d="M8 9h8M8 15h8M12 6v12"/></>,
    products: <><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
}

function money(value) {
  return Math.round(value).toLocaleString("zh-CN");
}

function buildScenario({ monthly, years, otcCap, premium, onchainBuyFee }) {
  const months = years * 12;
  const balances = { otc: 0, exchange: 0, onchain: 0, target: 0 };
  const data = [{ month: 0, otc: 0, exchange: 0, onchain: 0, otcGap: 0, exchangeGap: 0, onchainGap: 0 }];
  const monthlyRate = annualCost => (1 + 0.08 - annualCost) ** (1 / 12) - 1;
  for (let month = 1; month <= months; month += 1) {
    balances.target = (balances.target + monthly) * (1 + monthlyRate(0));
    balances.otc = (balances.otc + Math.min(monthly, otcCap) * (1 - 0.0015)) * (1 + monthlyRate(0.008));
    balances.exchange = (balances.exchange + monthly * (1 - 0.001 - premium / 100)) * (1 + monthlyRate(0.006));
    balances.onchain = (balances.onchain + monthly * (1 - onchainBuyFee / 100)) * (1 + monthlyRate(0.0003));
    data.push({
      month,
      otc: balances.otc,
      exchange: balances.exchange,
      onchain: balances.onchain,
      otcGap: balances.target - balances.otc,
      exchangeGap: balances.target - balances.exchange,
      onchainGap: balances.target - balances.onchain,
    });
  }
  return { data, final: data[data.length - 1], months, planned: monthly * months };
}

function ChartTooltip({ active, payload, label, suffix = "" }) {
  if (!active || !payload?.length) return null;
  return <div className="oc-tooltip"><strong>{label === 0 ? "开始" : "第 " + label + " 个月"}</strong>{payload.map(item => <span key={item.dataKey}><i style={{ background: item.color }}/>{item.name}<b>¥{money(item.value)}{suffix}</b></span>)}</div>;
}

function ScenarioControl({ label, value, hint, children }) {
  return <div className="oc-control"><div><span>{label}</span><strong>{value}</strong></div>{children}<small>{hint}</small></div>;
}

export default function OnchainStocksPage() {
  const [monthly, setMonthly] = useState(1000);
  const [years, setYears] = useState(5);
  const [otcCap, setOtcCap] = useState(200);
  const [premium, setPremium] = useState(1.5);
  const [onchainBuyFee, setOnchainBuyFee] = useState(0.1);
  const [imagePreview, setImagePreview] = useState(null);
  const scenario = useMemo(() => buildScenario({ monthly, years, otcCap, premium, onchainBuyFee }), [monthly, years, otcCap, premium, onchainBuyFee]);
  const { final } = scenario;
  const moreExposure = final.onchain - final.otc;
  const tickMonths = Array.from({ length: years + 1 }, (_, index) => index * 12);

  useEffect(() => {
    if (!imagePreview) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = event => event.key === "Escape" && setImagePreview(null);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [imagePreview]);

  return <>
  <div className="oc-page">
    <section className="oc-hero">
      <div className="oc-hero-copy">
        <span className="oc-kicker">TOKENIZED ETF · 新增路径</span>
        <h1>QDII 限购时，<br/>定投还有<span>第三条路</span></h1>
        <p>场外可能买不够，场内可能买得贵。对于已经持有 USDT 的用户，代币化 ETF 现货正在成为一条可以认真比较的购买路径。</p>
        <a href="#decision-lab">打开定投实验室 <ArrowIcon/></a>
      </div>
      <div className="oc-hero-metrics">
        <div><strong>不限境内额度</strong><span>不占用 QDII 申购额度</span></div>
        <div><strong>没有境内溢价</strong><span>不为 A 股场内溢价买单</span></div>
        <div><strong>USDT</strong><span>已有稳定币可直接购买</span></div>
        <div><strong>1 : 1</strong><span>产品以真实证券支持为目标</span></div>
      </div>
    </section>

    <section className="oc-conclusion">
      <div className="oc-conclusion-copy">
        <span>结论先行</span>
        <h2>不必把传统 QDII<br/>当成唯一答案</h2>
        <p>当场外产品限购、暂停申购，或者场内 ETF 出现高溢价时，用户已经可以用 USDT 比较链上的 QQQ 与标普 500 ETF 敞口。链上美股正在从“概念”走向可以被理解、计算和选择的产品阶段。</p>
        <div className="oc-tickers"><b>rQQQ</b><b>rVOO</b><b>rSPY</b><b>QQQB</b></div>
      </div>
      <div className="oc-conclusion-points">
        <article><i><SummaryIcon type="quota"/></i><div><strong>绕开境内申购额度</strong><p>场外买不进去时，不必一直等待额度恢复。</p></div></article>
        <article><i><SummaryIcon type="premium"/></i><div><strong>不承担境内 ETF 溢价</strong><p>不需要为了建立仓位额外支付 A 股场内溢价。</p></div></article>
        <article><i><SummaryIcon type="stablecoin"/></i><div><strong>已有 USDT 可直接使用</strong><p>减少换汇、跨账户划转和等待入金的路径。</p></div></article>
        <article><i><SummaryIcon type="products"/></i><div><strong>产品已经可以比较</strong><p>费用、支持结构、流动性与平台风险都可以逐项核对。</p></div></article>
      </div>
      <p className="oc-conclusion-note">这不意味着链上产品天然更优，而是传统 QDII、场内 ETF 和链上现货现在已经可以放进同一张选择表里。</p>
    </section>

    <section className="oc-lab" id="decision-lab">
      <div className="oc-lab-head">
        <div><span>五年定投实验室</span><h2>先看多少钱真正进入了指数仓位</h2></div>
        <p>所有结果均为<strong>人民币等值</strong>；链上投入理解为按当期汇率换成等值 USDT。三条路径使用相同的 8% 年化毛收益假设。</p>
      </div>

      <div className="oc-controls">
        <ScenarioControl label="每月计划投入" value={"¥" + money(monthly)} hint="统一使用人民币等值">
          <div className="oc-segment">{[500, 1000, 3000].map(value => <button key={value} className={monthly === value ? "is-active" : ""} onClick={() => { setMonthly(value); setOtcCap(Math.min(value, otcCap)); }}>¥{money(value)}</button>)}</div>
        </ScenarioControl>
        <ScenarioControl label="投资期限" value={years + " 年"} hint={"共 " + years * 12 + " 次计划投入"}>
          <div className="oc-segment">{[5, 10].map(value => <button key={value} className={years === value ? "is-active" : ""} onClick={() => setYears(value)}>{value} 年</button>)}</div>
        </ScenarioControl>
        <ScenarioControl label="场外每月可买" value={"¥" + money(otcCap)} hint="直接调节额度，观察仓位缺口">
          <input type="range" min="0" max={monthly} step="50" value={otcCap} onChange={event => setOtcCap(Number(event.target.value))}/>
        </ScenarioControl>
        <ScenarioControl label="场内买入溢价" value={premium.toFixed(1) + "%"} hint="另计示例佣金 0.10%">
          <input type="range" min="0" max="5" step="0.1" value={premium} onChange={event => setPremium(Number(event.target.value))}/>
        </ScenarioControl>
        <ScenarioControl label="链上买入费" value={onchainBuyFee.toFixed(2) + "%"} hint="底层 ETF 年费示例 0.03%">
          <input type="range" min="0" max="0.5" step="0.05" value={onchainBuyFee} onChange={event => setOnchainBuyFee(Number(event.target.value))}/>
        </ScenarioControl>
      </div>

      <div className="oc-lab-summary">
        <div><span>计划投入</span><strong>¥{money(scenario.planned)}</strong><small>{scenario.months} 个月</small></div>
        <div><span>场外最终指数仓位</span><strong>¥{money(final.otc)}</strong><small>受每月可买额度影响</small></div>
        <div><span>场内最终指数仓位</span><strong>¥{money(final.exchange)}</strong><small>包含溢价与费用示例</small></div>
        <div className="is-best"><span>链上最终指数仓位</span><strong>¥{money(final.onchain)}</strong><small>示例中多建立 ¥{money(moreExposure)} 仓位</small></div>
      </div>

      <div className="oc-chart-grid">
        <article className="oc-chart-card">
          <div className="oc-chart-title"><div><span>01</span><h3>有效指数仓位增长</h3></div><p>纵轴：人民币等值</p></div>
          <div className="oc-legend">{ROUTES.map(route => <span key={route.key}><i style={{ background: route.color }}/>{route.name}</span>)}</div>
          <div className="oc-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={scenario.data} margin={{ top: 10, right: 12, left: 6, bottom: 0 }}><CartesianGrid stroke="#e8eaf1" strokeDasharray="4 5" vertical={false}/><XAxis dataKey="month" ticks={tickMonths} tickFormatter={value => value === 0 ? "开始" : value / 12 + "年"} tick={{ fill: "#7c8598", fontSize: 12 }} axisLine={false} tickLine={false}/><YAxis width={58} tickFormatter={value => Math.round(value / 1000) + "k"} tick={{ fill: "#7c8598", fontSize: 12 }} axisLine={false} tickLine={false}/><Tooltip content={<ChartTooltip/>}/>{ROUTES.map(route => <Line key={route.key} type="monotone" dataKey={route.key} name={route.name} stroke={route.color} strokeWidth={route.key === "onchain" ? 3.5 : 2.5} dot={false} activeDot={{ r: 5 }}/>)}</LineChart></ResponsiveContainer></div>
          <p className="oc-chart-foot">场外未投入的部分仍然是现金，并非本金损失；这张图衡量的是实际建立的指数敞口。</p>
        </article>

        <article className="oc-chart-card">
          <div className="oc-chart-title"><div><span>02</span><h3>相对计划的仓位缺口</h3></div><p>未投入金额与路径费用共同造成</p></div>
          <div className="oc-legend">{ROUTES.map(route => <span key={route.key}><i style={{ background: route.color }}/>{route.name}</span>)}</div>
          <div className="oc-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={scenario.data} margin={{ top: 10, right: 12, left: 6, bottom: 0 }}><defs>{ROUTES.map(route => <linearGradient key={route.key} id={"gap-" + route.key} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={route.color} stopOpacity=".25"/><stop offset="100%" stopColor={route.color} stopOpacity=".02"/></linearGradient>)}</defs><CartesianGrid stroke="#e8eaf1" strokeDasharray="4 5" vertical={false}/><XAxis dataKey="month" ticks={tickMonths} tickFormatter={value => value === 0 ? "开始" : value / 12 + "年"} tick={{ fill: "#7c8598", fontSize: 12 }} axisLine={false} tickLine={false}/><YAxis width={58} tickFormatter={value => Math.round(value / 1000) + "k"} tick={{ fill: "#7c8598", fontSize: 12 }} axisLine={false} tickLine={false}/><Tooltip content={<ChartTooltip/>}/>{ROUTES.map(route => <Area key={route.key} type="monotone" dataKey={route.key + "Gap"} name={route.name} stroke={route.color} fill={"url(#gap-" + route.key + ")"} strokeWidth={route.key === "onchain" ? 3 : 2} />)}</AreaChart></ResponsiveContainer></div>
          <p className="oc-chart-foot">这里的“缺口”不是亏损，而是相对每月足额、无摩擦投入时少形成的指数仓位。</p>
        </article>
      </div>
    </section>

    <section className="oc-paths">
      <div className="oc-heading"><span>三条路径的差异</span><h2>同一个指数，钱卡在不同的位置</h2><p>链上路径的意义不是创造更高的市场收益，而是减少额度和溢价带来的路径摩擦。</p></div>
      <div className="oc-path-grid">
        <article><span className="oc-path-no">01</span><h3>场外 QDII</h3><strong>最大问题：计划金额可能投不进去</strong><p>部分产品每天只允许申购 10 元或 50 元，也可能暂停申购。除此以外还存在申购费和持续运作费。</p><div><b>额度限制</b><b>申购费用</b><b>运作费率</b></div></article>
        <article><span className="oc-path-no">02</span><h3>场内 QDII ETF</h3><strong>最大问题：可以买，但可能买贵</strong><p>二级市场通常可以成交，但价格可能高于参考净值。溢价回落时，额外支付的部分会直接侵蚀收益。</p><div><b>场内溢价</b><b>交易佣金</b><b>运作费率</b></div></article>
        <article className="is-onchain"><span className="oc-path-no">03</span><h3>USDT 代币化现货</h3><strong>核心价值：一次买入，路径更直接</strong><p>不占用境内 QDII 额度，也没有境内场内 ETF 溢价。主要显性成本集中在现货买入费和底层 ETF 费率。</p><div><b>USDT 购买</b><b>1:1 支持</b><b>小额持续投入</b></div></article>
      </div>
    </section>

    <section className="oc-platforms">
      <div className="oc-heading"><span>链上现货入口</span><h2>不是概念，产品已经可以被理解和比较</h2><p>这里暂时只提供产品教育与教程，不接入购买按钮。</p></div>
      <div className="oc-platform-grid">
        <article>
          <div className="oc-brand"><img src="/brands/bitget-wallet.jpeg" alt="Bitget"/><div><span>Bitget · rToken</span><h3>rQQQ · rVOO · rSPY</h3></div></div>
          <p>代码前加小写 r，使用 USDT 购买。官方将其描述为 Reality Protocol 发行、以真实股票或 ETF 进行 1:1 支持的代币化敞口。</p>
          <div className="oc-facts"><span><small>计价</small>USDT</span><span><small>结构</small>1:1 支持</span><span><small>产品</small>rQQQ / rVOO</span></div>
          <div className="oc-links"><a href={BITGET_GUIDE} target="_blank" rel="noopener noreferrer">查看教程 <ArrowIcon/></a><a href={BITGET_SOURCE} target="_blank" rel="noopener noreferrer">官方说明</a></div>
          <figure className="oc-buy-guide">
            <figcaption><span>购买方式</span><small>搜索 rQQQ → 查看行情 → 买入</small></figcaption>
            <button type="button" onClick={() => setImagePreview({ src: "/onchain/bitget-rqqq-buy-guide.png", title: "Bitget · rQQQ 购买方式", steps: "搜索 rQQQ → 查看行情 → 买入" })} aria-label="预览 Bitget rQQQ 完整购买步骤图">
              <img src="/onchain/bitget-rqqq-buy-guide.png" alt="Bitget rQQQ 搜索、查看行情和买入的三步操作示意"/>
            </button>
          </figure>
        </article>
        <article>
          <div className="oc-brand"><img src="/brands/binance.jpeg" alt="Binance"/><div><span>Binance · bStocks</span><h3>QQQB · USDT</h3></div></div>
          <p>代码后加 B，所以是 QQQB，不是 BQQQ。官方 2026 年 7 月 2 日清单可以确认 QQQB/USDT，其他产品以实时列表为准。</p>
          <div className="oc-facts"><span><small>计价</small>USDT</span><span><small>网络</small>BNB Chain</span><span><small>产品</small>QQQB</span></div>
          <div className="oc-links"><a href={BINANCE_GUIDE} target="_blank" rel="noopener noreferrer">查看教程 <ArrowIcon/></a><a href={BINANCE_SOURCE} target="_blank" rel="noopener noreferrer">官方说明</a></div>
          <figure className="oc-buy-guide is-binance">
            <figcaption><span>购买方式</span><small>搜索 QQQB → 查看行情 → 买入</small></figcaption>
            <button type="button" onClick={() => setImagePreview({ src: "/onchain/binance-qqqb-buy-guide.png", title: "Binance · QQQB 购买方式", steps: "搜索 QQQB → 查看行情 → 买入" })} aria-label="预览币安 QQQB 完整购买步骤图">
              <img src="/onchain/binance-qqqb-buy-guide.png" alt="币安 QQQB 搜索、查看行情和买入的三步操作示意"/>
            </button>
          </figure>
        </article>
      </div>
    </section>

    <section className="oc-risk"><div><strong>路径更短，不等于风险消失</strong><p>代币化产品不等同于在传统券商账户中直接登记持有证券。除买入费外，仍可能存在点差、底层 ETF 费率、提现或链上费用，并承担发行人、托管、平台、智能合约、稳定币及地区监管风险。</p></div><span>以上模型仅用于说明路径差异，不构成收益预测或投资建议。</span></section>

  </div>
  {imagePreview && createPortal(<div className="oc-image-modal" onMouseDown={event => event.target === event.currentTarget && setImagePreview(null)}>
      <div className="oc-image-dialog" role="dialog" aria-modal="true" aria-label={imagePreview.title}>
        <div className="oc-image-dialog-head"><div><strong>{imagePreview.title}</strong><span>{imagePreview.steps}</span></div><button type="button" onClick={() => setImagePreview(null)} aria-label="关闭图片预览">×</button></div>
        <img src={imagePreview.src} alt={imagePreview.title}/>
      </div>
    </div>, document.body)}
  </>;
}
