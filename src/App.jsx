import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Area, AreaChart, ReferenceLine, ComposedChart, Line } from "recharts";
import { Analytics } from "@vercel/analytics/react";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
async function apiFetch(path) {
  try { const r = await fetch(`${API_BASE}${path}`); if (r.ok) return await r.json(); } catch {}
  return null;
}

// ─── Static Data ──────────────────────────────────────────────────────────────
const FALLBACK = {
  nasdaq_passive: [
    { code:"019524",name:"华泰柏瑞纳斯达克100ETF联接(QDII)A",  fee_rate:0.65,scale:6.8,  ytd_return:16.66,track_error:1.65,daily_limit:"100元",  buy_status:"open",     code_c:"019525"},
    { code:"019547",name:"招商纳斯达克100ETF联接(QDII)A",      fee_rate:0.65,scale:15.8, ytd_return:16.22,track_error:1.72,daily_limit:"100元",  buy_status:"open",     code_c:"019548"},
    { code:"539001",name:"建信纳斯达克100指数QDIIA",            fee_rate:1.00,scale:13.2, ytd_return:16.21,track_error:2.17,daily_limit:"100元",  buy_status:"open",     code_c:"012752"},
    { code:"018966",name:"汇添富纳斯达克100ETF联接(QDII)A",    fee_rate:0.65,scale:11.3, ytd_return:15.49,track_error:2.08,daily_limit:"100元",  buy_status:"open",     code_c:"018967"},
    { code:"016452",name:"南方纳斯达克100指数(QDII)A",          fee_rate:0.65,scale:33.3, ytd_return:17.26,track_error:1.64,daily_limit:"50元",   buy_status:"open",     code_c:"016453"},
    { code:"000834",name:"大成纳斯达克100指数(QDII)A",          fee_rate:1.00,scale:38.8, ytd_return:16.76,track_error:1.51,daily_limit:"50元",   buy_status:"open",     code_c:"008971"},
    { code:"019172",name:"摩根纳斯达克100指数(QDII)A",          fee_rate:0.60,scale:26.1, ytd_return:17.66,track_error:2.15,daily_limit:"10元",   buy_status:"open",     code_c:"019173"},
    { code:"270042",name:"广发纳斯达克100ETF联接(QDII)",        fee_rate:1.00,scale:108.4,ytd_return:17.04,track_error:1.10,daily_limit:"10元",   buy_status:"open",     code_c:"006479"},
    { code:"019441",name:"万家纳斯达克100指数发起式(QDII)",     fee_rate:0.65,scale:5.0,  ytd_return:16.86,track_error:1.75,daily_limit:"10元",   buy_status:"open",     code_c:"019442"},
    { code:"161130",name:"易方达纳斯达克100ETF联接(QDII-LOF)A",fee_rate:0.60,scale:16.1, ytd_return:16.58,track_error:1.55,daily_limit:"10元",   buy_status:"open",     code_c:"012870"},
    { code:"040046",name:"华安纳斯达克100指数(QDII)",           fee_rate:0.80,scale:55.2, ytd_return:15.37,track_error:2.06,daily_limit:"10元",   buy_status:"open",     code_c:"014978"},
    { code:"160213",name:"国泰纳斯达克100指数(QDII)",           fee_rate:1.00,scale:18.6, ytd_return:17.58,track_error:1.03,daily_limit:"暂停申购",buy_status:"suspended",code_c:null},
    { code:"016055",name:"博时纳斯达克100ETF联接(QDII)A",       fee_rate:0.65,scale:15.6, ytd_return:17.32,track_error:1.52,daily_limit:"暂停申购",buy_status:"suspended",code_c:"016057"},
    { code:"018043",name:"天弘纳斯达克100指数(QDII)A",          fee_rate:0.60,scale:26.2, ytd_return:17.49,track_error:1.55,daily_limit:"暂停申购",buy_status:"suspended",code_c:"018044"},
    { code:"019736",name:"宝盈纳斯达克100指数(QDII)A",          fee_rate:0.65,scale:6.8,  ytd_return:17.19,track_error:1.55,daily_limit:"暂停申购",buy_status:"suspended",code_c:"019737"},
    { code:"016532",name:"嘉实纳斯达克100联接(QDII)A",          fee_rate:0.60,scale:21.1, ytd_return:16.4, track_error:1.60,daily_limit:"暂停申购",buy_status:"suspended",code_c:"016533"},
    { code:"015299",name:"华夏纳斯达克100ETF联接(QDII)A",       fee_rate:0.80,scale:3.8,  ytd_return:15.74,track_error:2.69,daily_limit:"暂停申购",buy_status:"suspended",code_c:"015300"},
    { code:"017091",name:"景顺长城纳斯达克科技市值加权ETF联接A", fee_rate:1.00,scale:25.8, ytd_return:24.22,track_error:3.11,daily_limit:"100元",  buy_status:"open",     code_c:"017093"},
  ],
  sp500_passive: [
    { code:"017641",name:"摩根标普500指数(QDII)A",           fee_rate:0.65,scale:31.6,ytd_return:11.75,track_error:2.57, daily_limit:"50元",   buy_status:"open",     code_c:"019305"},
    { code:"161125",name:"易方达标普500指数(QDII-LOF)A",     fee_rate:1.00,scale:14.7,ytd_return:11.74,track_error:2.39, daily_limit:"10元",   buy_status:"open",     code_c:"012860"},
    { code:"017028",name:"国泰标普500ETF联接(QDII)A",        fee_rate:0.75,scale:1.6, ytd_return:11.71,track_error:1.87, daily_limit:"暂停申购",buy_status:"suspended",code_c:"017030"},
    { code:"050025",name:"博时标普500ETF联接(QDII)A",        fee_rate:0.80,scale:67.6,ytd_return:12.14,track_error:1.31, daily_limit:"暂停申购",buy_status:"suspended",code_c:"006075"},
    { code:"007721",name:"天弘标普500(QDII-FOF)A",           fee_rate:0.80,scale:26.5,ytd_return:11.16,track_error:null, daily_limit:"暂停申购",buy_status:"suspended",code_c:"007722"},
    { code:"018064",name:"华夏标普500ETF联接(QDII)A",        fee_rate:0.75,scale:4.1, ytd_return:10.38,track_error:1.10, daily_limit:"暂停申购",buy_status:"suspended",code_c:"018065"},
    { code:"096001",name:"大成标普500等权重指数(QDII)A",     fee_rate:1.20,scale:6.1, ytd_return:7.17, track_error:1.69, daily_limit:"50元",   buy_status:"open",     code_c:"008401"},
    { code:"161128",name:"易方达标普信息科技指数(QDII-FOF)A",fee_rate:1.00,scale:36.8,ytd_return:22.13,track_error:10.85,daily_limit:"10元",   buy_status:"open",     code_c:null},
  ],
  us_active: [
    { code:"100055",name:"富国全球科技互联网股票(QDII)A",fee_rate:1.40,scale:10.2,ytd_return:37.81,daily_limit:"不限额",buy_status:"open"},
    { code:"016701",name:"银华海外数字经济量化选股混合(QDII)A",fee_rate:1.40,scale:11.2,ytd_return:27.21,daily_limit:"50000元",buy_status:"open"},
    { code:"005698",name:"华夏全球科技先锋混合(QDII)",fee_rate:1.40,scale:26.3,ytd_return:52.49,daily_limit:"10000元",buy_status:"open"},
    { code:"017144",name:"华宝海外新能源汽车股票(QDII)A",fee_rate:1.40,scale:2.6,ytd_return:24.08,daily_limit:"10000元",buy_status:"open"},
    { code:"270023",name:"广发全球精选股票(QDII)A",fee_rate:1.40,scale:104.5,ytd_return:32.39,daily_limit:"5000元",buy_status:"open"},
    { code:"008253",name:"华宝致远混合(QDII)A",fee_rate:1.40,scale:1.7,ytd_return:47.82,daily_limit:"3000元",buy_status:"open"},
    { code:"017436",name:"华宝纳斯达克精选股票(QDII)A",fee_rate:1.40,scale:46.2,ytd_return:26.08,daily_limit:"3000元",buy_status:"open"},
    { code:"501312",name:"华宝海外科技股票(QDII-FOF-LOF)A",fee_rate:1.20,scale:8.1,ytd_return:31.04,daily_limit:"2000元",buy_status:"open"},
    { code:"501226",name:"长城全球新能源汽车股票(QDII-LOF)A",fee_rate:1.40,scale:4.7,ytd_return:48.21,daily_limit:"1000元",buy_status:"open"},
    { code:"006555",name:"浦银安盛全球智能科技股票(QDII)A",fee_rate:1.40,scale:8.7,ytd_return:43.81,daily_limit:"500元",buy_status:"open"},
    { code:"017730",name:"嘉实全球产业升级股票(QDII)A",fee_rate:1.40,scale:7.2,ytd_return:75.36,daily_limit:"100元",buy_status:"open"},
    { code:"006373",name:"国富全球科技互联混合(QDII)人民币A",fee_rate:1.40,scale:24.3,ytd_return:53.48,daily_limit:"100元",buy_status:"open"},
    { code:"000043",name:"嘉实美国成长股票(QDII)",fee_rate:1.40,scale:50.1,ytd_return:20.01,daily_limit:"100元",buy_status:"open"},
    { code:"012920",name:"易方达全球成长精选混合(QDII)A",fee_rate:1.40,scale:28.3,ytd_return:107.95,daily_limit:"50元",buy_status:"open"},
    { code:"539002",name:"建信新兴市场优选混合(QDII)A",fee_rate:1.40,scale:4.6,ytd_return:92.11,daily_limit:"50元",buy_status:"open"},
  ],
  // 场内ETF — 名称经 fundgz 实测验证，premium 为实际市场水平
  etfs: [
    { code:"513100",name:"国泰纳斯达克100ETF",           tracking_index:"纳斯达克100",         scale:167.9,ytd_return:16.99,premium:4.94,volume:3.6, change_pct:0.0,fee_rate:0.80,track_error:1.07},
    { code:"513110",name:"华泰柏瑞纳斯达克100ETF",       tracking_index:"纳斯达克100",         scale:41.6, ytd_return:16.60,premium:3.32,volume:1.5, change_pct:0.0,fee_rate:1.00,track_error:1.04},
    { code:"159941",name:"广发纳斯达克100ETF",           tracking_index:"纳斯达克100",         scale:297.8,ytd_return:16.41,premium:4.35,volume:7.8, change_pct:0.0,fee_rate:1.00,track_error:1.03},
    { code:"513300",name:"华夏纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:112.5,ytd_return:14.72,premium:3.73,volume:3.1, change_pct:0.0,fee_rate:0.80,track_error:2.53},
    { code:"159659",name:"招商纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:79.3, ytd_return:17.42,premium:3.62,volume:1.3, change_pct:0.0,fee_rate:0.65,track_error:1.08},
    { code:"159632",name:"华安纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:97.8, ytd_return:16.28,premium:3.27,volume:1.9, change_pct:0.0,fee_rate:0.80,track_error:1.24},
    { code:"513870",name:"富国纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:20.2, ytd_return:17.41,premium:0.0, volume:0.0, change_pct:0.0,fee_rate:0.63,track_error:0.86},
    { code:"159696",name:"易方达纳斯达克100ETF(QDII)",   tracking_index:"纳斯达克100",         scale:39.7, ytd_return:17.37,premium:0.0, volume:0.0, change_pct:0.0,fee_rate:0.63,track_error:0.86},
    { code:"159660",name:"汇添富纳斯达克100ETF(QDII)",   tracking_index:"纳斯达克100",         scale:37.7, ytd_return:17.24,premium:0.0, volume:0.0, change_pct:0.0,fee_rate:0.66,track_error:0.88},
    { code:"159501",name:"嘉实纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:100.7,ytd_return:17.14,premium:0.0, volume:0.0, change_pct:0.0,fee_rate:0.61,track_error:0.86},
    { code:"513390",name:"博时纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:35.6, ytd_return:17.12,premium:0.0, volume:0.0, change_pct:0.0,fee_rate:0.69,track_error:0.91},
    { code:"159513",name:"大成纳斯达克100ETF(QDII)",     tracking_index:"纳斯达克100",         scale:59.7, ytd_return:16.50,premium:0.0, volume:0.0, change_pct:0.0,fee_rate:1.01,track_error:0.88},
    { code:"159509",name:"景顺长城纳斯达克科技ETF(QDII)", tracking_index:"纳斯达克科技市值加权",scale:123.3,ytd_return:27.55,premium:16.9,volume:5.3, change_pct:0.0,fee_rate:1.00,track_error:1.88},
    { code:"513500",name:"博时标普500ETF",               tracking_index:"标普500",             scale:223.2,ytd_return:13.89,premium:4.54,volume:2.3, change_pct:0.0,fee_rate:0.80,track_error:1.07},
    { code:"159612",name:"国泰标普500ETF(QDII)",         tracking_index:"标普500",             scale:7.9,  ytd_return:13.74,premium:4.63,volume:0.1, change_pct:0.0,fee_rate:0.75,track_error:1.01},
    { code:"513650",name:"南方标普500ETF(QDII)",         tracking_index:"标普500",             scale:46.8, ytd_return:13.82,premium:3.06,volume:1.0, change_pct:0.0,fee_rate:0.75,track_error:1.05},
  ],
};

// 过去12个月月度收益（来源：Yahoo Finance，2025-04 ~ 2026-03，美元口径，NDX/GSPC 月收盘价计算）
const MONTHLY_12M = [
  {month:"4月",  nasdaq: 1.52, sp500:-0.76},
  {month:"5月",  nasdaq: 9.04, sp500: 6.15},
  {month:"6月",  nasdaq: 6.27, sp500: 4.96},
  {month:"7月",  nasdaq: 2.38, sp500: 2.17},
  {month:"8月",  nasdaq: 0.85, sp500: 1.91},
  {month:"9月",  nasdaq: 5.40, sp500: 3.53},
  {month:"10月", nasdaq: 4.77, sp500: 2.27},
  {month:"11月", nasdaq:-1.64, sp500: 0.13},
  {month:"12月", nasdaq:-0.73, sp500:-0.05},
  {month:"1月",  nasdaq: 1.20, sp500: 1.37},
  {month:"2月",  nasdaq:-2.32, sp500:-0.87},
  {month:"3月",  nasdaq:-4.89, sp500:-5.09},
];

// ─── FX / Index Historical Data ───────────────────────────────────────────────
// USD/CNY 年末汇率（来源：中国外汇交易中心 / Wind 公开数据）
// 格式：[年初汇率, 年末汇率]
const FX_ANNUAL = {
  2015:[6.2078,6.4936], 2016:[6.4936,6.9448], 2017:[6.9448,6.5063],
  2018:[6.5063,6.8775], 2019:[6.8775,6.9762], 2020:[6.9762,6.5249],
  2021:[6.5249,6.3726], 2022:[6.3726,6.8972], 2023:[6.8972,7.1001],
  2024:[7.1001,7.2996], 2025:[7.2996,7.0059],
};
// 年度涨跌幅（来源：Slickcharts，纳指100价格口径，标普500总回报含股息，1990-2025）
const INDEX_ANNUAL = {
  nasdaq:{
    1990:-10.41,1991:64.99,1992:8.87,1993:10.58,1994:1.50,
    1995:42.54,1996:42.54,1997:20.63,1998:85.31,1999:101.95,
    2000:-36.84,2001:-32.65,2002:-37.58,2003:49.12,2004:10.44,
    2005:1.49,2006:6.79,2007:18.67,2008:-41.89,2009:53.54,
    2010:19.22,2011:2.70,2012:16.82,2013:34.99,2014:17.94,
    2015:8.43,2016:5.89,2017:31.52,2018:-1.04,2019:37.96,
    2020:47.58,2021:26.63,2022:-32.97,2023:53.81,2024:24.88,2025:20.17,
  },
  sp500:{
    1990:-3.10,1991:30.47,1992:7.62,1993:10.08,1994:1.32,
    1995:37.58,1996:22.96,1997:33.36,1998:28.58,1999:21.04,
    2000:-9.10,2001:-11.89,2002:-22.10,2003:28.68,2004:10.88,
    2005:4.91,2006:15.79,2007:5.49,2008:-37.00,2009:26.46,
    2010:15.06,2011:2.11,2012:16.00,2013:32.39,2014:13.69,
    2015:1.38,2016:11.96,2017:21.83,2018:-4.38,2019:31.49,
    2020:18.40,2021:28.71,2022:-18.11,2023:26.29,2024:25.02,2025:17.88,
  },
};

// 关键周期年化复合收益率 CAGR（来源：Slickcharts，截至2025年）
const INDEX_CAGR = {
  nasdaq:{ "36年\n1990-2025":14.03, "15年\n2011-2025":17.60, "10年\n2016-2025":18.58, "5年\n2021-2025":14.40 },
  sp500: { "36年\n1990-2025":10.80, "15年\n2011-2025":14.07, "10年\n2016-2025":14.82, "5年\n2021-2025":14.43 },
};

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg:"#f5f5f7", surface:"#ffffff", surfaceHover:"#f9f9fb",
  card:"#ffffff", border:"#e0e0e5", borderLight:"#ebebf0",
  text:"#1d1d1f", textMuted:"#6e6e73", textDim:"#aeaeb2",
  accent:"#0071e3", accentDim:"#005bbf", accentBg:"#0071e308",
  green:"#1a9e4a", greenBg:"#1a9e4a0d",
  red:"#d93025",   redBg:"#d930250d",
  orange:"#c4570a", orangeBg:"#c4570a0d",
  purple:"#6e3de8", purpleBg:"#6e3de80d",
  cyan:"#0077a8",  cyanBg:"#0077a80d",
};

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useCountUp(target, duration=900) {
  const [val, setVal] = useState(0);
  const raf = useRef(null);
  useEffect(()=>{
    const n = parseFloat(String(target).replace(/[^0-9.]/g,""))||0;
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = now => {
      const t = Math.min((now-start)/duration,1);
      const ease = 1-Math.pow(1-t,3);
      setVal(+(n*ease).toFixed(1));
      if(t<1) raf.current=requestAnimationFrame(tick);
    };
    raf.current=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf.current);
  },[target]);
  return val;
}

function useScrollReveal(threshold=0.12) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(()=>{
    const obs = new IntersectionObserver(([e])=>{
      if(e.isIntersecting){setVisible(true);obs.disconnect();}
    },{threshold});
    if(ref.current) obs.observe(ref.current);
    return ()=>obs.disconnect();
  },[]);
  return [ref, visible];
}

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window!=="undefined"?window.innerWidth:1280);
  useEffect(()=>{
    const h=()=>setWidth(window.innerWidth);
    window.addEventListener("resize",h,{passive:true});
    return ()=>window.removeEventListener("resize",h);
  },[]);
  return width;
}

function useHover() {
  const [hovered, setHovered] = useState(false);
  return [hovered, {onMouseEnter:()=>setHovered(true), onMouseLeave:()=>setHovered(false)}];
}

// ─── Base Card with hover lift ─────────────────────────────────────────────────
function Card({children, style={}, className="", onClick}) {
  const [h,hProps] = useHover();
  return (
    <div {...hProps} onClick={onClick}
      className={`lift-card ${className}`}
      style={{
        background:C.card, border:`1px solid ${C.border}`, borderRadius:18,
        boxShadow: h?"0 12px 40px rgba(0,0,0,0.11)":"0 2px 16px rgba(0,0,0,0.06)",
        transform: h?"translateY(-4px)":"translateY(0)",
        transition:"box-shadow 0.28s ease, transform 0.28s ease, border-color 0.28s ease",
        borderColor: h ? C.borderLight : C.border,
        cursor: onClick?"pointer":"default",
        ...style,
      }}>
      {children}
    </div>
  );
}

// ─── Reveal wrapper ───────────────────────────────────────────────────────────
function Reveal({children, delay=0}) {
  const [ref,vis] = useScrollReveal();
  return (
    <div ref={ref} style={{
      opacity: vis?1:0,
      transform: vis?"translateY(0)":"translateY(22px)",
      transition:`opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
    }}>
      {children}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({label,value,sub,color=C.accent,index=0}) {
  const numStr = String(value).replace(/[^0-9.]/g,"");
  const prefix = String(value).startsWith("+") ? "+" : "";
  const suffix = String(value).replace(/^[+\-]?[\d.]+/,"");
  const counted = useCountUp(numStr,900);
  const [h,hProps] = useHover();
  return (
    <div {...hProps} className="stat-card"
      style={{
        background:C.card, border:`1px solid ${h?C.borderLight:C.border}`,
        borderRadius:18, padding:"24px 28px", flex:1, minWidth:180,
        position:"relative", overflow:"hidden",
        boxShadow:h?"0 12px 40px rgba(0,0,0,0.10)":"0 2px 16px rgba(0,0,0,0.06)",
        transform:h?"translateY(-4px)":"translateY(0)",
        transition:"all 0.28s ease",
        animationDelay:`${index*0.08}s`,
      }}>
      <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",background:color+"08"}}/>
      <div style={{position:"absolute",bottom:0,left:0,height:2,width:h?"100%":"0%",background:`linear-gradient(90deg,${color},${color}60)`,transition:"width 0.4s ease",borderRadius:"0 0 0 18px"}}/>
      <div style={{fontSize:11,color:C.textDim,marginBottom:8,letterSpacing:0.8,textTransform:"uppercase",fontWeight:600}}>{label}</div>
      <div style={{fontSize:30,fontWeight:800,color,letterSpacing:-1}}>
        {prefix}{isNaN(parseFloat(numStr)) ? value : `${counted}${suffix}`}
      </div>
      {sub&&<div style={{fontSize:12,color:C.textMuted,marginTop:5}}>{sub}</div>}
    </div>
  );
}

// ─── SentimentCard ────────────────────────────────────────────────────────────
function SentimentCard({title, value, label, sub, color, barPct, index=0}) {
  const [h,hProps] = useHover();
  return (
    <div {...hProps} style={{
      background:C.card, border:`1px solid ${h?C.borderLight:C.border}`,
      borderRadius:18, padding:"20px 24px", flex:1, minWidth:200,
      position:"relative", overflow:"hidden",
      boxShadow:h?"0 12px 40px rgba(0,0,0,0.10)":"0 2px 16px rgba(0,0,0,0.06)",
      transform:h?"translateY(-4px)":"translateY(0)",
      transition:"all 0.28s ease",
      animationDelay:`${index*0.08}s`,
    }}>
      <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",background:color+"08"}}/>
      <div style={{position:"absolute",bottom:0,left:0,height:2,width:h?"100%":"0%",background:`linear-gradient(90deg,${color},${color}60)`,transition:"width 0.4s ease",borderRadius:"0 0 0 18px"}}/>
      <div style={{fontSize:11,color:C.textDim,marginBottom:8,letterSpacing:0.8,textTransform:"uppercase",fontWeight:600}}>{title}</div>
      <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:10}}>
        <div style={{fontSize:28,fontWeight:800,color,letterSpacing:-1}}>{value??'--'}</div>
        {label&&<div style={{fontSize:13,fontWeight:700,color,background:color+"18",padding:"2px 10px",borderRadius:20}}>{label}</div>}
      </div>
      {barPct!=null&&(
        <div style={{marginBottom:8}}>
          <div style={{height:5,background:C.borderLight,borderRadius:3,overflow:"hidden",position:"relative"}}>
            <div style={{position:"absolute",left:0,top:0,height:"100%",borderRadius:3,width:`${Math.min(Math.max(barPct,0),100)}%`,background:`linear-gradient(90deg,${C.green},${C.orange} 50%,${C.red})`,transition:"width 0.8s ease"}}/>
            <div style={{position:"absolute",top:-2,height:9,width:3,borderRadius:2,background:color,left:`calc(${Math.min(Math.max(barPct,0),100)}% - 1.5px)`,transition:"left 0.8s ease",boxShadow:`0 0 6px ${color}`}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:10,color:C.textDim}}>
            <span>0</span><span>50</span><span>100</span>
          </div>
        </div>
      )}
      {sub&&<div style={{fontSize:12,color:C.textMuted,marginTop:2}}>{sub}</div>}
    </div>
  );
}

function MarketSentimentRow({sentiment, isMobile}) {
  const vix = sentiment?.vix;
  const fg  = sentiment?.fear_greed;
  const pe  = sentiment?.pe;
  const vixColor = !vix ? C.textDim : vix.value>=40 ? C.red : vix.value>=30 ? "#ff6b35" : vix.value>=20 ? C.orange : C.green;
  const vixLabel = !vix ? '--' : vix.value>=40 ? '极度恐慌' : vix.value>=30 ? '高度恐慌' : vix.value>=20 ? '市场警惕' : vix.value>=12 ? '相对平静' : '极度平静';
  const vixChg = vix?.change_pct;
  const vixSub = vix ? `CBOE官方 · ${vixChg!=null?(vixChg>=0?'+':'')+vixChg+'%':''} 今日` : '数据加载中…';
  const fgScore = fg?.score;
  const fgColor = fgScore==null ? C.textDim : fgScore<=25 ? C.red : fgScore<=45 ? C.orange : fgScore<=55 ? C.textMuted : fgScore<=75 ? C.green : "#1a9e4a";
  const fgLabelMap = {'extreme fear':'极度恐慌','fear':'恐慌','neutral':'中性','greed':'贪婪','extreme greed':'极度贪婪'};
  const fgLabel = fg ? (fgLabelMap[(fg.rating||'').toLowerCase()]||fg.rating) : '--';
  const fgSub = fg?.previous_close!=null ? `昨收 ${fg.previous_close} · 上周 ${fg.previous_1_week??'--'}` : '数据加载中…';
  const peColor = !pe ? C.textDim : pe.percentile>=85 ? C.red : pe.percentile>=70 ? C.orange : pe.percentile>=45 ? C.textMuted : C.green;
  const peLabel = !pe ? '--' : pe.percentile>=85 ? '高估' : pe.percentile>=70 ? '偏高' : pe.percentile>=45 ? '合理' : '低估';
  const peSub = pe ? `历史${pe.percentile}%分位 · 来源 multpl.com` : '数据加载中…';
  const nqPe = sentiment?.nasdaq_pe;
  const nqPeColor = !nqPe ? C.textDim : nqPe.percentile>=85 ? C.red : nqPe.percentile>=70 ? C.orange : nqPe.percentile>=45 ? C.textMuted : C.green;
  const nqPeLabel = !nqPe ? '--' : nqPe.percentile>=85 ? '高估' : nqPe.percentile>=70 ? '偏高' : nqPe.percentile>=45 ? '合理' : '低估';
  const nqPeSub = nqPe ? `估算分位${nqPe.percentile}% · stockanalysis.com` : '数据加载中…';
  return (
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(4,1fr)",gap:isMobile?10:16,marginBottom:isMobile?20:28}}>
      <SentimentCard title="VIX 恐慌指数" value={vix?vix.value:'--'} label={vixLabel} color={vixColor} barPct={vix?Math.min(vix.value/60*100,100):null} sub={vixSub} index={0}/>
      <SentimentCard title="CNN 恐慌贪婪指数" value={fgScore!=null?fgScore:'--'} label={fgLabel} color={fgColor} barPct={fgScore!=null?fgScore:null} sub={fgSub} index={1}/>
      <SentimentCard title="标普500 PE分位" value={pe?`${pe.pe}x`:'--'} label={peLabel} color={peColor} barPct={pe?pe.percentile:null} sub={peSub} index={2}/>
      <SentimentCard title="纳斯达克100 PE分位" value={nqPe?`${nqPe.pe}x`:'--'} label={nqPeLabel} color={nqPeColor} barPct={nqPe?nqPe.percentile:null} sub={nqPeSub} index={3}/>
    </div>
  );
}

// ─── Mini bar for table ───────────────────────────────────────────────────────
function MiniBar({value, max, color}) {
  const pct = Math.min(Math.abs(value)/max*100,100);
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
      <div style={{width:48,height:4,borderRadius:2,background:C.borderLight,overflow:"hidden",flexShrink:0}}>
        <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2,transition:"width 0.6s ease"}}/>
      </div>
      <span style={{color,fontWeight:700,minWidth:52,textAlign:"right"}}>{value>0?"+":""}{value}%</span>
    </div>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────────────
const StatusBadge = ({status}) => {
  const ok = status==="open";
  const color = ok?C.green:C.red;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:ok?C.greenBg:C.redBg,color,border:`1px solid ${color}22`}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:color,animation:ok?"statusPulse 2s infinite":"none"}}/>
      {ok?"开放":"暂停"}
    </span>
  );
};

function PremiumBadge({value}) {
  const danger = value>3, high = value>2, mid = value>1;
  const color = danger?C.red:high?"#ff6b35":mid?C.orange:C.green;
  const bg    = danger?C.redBg:high?"#ff6b3512":mid?C.orangeBg:C.greenBg;
  const label = danger?"极高":high?"偏高":mid?"注意":"正常";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:bg,color,border:`1px solid ${color}30`,animation:danger?"premiumAlert 1.8s ease infinite":"none"}}>
      {value>0?"+":""}{value}% <span style={{fontSize:10,opacity:0.8}}>{label}</span>
    </span>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({title,subtitle,count,color=C.accent,timestamp}) {
  return (
    <div style={{marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",minWidth:0}}>
        <div style={{width:3,height:20,borderRadius:2,background:`linear-gradient(180deg,${color},${color}60)`,flexShrink:0}}/>
        <h2 style={{fontSize:20,fontWeight:800,color:C.text,margin:0,letterSpacing:-0.4,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</h2>
        {count!=null&&<span style={{background:color+"18",color,padding:"2px 10px",borderRadius:20,fontSize:12,fontWeight:700,flexShrink:0}}>{count}只</span>}
        {timestamp&&<span style={{fontSize:11,color:C.textDim,flexShrink:0}}>行情更新：{timestamp}</span>}
      </div>
      {subtitle&&<p style={{fontSize:13,color:C.textDim,margin:"7px 0 0 15px"}}>{subtitle}</p>}
    </div>
  );
}

// ─── ColTip ───────────────────────────────────────────────────────────────────
function ColTip({tip}) {
  const [show,setShow] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{
    if(!show) return;
    const handler=(e)=>{ if(ref.current&&!ref.current.contains(e.target)) setShow(false); };
    document.addEventListener("mousedown",handler);
    return()=>document.removeEventListener("mousedown",handler);
  },[show]);
  return (
    <span ref={ref} style={{position:"relative",display:"inline-flex"}}
      onClick={e=>{e.stopPropagation();setShow(s=>!s);}}>
      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:14,height:14,borderRadius:"50%",background:show?C.accent:C.borderLight,color:show?"#fff":C.textDim,fontSize:9,fontWeight:700,cursor:"pointer",flexShrink:0,transition:"background 0.15s"}}>?</span>
      {show&&<div style={{position:"absolute",top:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",background:"#1a1a2e",color:"#e8e8f0",fontSize:12,lineHeight:1.6,padding:"8px 12px",borderRadius:8,whiteSpace:"normal",width:200,zIndex:999,boxShadow:"0 4px 20px rgba(0,0,0,0.25)",pointerEvents:"none"}}>
        {tip}
      </div>}
    </span>
  );
}

// ─── Data Table ───────────────────────────────────────────────────────────────
function DataTable({columns,data,sortKey,sortDir,onSort}) {
  return (
    <div style={{overflowX:"auto",borderRadius:14,border:`1px solid ${C.border}`,background:C.card,boxShadow:"0 2px 16px rgba(0,0,0,0.06)"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead>
          <tr>
            {columns.map(col=>(
              <th key={col.key} onClick={()=>col.sortable!==false&&onSort?.(col.key)}
                style={{padding:"13px 16px",textAlign:col.align||"left",color:sortKey===col.key?C.accent:C.textDim,fontWeight:600,fontSize:11,letterSpacing:0.6,textTransform:"uppercase",whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`,background:"#fafafa",cursor:col.sortable!==false?"pointer":"default",userSelect:"none",position:"sticky",top:0,zIndex:1,transition:"color 0.15s"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                  {col.label}
                  {col.tip&&<ColTip tip={col.tip}/>}
                  {sortKey===col.key&&<span style={{marginLeft:2}}>{sortDir==="asc"?"↑":"↓"}</span>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row,i)=>(
            <TableRow key={row.code} row={row} columns={columns} i={i}/>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({row,columns,i}) {
  const [h,hProps] = useHover();
  return (
    <tr {...hProps} className="table-row" style={{
      background:h?"#f0f5ff":i%2===0?"transparent":"#fafafa",
      transition:"background 0.15s",
      borderLeft:h?`3px solid ${C.accent}`:"3px solid transparent",
    }}>
      {columns.map(col=>(
        <td key={col.key} style={{padding:"12px 16px",whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}30`,textAlign:col.align||"left",color:C.text}}>
          {col.render?col.render(row[col.key],row):row[col.key]}
        </td>
      ))}
    </tr>
  );
}

// ─── Tip Box ──────────────────────────────────────────────────────────────────
// ─── Search Bar ───────────────────────────────────────────────────────────────
function SearchBar({value, onChange, color=C.accent}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{marginBottom:16,position:"relative"}}>
      <div style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",color:focused?color:C.textDim,transition:"color 0.2s"}}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </div>
      <input
        value={value}
        onChange={e=>onChange(e.target.value)}
        onFocus={()=>setFocused(true)}
        onBlur={()=>setFocused(false)}
        placeholder="搜索基金名称或代码..."
        style={{
          width:"100%", boxSizing:"border-box",
          padding:"10px 40px 10px 40px",
          fontSize:14, color:C.text,
          background:C.surface,
          border:`1.5px solid ${focused?color:C.border}`,
          borderRadius:10, outline:"none",
          boxShadow: focused?`0 0 0 3px ${color}12`:"none",
          transition:"border-color 0.2s, box-shadow 0.2s",
        }}
      />
      {value&&(
        <button onClick={()=>onChange("")}
          style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.textDim,padding:2,display:"flex",alignItems:"center"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  );
}

function EmptyResult({query}) {
  return (
    <div style={{textAlign:"center",padding:"48px 0",color:C.textDim}}>
      <div style={{fontSize:32,marginBottom:12}}>🔍</div>
      <div style={{fontSize:15,fontWeight:600,color:C.textMuted,marginBottom:6}}>未找到匹配结果</div>
      <div style={{fontSize:13}}>没有找到包含「{query}」的基金，请尝试其他关键词</div>
    </div>
  );
}

function TipBox({color,text}) {  const [h,hProps] = useHover();
  return (
    <div {...hProps} style={{marginTop:20,padding:"16px 20px",borderRadius:14,background:color+"0a",border:`1px solid ${color}1a`,borderLeft:`3px solid ${color}`,fontSize:13,color:C.textMuted,lineHeight:1.8,transition:"all 0.25s",boxShadow:h?`0 4px 20px ${color}12`:"none",transform:h?"translateX(3px)":"translateX(0)"}}>
      <strong style={{color}}>提示：</strong>{text}
    </div>
  );
}

// ─── A/C 类说明框 ─────────────────────────────────────────────────────────────
function AcInfoBox() {
  const [open,setOpen]=useState(false);
  return (
    <div style={{marginTop:12,borderRadius:12,border:`1px solid ${C.borderLight}`,overflow:"hidden",fontSize:13}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",cursor:"pointer",background:C.cardBg,userSelect:"none"}}>
        <span style={{color:C.textMuted,fontWeight:600}}>A类 vs C类 — 如何选择？</span>
        <span style={{color:C.textDim,fontSize:11,transition:"transform 0.2s",display:"inline-block",transform:open?"rotate(180deg)":"rotate(0deg)"}}>▼</span>
      </div>
      {open&&(
        <div style={{padding:"14px 20px",background:C.bg,lineHeight:2,color:C.textMuted}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${C.borderLight}`}}>
                <th style={{textAlign:"left",padding:"4px 8px",color:C.textDim,fontWeight:600}}>对比项</th>
                <th style={{textAlign:"center",padding:"4px 8px",color:C.accent,fontWeight:600}}>A 类</th>
                <th style={{textAlign:"center",padding:"4px 8px",color:C.cyan,fontWeight:600}}>C 类</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["申购费","有（0.1%~1.5%，持有越长越低）","无"],
                ["销售服务费","无","年化 0.2%~0.4%（每日计提）"],
                ["赎回费","短期持有有赎回费","短期持有有赎回费"],
                ["适合持有期","＞1 年（长期省费）","≤1 年（免申购费更灵活）"],
                ["临界点","通常约 1~2 年后 A 类总费更低","不频繁赎回时可选 C 类"],
              ].map(([k,a,c],i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${C.borderLight}22`,background:i%2===0?"transparent":C.cardBg+"66"}}>
                  <td style={{padding:"5px 8px",color:C.textDim,fontWeight:500}}>{k}</td>
                  <td style={{padding:"5px 8px",textAlign:"center",color:C.text}}>{a}</td>
                  <td style={{padding:"5px 8px",textAlign:"center",color:C.text}}>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:10,fontSize:11,color:C.textDim}}>
            同一基金 A/C 类底层持仓完全相同，仅收费结构不同。
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({active,payload,label,unit="%"}) {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"rgba(255,255,255,0.96)",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",fontSize:12,boxShadow:"0 8px 24px rgba(0,0,0,0.12)"}}>
      <div style={{color:C.textDim,marginBottom:6,fontWeight:600}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
          <span style={{width:8,height:8,borderRadius:2,background:p.color,display:"inline-block"}}/>
          <span style={{color:C.textMuted}}>{p.name}</span>
          <span style={{fontWeight:700,color:C.text,marginLeft:"auto",paddingLeft:12}}>{p.value>0?"+":""}{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Disclaimer Modal ─────────────────────────────────────────────────────────
// ─── Daily Briefing Modal ─────────────────────────────────────────────────────
function GroupChatModal({onClose}) {
  const handleClose = () => {
    localStorage.setItem("group_chat_last_shown", String(Date.now()));
    onClose();
  };
  const handleNoShow = () => {
    localStorage.setItem("group_chat_no_show", new Date().toDateString());
    onClose();
  };
  return (
    <div style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,0.45)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
      onClick={e=>e.target===e.currentTarget&&handleClose()}>
      <div style={{background:"#fff",borderRadius:22,width:"100%",maxWidth:400,boxShadow:"0 32px 80px rgba(0,0,0,0.2)",animation:"fadeInUp 0.3s ease both",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"22px 24px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.borderLight}`}}>
          <div>
            <div style={{fontSize:11,color:"#07c160",fontWeight:700,letterSpacing:0.5,marginBottom:3}}>WISEINVEST 社区</div>
            <div style={{fontSize:17,fontWeight:800,color:C.text,letterSpacing:-0.4}}>欢迎加入官方微信群聊</div>
          </div>
          <button onClick={handleClose}
            style={{width:32,height:32,borderRadius:"50%",border:"none",background:C.bg,color:C.textMuted,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
        </div>
        {/* QR Code */}
        <div style={{padding:"24px 24px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
          <div style={{borderRadius:16,overflow:"hidden",border:`1px solid ${C.borderLight}`,width:"100%"}}>
            <img src="/群聊.png" alt="WiseInvest 微信群聊二维码"
              style={{width:"100%",height:"auto",display:"block"}}
              onError={e=>{e.currentTarget.parentElement.style.display="none";}}/>
          </div>
          <div style={{fontSize:13,color:C.textDim,textAlign:"center",lineHeight:1.7}}>
            扫码加入群聊，与志同道合的投资者一起交流
          </div>
        </div>
        {/* Footer */}
        <div style={{padding:"12px 24px 24px",display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={handleClose}
            style={{width:"100%",padding:"12px 0",borderRadius:12,border:"none",background:"#07c160",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:0.2}}>
            进入平台
          </button>
          <button onClick={handleNoShow}
            style={{background:"none",border:"none",fontSize:12,color:C.textDim,cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:3}}>
            今日不再提示
          </button>
        </div>
      </div>
    </div>
  );
}

function DisclaimerModal({onClose}) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.45)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:20,padding:"36px 32px",maxWidth:460,width:"100%",boxShadow:"0 24px 80px rgba(0,0,0,0.22)",animation:"fadeInUp 0.35s ease both"}}>
        <div style={{fontSize:28,marginBottom:14,textAlign:"center"}}>⚠️</div>
        <h3 style={{fontSize:19,fontWeight:800,color:"#1d1d1f",margin:"0 0 12px",letterSpacing:-0.4,textAlign:"center"}}>投资风险声明</h3>
        <p style={{fontSize:14,color:"#6e6e73",lineHeight:1.9,margin:"0 0 24px"}}>
          本平台所展示的数据、分析及内容仅供<strong style={{color:"#1d1d1f"}}>信息参考</strong>，
          <strong style={{color:"#d93025"}}>不构成任何投资建议</strong>。投资有风险，入市须谨慎。
          QDII 基金及场内 ETF 涉及汇率风险、额度限制等因素，请在充分了解产品特征和风险后，
          结合个人风险承受能力，做出<strong style={{color:"#1d1d1f"}}>独立投资决策</strong>。
        </p>
        <button onClick={onClose}
          style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",background:"linear-gradient(135deg,#0071e3,#005bbf)",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",letterSpacing:0.2}}>
          我已了解，继续浏览
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton Table ────────────────────────────────────────────────────────────
function SkeletonTable({rows=7,cols=7}) {
  const widths=[0.5,2.5,0.7,0.7,1,0.7,0.7];
  return (
    <div style={{borderRadius:14,border:"1px solid #e0e0e5",background:"#fff",overflow:"hidden",boxShadow:"0 2px 16px rgba(0,0,0,0.06)"}}>
      <div style={{height:44,background:"#fafafa",borderBottom:"1px solid #e0e0e5",display:"flex",alignItems:"center",gap:16,padding:"0 16px"}}>
        {Array.from({length:cols}).map((_,j)=>(
          <div key={j} style={{height:10,borderRadius:4,background:"#ebebf0",flex:widths[j]||1,animation:"skeletonPulse 1.4s ease infinite",animationDelay:`${j*0.06}s`}}/>
        ))}
      </div>
      {Array.from({length:rows}).map((_,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:16,padding:"13px 16px",borderBottom:i<rows-1?"1px solid #e0e0e530":"",background:i%2?"#fafafa":"#fff"}}>
          {Array.from({length:cols}).map((_,j)=>(
            <div key={j} style={{height:12,borderRadius:4,background:"#f0f0f5",flex:widths[j]||1,animation:"skeletonPulse 1.4s ease infinite",animationDelay:`${i*0.04+j*0.06}s`}}/>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Status Filter Bar ────────────────────────────────────────────────────────
function StatusFilterBar({value, onChange, color}) {
  const opts=[{id:"all",label:"全部"},{id:"open",label:"仅开放申购"},{id:"suspended",label:"暂停申购"}];
  return (
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      {opts.map(o=>(
        <button key={o.id} onClick={()=>onChange(o.id)}
          style={{padding:"5px 14px",borderRadius:20,border:`1.5px solid ${value===o.id?color:"#e0e0e5"}`,background:value===o.id?color+"14":"none",color:value===o.id?color:"#6e6e73",fontSize:12,fontWeight:value===o.id?700:400,cursor:"pointer",transition:"all 0.18s",lineHeight:1.5}}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Back To Top Button ───────────────────────────────────────────────────────


// ─── FX Analysis Card ────────────────────────────────────────────────────────
// ─── 负收益年原因 ──────────────────────────────────────────────────────────────
const CRASH_REASONS = {
  1990: { title:"海湾战争 + 储贷危机",       tag:"经济衰退", color:"#e8a020",
    desc:"伊拉克入侵科威特引发海湾战争，油价急升推高通胀，美国陷入衰退。美国储贷协会危机持续冲击金融体系，联储被迫大幅加息。" },
  2000: { title:"科网泡沫破裂（第一年）",     tag:"泡沫崩溃", color:"#d93025",
    desc:"互联网泡沫从2000年3月纳指高点开始崩溃，大量.com公司估值严重虚高。纳指跌近37%，科技股受创远重于大盘。" },
  2001: { title:"9·11恐袭 + 科网泡沫持续",   tag:"黑天鹅", color:"#d93025",
    desc:"9月11日恐袭震惊全球，纽交所停市4天。科网泡沫继续破裂，安然公司财务丑闻爆发，市场信心持续低迷。" },
  2002: { title:"科网泡沫尾声 + 会计丑闻",   tag:"连续熊市", color:"#d93025",
    desc:"安然、世通等巨型会计造假案接连曝光，《萨班斯-奥克斯利法案》应运而生。纳指三年累计跌幅超80%，为有史以来最惨熊市之一。" },
  2008: { title:"全球金融危机",               tag:"系统性危机", color:"#d93025",
    desc:"次贷危机引爆全球金融海啸。雷曼兄弟9月宣告破产，贝尔斯登被收购，AIG获政府紧急救助2000亿，全球信贷市场几近冻结。" },
  2018: { title:"美联储加息 + 中美贸易战",   tag:"政策收紧", color:"#e8a020",
    desc:"美联储全年4次加息，联邦基金利率升至2.5%。中美贸易摩擦升级互加关税，科技股四季度暴跌，纳指Q4单季跌逾17%。" },
  2022: { title:"史上最快加息周期 + 通胀危机", tag:"利率冲击", color:"#d93025",
    desc:"美国通胀触及40年高点（CPI 9.1%），美联储全年7次加息合计425bp，10年期美债从1.5%飙至4%+。高估值成长股和纳指科技股遭毁灭性重估。" },
};

// 自定义 Bar shape — 必须定义在组件外，避免每次渲染创建新引用
function NasdaqBar(props) {
  const { x, y, width, height, value } = props;
  const fill = value >= 0 ? C.accent : C.red;
  const h = Math.abs(height);
  const yPos = value >= 0 ? y : y + height;
  return <rect x={x} y={yPos} width={Math.max(width,1)} height={h} fill={fill} rx={2} opacity={0.85}/>;
}
function Sp500Bar(props) {
  const { x, y, width, height, value } = props;
  const fill = value >= 0 ? C.cyan : "#e8704a";
  const h = Math.abs(height);
  const yPos = value >= 0 ? y : y + height;
  return <rect x={x} y={yPos} width={Math.max(width,1)} height={h} fill={fill} rx={2} opacity={0.85}/>;
}

// ─── Index History Card ───────────────────────────────────────────────────────
function IndexHistoryCard() {
  const [mode, setMode] = useState("compare"); // "nasdaq" | "sp500" | "compare"
  const [selectedYear, setSelectedYear] = useState(null);

  // 构建年度数据数组
  const annualRows = useMemo(() => {
    const years = Object.keys(INDEX_ANNUAL.nasdaq).map(Number).sort((a,b)=>a-b);
    return years.map(y => ({
      year: String(y),
      nasdaq: INDEX_ANNUAL.nasdaq[y],
      sp500:  INDEX_ANNUAL.sp500[y],
    }));
  }, []);

  // 累计增长曲线（以100为起点，1989年末=100）
  const cumulativeRows = useMemo(() => {
    const years = Object.keys(INDEX_ANNUAL.nasdaq).map(Number).sort((a,b)=>a-b);
    let nq = 100, sp = 100;
    return years.map(y => {
      nq = +(nq * (1 + INDEX_ANNUAL.nasdaq[y] / 100)).toFixed(1);
      sp = +(sp * (1 + INDEX_ANNUAL.sp500[y]  / 100)).toFixed(1);
      return { year: String(y), nasdaq: nq, sp500: sp };
    });
  }, []);

  const cagrEntries = Object.entries(INDEX_CAGR.nasdaq).map(([label, nq], i) => ({
    label,
    nasdaq: nq,
    sp500: Object.values(INDEX_CAGR.sp500)[i],
  }));

  const handleBarClick = useCallback((data) => {
    if (!data?.payload) return;
    const yr = parseInt(data.payload.year);
    if (CRASH_REASONS[yr]) setSelectedYear(prev => prev === yr ? null : yr);
  }, []);

  const tabs = [{id:"compare",label:"对比"},{id:"nasdaq",label:"纳指100"},{id:"sp500",label:"标普500"}];

  return (
    <Reveal delay={0.06}>
      <Card style={{padding:"24px 26px",marginBottom:28}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>纳指100 vs 标普500 · 历年回报（1990-2025）</div>
            <div style={{fontSize:12,color:C.textDim}}>纳指100价格口径 · 标普500总回报含股息 · 来源：Slickcharts</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setMode(t.id)}
                style={{padding:"5px 12px",borderRadius:8,border:`1.5px solid ${mode===t.id?C.accent:C.border}`,background:mode===t.id?C.accent+"12":"none",color:mode===t.id?C.accent:C.textMuted,fontSize:12,fontWeight:mode===t.id?700:400,cursor:"pointer",transition:"all 0.18s"}}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bar chart */}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={annualRows} barGap={2} barCategoryGap="18%" margin={{top:16,right:8,left:0,bottom:0}}>
            <CartesianGrid strokeDasharray="2 4" stroke={C.borderLight} vertical={false}/>
            <XAxis dataKey="year" tick={{fill:C.textDim,fontSize:10}} axisLine={false} tickLine={false}
              tickFormatter={v=>v.slice(2)} interval={1}/>
            <YAxis tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false} unit="%" domain={[-50,110]}/>
            <ReferenceLine y={0} stroke={C.border} strokeWidth={1.5}/>
            <Tooltip content={<ChartTooltip unit="%"/>} cursor={{fill:"rgba(0,0,0,0.04)",rx:3}}/>
            {(mode==="compare"||mode==="nasdaq")&&
              <Bar dataKey="nasdaq" name="纳指100" shape={<NasdaqBar/>} onClick={handleBarClick} style={{cursor:"pointer"}}/>}
            {(mode==="compare"||mode==="sp500")&&
              <Bar dataKey="sp500"  name="标普500" shape={<Sp500Bar/>} onClick={handleBarClick} style={{cursor:"pointer"}}/>}
            {mode==="compare"&&<Legend wrapperStyle={{fontSize:11,paddingTop:10}}/>}
          </BarChart>
        </ResponsiveContainer>

        {/* 点击负收益年显示原因面板 */}
        {selectedYear && CRASH_REASONS[selectedYear] && (()=>{
          const r = CRASH_REASONS[selectedYear];
          const nq = INDEX_ANNUAL.nasdaq[selectedYear];
          const sp = INDEX_ANNUAL.sp500[selectedYear];
          return (
            <div style={{margin:"16px 0 0",padding:"18px 22px",borderRadius:14,background:r.color+"0c",border:`1.5px solid ${r.color}30`,position:"relative",animation:"fadeSlideIn 0.22s ease"}}>
              <button onClick={()=>setSelectedYear(null)}
                style={{position:"absolute",top:12,right:14,background:"none",border:"none",fontSize:18,color:C.textDim,cursor:"pointer",lineHeight:1}}>×</button>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <span style={{fontSize:20,fontWeight:800,color:r.color}}>{selectedYear}</span>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:r.color+"18",color:r.color}}>{r.tag}</span>
                <span style={{fontSize:15,fontWeight:700,color:C.text}}>{r.title}</span>
              </div>
              <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7,margin:"0 0 14px"}}>{r.desc}</p>
              <div style={{display:"flex",gap:20}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{width:10,height:10,borderRadius:2,background:C.accent,display:"inline-block"}}/>
                  <span style={{fontSize:12,color:C.textDim}}>纳指100</span>
                  <span style={{fontSize:15,fontWeight:800,color:nq<0?C.red:C.green}}>{nq>0?"+":""}{nq}%</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{width:10,height:10,borderRadius:2,background:C.cyan,display:"inline-block"}}/>
                  <span style={{fontSize:12,color:C.textDim}}>标普500</span>
                  <span style={{fontSize:15,fontWeight:800,color:sp<0?C.red:C.green}}>{sp>0?"+":""}{sp}%</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 提示文字：有负收益年时提示可点击 */}
        <div style={{textAlign:"center",marginTop:8,fontSize:11,color:C.textDim}}>
          点击红色柱（负收益年）查看原因
        </div>

        {/* 累计增长曲线 */}
        {(()=>{
          const NQ_COLOR = "#6366f1"; // 靛紫 — 纳指
          const SP_COLOR = "#10b981"; // 翠绿 — 标普
          const last = cumulativeRows[cumulativeRows.length-1];
          return (
            <div style={{marginTop:28,paddingTop:24,borderTop:`1px solid ${C.borderLight}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:3}}>累计增长曲线（1990–2025）</div>
                  <div style={{fontSize:12,color:C.textDim}}>以100为起点 · 对数坐标轴 · 36年持有结果：
                    {(mode==="compare"||mode==="nasdaq")&&<span style={{color:NQ_COLOR,fontWeight:700}}> 纳指×{(last.nasdaq/100).toFixed(0)}</span>}
                    {mode==="compare"&&<span style={{color:C.textDim}}> vs</span>}
                    {(mode==="compare"||mode==="sp500")&&<span style={{color:SP_COLOR,fontWeight:700}}> 标普×{(last.sp500/100).toFixed(0)}</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:16,fontSize:12}}>
                  {(mode==="compare"||mode==="nasdaq")&&(
                    <span style={{display:"flex",alignItems:"center",gap:5}}>
                      <span style={{width:24,height:3,borderRadius:2,background:NQ_COLOR,display:"inline-block"}}/>
                      <span style={{color:C.textMuted}}>纳指100</span>
                    </span>
                  )}
                  {(mode==="compare"||mode==="sp500")&&(
                    <span style={{display:"flex",alignItems:"center",gap:5}}>
                      <span style={{width:24,height:3,borderRadius:2,background:SP_COLOR,display:"inline-block"}}/>
                      <span style={{color:C.textMuted}}>标普500</span>
                    </span>
                  )}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={cumulativeRows} margin={{top:8,right:8,left:0,bottom:0}}>
                  <defs>
                    <linearGradient id="cumulNQ" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor={NQ_COLOR} stopOpacity={0.22}/>
                      <stop offset="100%" stopColor={NQ_COLOR} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="cumulSP" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor={SP_COLOR} stopOpacity={0.18}/>
                      <stop offset="100%" stopColor={SP_COLOR} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke={C.borderLight} vertical={false}/>
                  <XAxis dataKey="year" tick={{fill:C.textDim,fontSize:10}} axisLine={false} tickLine={false}
                    tickFormatter={v=>v.slice(2)} interval={3}/>
                  <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow
                    tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false}
                    tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}
                    ticks={[100,200,500,1000,2000,5000,10000]}/>
                  <Tooltip content={({active,payload,label})=>{
                    if(!active||!payload?.length) return null;
                    return (
                      <div style={{background:"rgba(255,255,255,0.97)",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",fontSize:12,boxShadow:"0 8px 24px rgba(0,0,0,0.12)"}}>
                        <div style={{color:C.textDim,marginBottom:6,fontWeight:600}}>{label}年</div>
                        {payload.map((p,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                            <span style={{width:8,height:8,borderRadius:"50%",background:p.color,display:"inline-block"}}/>
                            <span style={{color:C.textMuted}}>{p.name}</span>
                            <span style={{fontWeight:700,color:p.color,marginLeft:"auto",paddingLeft:12}}>
                              {p.value?.toLocaleString()}
                              <span style={{fontSize:10,color:C.textDim,fontWeight:400}}> ×{(p.value/100).toFixed(1)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }}/>
                  {(mode==="compare"||mode==="nasdaq")&&
                    <Area type="monotone" dataKey="nasdaq" name="纳指100" stroke={NQ_COLOR} fill="url(#cumulNQ)" strokeWidth={2.5} dot={false}/>}
                  {(mode==="compare"||mode==="sp500")&&
                    <Area type="monotone" dataKey="sp500"  name="标普500" stroke={SP_COLOR} fill="url(#cumulSP)" strokeWidth={2.5} dot={false}/>}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        })()}

        {/* CAGR cards */}
        <div style={{display:"flex",gap:12,marginTop:20,flexWrap:"wrap"}}>
          {cagrEntries.map(({label,nasdaq,sp500},i)=>{
            const colors=[C.accent,C.green,"#e8a020",C.purple];
            const col=colors[i];
            const periods=["36年 (1990-2025)","15年 (2011-2025)","10年 (2016-2025)","5年 (2021-2025)"];
            return (
              <div key={label} style={{flex:1,minWidth:140,borderRadius:14,border:`1px solid ${col}22`,background:col+"08",padding:"16px 18px"}}>
                <div style={{fontSize:11,color:C.textDim,marginBottom:8,whiteSpace:"nowrap"}}>{periods[i]}</div>
                {(mode==="compare"||mode==="nasdaq")&&(
                  <div style={{marginBottom:mode==="compare"?6:0}}>
                    {mode==="compare"&&<div style={{fontSize:10,color:C.textDim,marginBottom:2}}>纳指100</div>}
                    <div style={{fontSize:24,fontWeight:800,color:col,letterSpacing:-0.5}}>{nasdaq}%</div>
                    <div style={{fontSize:10,color:C.textDim,marginTop:2}}>年化复合收益</div>
                  </div>
                )}
                {(mode==="compare"||mode==="sp500")&&(
                  <div style={{marginTop:mode==="compare"?4:0}}>
                    {mode==="compare"&&<div style={{fontSize:10,color:C.textDim,marginBottom:2}}>标普500</div>}
                    <div style={{fontSize:mode==="compare"?16:24,fontWeight:mode==="compare"?600:800,color:mode==="compare"?C.textMuted:col,letterSpacing:-0.5}}>{sp500}%</div>
                    {mode==="sp500"&&<div style={{fontSize:10,color:C.textDim,marginTop:2}}>年化复合收益</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </Reveal>
  );
}

function FXAnalysisCard() {
  const [strategy,setStrategy]=useState("nasdaq");
  const [rawData,setRawData]=useState(null);
  const [apiLoading,setApiLoading]=useState(true);

  useEffect(()=>{
    (async()=>{
      try{
        const r=await fetch(`${API_BASE}/fx-index-history`);
        if(r.ok){const d=await r.json();if(d.data?.length>10)setRawData(d.data);}
      }catch{}
      setApiLoading(false);
    })();
  },[]);

  // Monthly cumulative returns computed from raw close prices
  const monthlyData=useMemo(()=>{
    if(!rawData||rawData.length<2) return null;
    const key=strategy==="nasdaq"?"ndx_close":"spx_close";
    let usdV=1,cnyV=1;
    const result=[];
    for(let i=1;i<rawData.length;i++){
      const prev=rawData[i-1],curr=rawData[i];
      if(!prev[key]||!curr[key]||!prev.usdcny||!curr.usdcny) continue;
      const indexReturn=curr[key]/prev[key]-1;
      const fxFactor=curr.usdcny/prev.usdcny;
      usdV*=(1+indexReturn);
      cnyV*=(1+indexReturn)*fxFactor;
      result.push({month:curr.month,usd:+(usdV*100).toFixed(1),cny:+(cnyV*100).toFixed(1),fx:+curr.usdcny.toFixed(4)});
    }
    return result.length>0?result:null;
  },[rawData,strategy]);

  // Annual fallback when backend unavailable
  const annualData=useMemo(()=>{
    if(monthlyData) return null;
    const ret=INDEX_ANNUAL[strategy];
    let usdV=1,cnyV=1;
    return Object.entries(FX_ANNUAL).map(([y,[startFX,endFX]])=>{
      const yr=parseInt(y);
      usdV*=(1+(ret[yr]||0)/100);
      cnyV*=(1+(ret[yr]||0)/100)*(endFX/startFX);
      return {month:y,usd:+(usdV*100).toFixed(1),cny:+(cnyV*100).toFixed(1),fx:+endFX.toFixed(4)};
    });
  },[strategy,monthlyData]);

  const data=monthlyData||annualData||[];
  const isMonthly=!!monthlyData;
  const last=data[data.length-1]||{usd:100,cny:100,fx:7.3};
  const usdGain=+(last.usd-100).toFixed(1);
  const cnyGain=+(last.cny-100).toFixed(1);
  const fxContrib=+(cnyGain-usdGain).toFixed(1);
  const color1=strategy==="nasdaq"?C.accent:C.cyan;

  // Only show tick labels for January of each year (monthly mode)
  const yearTicks=useMemo(()=>{
    if(!isMonthly) return undefined;
    return data.filter(d=>d.month?.slice(5,7)==="01").map(d=>d.month);
  },[data,isMonthly]);

  return (
    <Reveal delay={0.12}>
      <Card style={{padding:"24px 26px",marginBottom:36}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <div style={{fontSize:15,fontWeight:700,color:C.text}}>汇率影响剥离分析</div>
              <span style={{padding:"2px 8px",borderRadius:10,background:C.orangeBg,color:C.orange,fontSize:11,fontWeight:600}}>USD/CNY</span>
              {isMonthly&&<span style={{padding:"2px 8px",borderRadius:10,background:C.accentBg,color:C.accent,fontSize:11,fontWeight:600}}>月度粒度</span>}
              {!isMonthly&&!apiLoading&&<span style={{padding:"2px 8px",borderRadius:10,background:C.bg,color:C.textDim,fontSize:11}}>年度数据（后端离线）</span>}
            </div>
            <div style={{fontSize:12,color:C.textDim}}>人民币持有者 vs 美元持有者 · 2015年起累计，以100为基准 · 间距即为汇率净贡献</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            {[{id:"nasdaq",label:"纳指100",color:C.accent},{id:"sp500",label:"标普500",color:C.cyan}].map(s=>(
              <button key={s.id} onClick={()=>setStrategy(s.id)}
                style={{padding:"5px 12px",borderRadius:8,border:`1.5px solid ${strategy===s.id?s.color:C.border}`,background:strategy===s.id?s.color+"12":"none",color:strategy===s.id?s.color:C.textMuted,fontSize:12,fontWeight:strategy===s.id?700:400,cursor:"pointer",transition:"all 0.18s"}}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary stats */}
        <div style={{display:"flex",gap:0,marginBottom:22,background:C.bg,borderRadius:14,overflow:"hidden",border:`1px solid ${C.border}`}}>
          {[
            {label:"美元累计涨幅",value:`+${usdGain}%`,sub:"纯美元口径",color:color1},
            {label:"人民币累计涨幅",value:`${cnyGain>=0?"+":""}${cnyGain}%`,sub:"含汇率折算",color:C.green},
            {label:"汇率累计贡献",value:`${fxContrib>0?"+":""}${fxContrib}%`,sub:fxContrib>0?"人民币贬值增厚收益":"人民币升值侵蚀收益",color:fxContrib>0?C.orange:C.red},
            {label:"当前 USD/CNY",value:last.fx,sub:isMonthly?"最新月度汇率":"年末汇率",color:C.textMuted},
          ].map((s,i)=>(
            <div key={s.label} style={{flex:1,padding:"16px 20px",borderRight:i<3?`1px solid ${C.border}`:"none",textAlign:"center"}}>
              <div style={{fontSize:11,color:C.textDim,marginBottom:6}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:s.color,letterSpacing:-0.5}}>{s.value}</div>
              <div style={{fontSize:11,color:C.textDim,marginTop:4}}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Chart or loading */}
        {apiLoading&&!data.length?(
          <div style={{height:280,display:"flex",alignItems:"center",justifyContent:"center",color:C.textDim,fontSize:13}}>
            正在加载月度历史数据…
          </div>
        ):(
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{top:8,right:54,left:4,bottom:0}}>
              <defs>
                <linearGradient id="fxCnyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.green}  stopOpacity={0.18}/>
                  <stop offset="95%" stopColor={C.green}  stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="fxUsdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color1}   stopOpacity={0.2}/>
                  <stop offset="95%" stopColor={color1}   stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke={C.borderLight} vertical={false}/>
              <XAxis dataKey="month" tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false}
                ticks={yearTicks}
                tickFormatter={v=>isMonthly?v?.slice(0,4):v}/>
              <YAxis yAxisId="ret" tick={{fill:C.textDim,fontSize:10}} axisLine={false} tickLine={false}
                tickFormatter={v=>`${v}`} domain={["auto","auto"]} width={38}
                label={{value:"基准=100",angle:-90,position:"insideLeft",fill:C.textDim,fontSize:10,dy:30}}/>
              <YAxis yAxisId="fx" orientation="right" tick={{fill:C.orange,fontSize:10}} axisLine={false} tickLine={false}
                domain={[5.8,7.8]} tickFormatter={v=>`¥${v.toFixed(1)}`} width={46}/>
              <Tooltip
                formatter={(v,name)=>{
                  if(name==="USD/CNY汇率") return [`¥${v}`,name];
                  return [`${v}（基准100）`,name];
                }}
                labelFormatter={v=>isMonthly?v:v+"年"}
                contentStyle={{borderRadius:10,fontSize:12,border:`1px solid ${C.border}`,boxShadow:"0 4px 20px rgba(0,0,0,0.08)"}}/>
              <Legend wrapperStyle={{fontSize:11,paddingTop:10}}/>
              <ReferenceLine yAxisId="ret" y={100} stroke={C.border} strokeDasharray="3 3"/>
              <Area yAxisId="ret" type="monotone" dataKey="cny" name="人民币口径" stroke={C.green} fill="url(#fxCnyGrad)" strokeWidth={2.5} dot={false}/>
              <Area yAxisId="ret" type="monotone" dataKey="usd" name="美元口径" stroke={color1} fill="url(#fxUsdGrad)" strokeWidth={2} dot={false}/>
              <Line yAxisId="fx" type="monotone" dataKey="fx" name="USD/CNY汇率" stroke={C.orange} strokeWidth={1.5} dot={false} strokeDasharray="5 3"/>
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Insight text */}
        <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={{padding:"12px 16px",borderRadius:10,background:C.accentBg,border:`1px solid ${C.accent}18`,fontSize:12,color:C.textMuted,lineHeight:1.8}}>
            <strong style={{color:C.accent}}>绿线 {">"} 蓝线：</strong>
            人民币贬值期（汇率↑），在国内持有QDII的你比纯美元持有者<strong style={{color:C.text}}>多赚</strong>了这段"缺口"——因为净值折算回人民币时会自然增厚。
          </div>
          <div style={{padding:"12px 16px",borderRadius:10,background:C.orangeBg,border:`1px solid ${C.orange}18`,fontSize:12,color:C.textMuted,lineHeight:1.8}}>
            <strong style={{color:C.orange}}>绿线 {"<"} 蓝线：</strong>
            人民币升值期（汇率↓），如2017、2020–2021年，CNY口径收益低于美元口径，汇率会<strong style={{color:C.text}}>侵蚀</strong>部分收益，需特别留意。
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

// ─── Watchlist Empty State ────────────────────────────────────────────────────
function WatchlistEmpty({onGo}) {
  return (
    <div style={{textAlign:"center",padding:"80px 0",color:C.textDim}}>
      <div style={{fontSize:52,marginBottom:16,opacity:0.4}}>☆</div>
      <div style={{fontSize:17,fontWeight:600,color:C.textMuted,marginBottom:8}}>暂无自选基金</div>
      <div style={{fontSize:14,marginBottom:28}}>在各板块点击 ☆ 图标，将感兴趣的基金加入自选列表</div>
      <button onClick={onGo}
        style={{padding:"10px 28px",borderRadius:20,border:`1.5px solid ${C.accent}`,background:C.accent+"12",color:C.accent,fontSize:14,fontWeight:600,cursor:"pointer",transition:"all 0.2s"}}>
        去挑选基金 →
      </button>
    </div>
  );
}

// ─── Compare Bar (floating) ───────────────────────────────────────────────────
function CompareBar({list,onOpen,onRemove,onClear}) {
  if(list.length===0) return null;
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:150,background:"rgba(255,255,255,0.96)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderTop:`1px solid ${C.border}`,boxShadow:"0 -4px 24px rgba(0,0,0,0.09)",padding:"12px 40px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",animation:"slideUp 0.3s ease both"}}>
      <span style={{fontSize:12,color:C.textDim,flexShrink:0,fontWeight:600}}>对比 {list.length}/4</span>
      <div style={{display:"flex",gap:8,flex:1,flexWrap:"wrap"}}>
        {list.map(f=>(
          <div key={f.code} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px 4px 12px",borderRadius:20,background:C.accentBg,border:`1.5px solid ${C.accent}40`,fontSize:13}}>
            <span style={{fontFamily:"monospace",fontWeight:700,color:C.accent,fontSize:12}}>{f.code}</span>
            <span style={{fontSize:12,color:C.textMuted,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name.replace(/\(.*\)/,"").slice(0,8)}</span>
            <button onClick={()=>onRemove(f.code)} style={{background:"none",border:"none",cursor:"pointer",color:C.textDim,padding:"0 2px",fontSize:14,lineHeight:1,display:"flex",alignItems:"center"}}>×</button>
          </div>
        ))}
      </div>
      <button onClick={onClear} style={{padding:"7px 14px",borderRadius:18,border:`1.5px solid ${C.border}`,background:"none",color:C.textMuted,fontSize:13,cursor:"pointer",flexShrink:0}}>清除</button>
      <button onClick={onOpen} disabled={list.length<2}
        style={{padding:"8px 22px",borderRadius:18,border:"none",background:list.length>=2?`linear-gradient(135deg,${C.accent},${C.accentDim})`:"#e0e0e5",color:list.length>=2?"#fff":C.textDim,fontSize:13,fontWeight:700,cursor:list.length>=2?"pointer":"default",flexShrink:0,transition:"all 0.2s"}}>
        开始对比 {list.length>=2?`(${list.length})`:""} →
      </button>
    </div>
  );
}

// ─── Compare Modal ────────────────────────────────────────────────────────────
function CompareModal({list,onClose}) {
  const COLORS=["#0071e3","#0077a8","#6e3de8","#c4570a"];
  const [view,setView]=useState("chart"); // "chart" | "table"

  // ── visual chart panels ──────────────────────────────────────────────────
  const metrics=[
    {label:"近1年涨幅",key:"ytd_return",unit:"%",higher:"better",color:C.green},
    {label:"年费率",   key:"fee_rate",  unit:"%",higher:"worse", color:C.orange},
    {label:"规模(亿)", key:"scale",     unit:"亿",higher:"better",color:C.accent},
    {label:"跟踪误差", key:"track_error",unit:"%",higher:"worse",color:C.red},
  ];

  const rows=[
    {label:"分类",          fmt:f=>f._cat||"—"},
    {label:"年费率",        fmt:f=>f.fee_rate!=null?<span style={{color:f.fee_rate>1?C.orange:C.green,fontWeight:700}}>{f.fee_rate}%</span>:"—"},
    {label:"规模(亿)",      fmt:f=>f.scale!=null?`${f.scale}亿`:"—"},
    {label:"近1年涨幅",     fmt:f=>f.ytd_return!=null?<span style={{color:f.ytd_return>0?C.green:C.red,fontWeight:700}}>{f.ytd_return>0?"+":""}{f.ytd_return}%</span>:"—"},
    {label:"跟踪误差",      fmt:f=>f.track_error!=null?<span style={{color:f.track_error>2?C.orange:C.textMuted}}>{f.track_error}%</span>:"—"},
    {label:"申购/交易上限",  fmt:f=>f.daily_limit||"场内交易"},
    {label:"溢价率",        fmt:f=>f.premium!=null?<PremiumBadge value={f.premium}/>:"—"},
    {label:"申购状态",      fmt:f=>f.buy_status?<StatusBadge status={f.buy_status}/>:<span style={{color:C.cyan,fontSize:12}}>场内交易</span>},
  ];

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.42)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:22,width:"100%",maxWidth:Math.min(260+list.length*210,980),maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 28px 90px rgba(0,0,0,0.22)",animation:"fadeInUp 0.3s ease both"}}>

        {/* Header */}
        <div style={{padding:"22px 28px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <h3 style={{fontSize:18,fontWeight:800,color:C.text,margin:0,letterSpacing:-0.4}}>基金横向对比</h3>
            <p style={{fontSize:12,color:C.textDim,margin:"3px 0 0"}}>已选 {list.length} 只 · 点击空白处关闭</p>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {/* view toggle */}
            {["chart","table"].map(v=>(
              <button key={v} onClick={()=>setView(v)}
                style={{padding:"6px 14px",borderRadius:8,border:`1.5px solid ${view===v?C.accent:C.border}`,background:view===v?C.accent:"#fff",color:view===v?"#fff":C.textMuted,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.18s"}}>
                {v==="chart"?"📊 图表":"☰ 详情"}
              </button>
            ))}
            <button onClick={onClose}
              style={{background:C.bg,border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",color:C.textMuted,fontSize:13,fontWeight:500,marginLeft:4}}>✕</button>
          </div>
        </div>

        <div style={{overflowY:"auto",padding:"20px 28px 28px"}}>

          {/* Fund name header row */}
          <div style={{display:"grid",gridTemplateColumns:`repeat(${list.length},1fr)`,gap:12,marginBottom:20}}>
            {list.map((f,i)=>(
              <div key={f.code} style={{textAlign:"center",padding:"14px 12px",background:COLORS[i]+"08",borderRadius:14,border:`1.5px solid ${COLORS[i]}22`}}>
                <div style={{width:28,height:3,background:COLORS[i],borderRadius:2,margin:"0 auto 8px"}}/>
                <div style={{fontSize:10,color:COLORS[i],fontFamily:"monospace",fontWeight:700,marginBottom:4}}>{f.code}</div>
                <div style={{fontSize:12,fontWeight:700,color:C.text,lineHeight:1.4}}>{f.name}</div>
                {f._cat&&<span style={{marginTop:6,display:"inline-block",padding:"1px 8px",borderRadius:10,fontSize:10,background:COLORS[i]+"14",color:COLORS[i],fontWeight:600}}>{f._cat}</span>}
              </div>
            ))}
          </div>

          {view==="chart"?(
            /* ── Chart view ── */
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              {metrics.map(({label,key,unit,higher,color})=>{
                const vals=list.map(f=>f[key]);
                const defined=vals.filter(v=>v!=null);
                if(defined.length===0) return null;
                const maxAbs=Math.max(...defined.map(v=>Math.abs(v)));
                const best=higher==="better"?Math.max(...defined):Math.min(...defined);
                return (
                  <div key={key} style={{background:C.bg,borderRadius:14,padding:"16px 18px",border:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}}/>
                      <span style={{fontSize:12,fontWeight:700,color:C.textMuted}}>{label}</span>
                      <span style={{marginLeft:"auto",fontSize:10,color:C.textDim}}>{higher==="better"?"↑ 越高越好":"↓ 越低越好"}</span>
                    </div>
                    {list.map((f,i)=>{
                      const val=f[key];
                      if(val==null) return (
                        <div key={f.code} style={{marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center"}}>
                            <span style={{fontSize:11,color:COLORS[i],fontWeight:600}}>{f.code}</span>
                            <span style={{fontSize:11,color:C.textDim}}>—</span>
                          </div>
                          <div style={{height:7,background:C.borderLight,borderRadius:4}}/>
                        </div>
                      );
                      const pct=maxAbs>0?Math.abs(val)/maxAbs*100:0;
                      const isWinner=val===best;
                      const barColor=isWinner?color:COLORS[i];
                      return (
                        <div key={f.code} style={{marginBottom:i<list.length-1?14:0}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center"}}>
                            <span style={{fontSize:11,color:COLORS[i],fontWeight:600,maxWidth:"60%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.code}</span>
                            <span style={{fontSize:13,fontWeight:800,color:isWinner?color:C.textMuted}}>
                              {val>0&&key==="ytd_return"?"+":""}{val}{unit}
                              {isWinner&&<span style={{marginLeft:4,fontSize:10,color:color}}>★</span>}
                            </span>
                          </div>
                          <div style={{height:7,background:C.borderLight,borderRadius:4,overflow:"hidden",position:"relative"}}>
                            <div style={{
                              position:"absolute",left:0,top:0,height:"100%",
                              width:`${pct}%`,
                              background:isWinner?`linear-gradient(90deg,${barColor}88,${barColor})`:`${barColor}66`,
                              borderRadius:4,
                              transition:"width 0.7s cubic-bezier(0.34,1.56,0.64,1)"
                            }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Radar-style summary panel */}
              <div style={{gridColumn:"1/-1",background:`linear-gradient(135deg,${C.accent}08,${C.accentBg})`,borderRadius:14,padding:"18px 20px",border:`1.5px solid ${C.accent}18`}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:14}}>综合评分对比</div>
                <div style={{display:"grid",gridTemplateColumns:`repeat(${list.length},1fr)`,gap:12}}>
                  {list.map((f,i)=>{
                    // Score: ytd_return (40%) + fee_rate invert (25%) + scale (15%) + track_error invert (20%)
                    const allYtd=list.map(x=>x.ytd_return||0), maxYtd=Math.max(...allYtd)||1;
                    const allFee=list.map(x=>x.fee_rate||0).filter(v=>v>0), maxFee=Math.max(...allFee)||1;
                    const allScale=list.map(x=>x.scale||0), maxScale=Math.max(...allScale)||1;
                    const allTE=list.map(x=>x.track_error||0).filter(v=>v>0), maxTE=Math.max(...allTE)||1;
                    const ytdScore=(f.ytd_return||0)/maxYtd*40;
                    const feeScore=f.fee_rate?((maxFee-(f.fee_rate||maxFee))/maxFee)*25:0;
                    const scaleScore=(f.scale||0)/maxScale*15;
                    const teScore=f.track_error?((maxTE-(f.track_error||maxTE))/maxTE)*20:0;
                    const total=Math.round(ytdScore+feeScore+scaleScore+teScore);
                    const allScores=list.map(g=>{
                      const ys=(g.ytd_return||0)/maxYtd*40;
                      const fs=g.fee_rate?((maxFee-(g.fee_rate||maxFee))/maxFee)*25:0;
                      const ss=(g.scale||0)/maxScale*15;
                      const ts=g.track_error?((maxTE-(g.track_error||maxTE))/maxTE)*20:0;
                      return Math.round(ys+fs+ss+ts);
                    });
                    const isTop=total===Math.max(...allScores);
                    return (
                      <div key={f.code} style={{textAlign:"center",padding:"16px 10px",background:isTop?COLORS[i]+"14":"#fff",borderRadius:12,border:`1.5px solid ${isTop?COLORS[i]:C.border}`,position:"relative"}}>
                        {isTop&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:COLORS[i],color:"#fff",fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:10}}>推荐</div>}
                        <div style={{fontSize:11,color:COLORS[i],fontWeight:700,marginBottom:8}}>{f.code}</div>
                        <div style={{fontSize:32,fontWeight:900,color:isTop?COLORS[i]:C.textMuted,lineHeight:1,marginBottom:4}}>{total}</div>
                        <div style={{fontSize:10,color:C.textDim}}>综合得分</div>
                        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:3,textAlign:"left"}}>
                          {[
                            {n:"收益",v:Math.round(ytdScore),t:40},
                            {n:"费率",v:Math.round(feeScore),t:25},
                            {n:"规模",v:Math.round(scaleScore),t:15},
                            {n:"误差",v:Math.round(teScore),t:20},
                          ].map(({n,v,t})=>(
                            <div key={n} style={{display:"flex",alignItems:"center",gap:4}}>
                              <span style={{fontSize:9,color:C.textDim,width:22,flexShrink:0}}>{n}</span>
                              <div style={{flex:1,height:4,background:C.borderLight,borderRadius:2,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${v/t*100}%`,background:COLORS[i],borderRadius:2,opacity:0.7}}/>
                              </div>
                              <span style={{fontSize:9,color:C.textDim,width:18,textAlign:"right"}}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{fontSize:10,color:C.textDim,marginTop:12}}>
                  综合得分 = 近1年收益(40%) + 费率优势(25%) + 规模实力(15%) + 跟踪精度(20%)，仅供参考
                </div>
              </div>
            </div>
          ):(
            /* ── Table view ── */
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:`2px solid ${C.border}`}}>
                  <th style={{width:120,padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:600,color:C.textDim,letterSpacing:0.5,textTransform:"uppercase"}}>指标</th>
                  {list.map((f,i)=>(
                    <th key={f.code} style={{padding:"10px 12px",textAlign:"center",minWidth:180}}>
                      <div style={{fontSize:11,color:C.textDim,fontFamily:"monospace",marginBottom:4}}>{f.code}</div>
                      <div style={{fontSize:12,fontWeight:700,color:C.text,lineHeight:1.35,maxWidth:175,margin:"0 auto"}}>{f.name}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row,ri)=>(
                  <tr key={row.label} style={{background:ri%2===0?"#fafafa":"#fff"}}>
                    <td style={{padding:"11px 12px",fontSize:12,color:C.textMuted,fontWeight:600}}>{row.label}</td>
                    {list.map(f=>(
                      <td key={f.code} style={{padding:"11px 12px",textAlign:"center",fontSize:13,color:C.text}}>{row.fmt(f)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

// ─── Admin Page ───────────────────────────────────────────────────────────────
function AdminPage() {
  const [status,setStatus]=useState(null);
  const [loading,setLoading]=useState(false);
  const [log,setLog]=useState([]);
  const trigger = async()=>{
    setLoading(true); setStatus(null);
    const t0=Date.now();
    const r=await apiFetch("/update");
    const elapsed=((Date.now()-t0)/1000).toFixed(1);
    if(r){setStatus({ok:r.status==="success",msg:r.message,elapsed});setLog(p=>[{time:new Date().toLocaleTimeString("zh-CN"),msg:r.message,ok:r.status==="success"},...p.slice(0,9)]);}
    else{setStatus({ok:false,msg:"无法连接后端 API",elapsed});}
    setLoading(false);
  };
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'SF Pro Display',-apple-system,sans-serif"}}>
      <div style={{width:"100%",maxWidth:520,padding:"0 24px"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:36,marginBottom:12}}>⚙️</div>
          <h1 style={{fontSize:22,fontWeight:800,color:C.text,margin:"0 0 6px",letterSpacing:-0.5}}>Wise<span style={{color:C.accent}}>ETF</span> 数据管理</h1>
          <p style={{color:C.textDim,fontSize:13,margin:0}}>手动触发数据更新，从天天基金网拉取最新数据</p>
        </div>
        <Card style={{padding:28,marginBottom:20}}>
          <div style={{fontSize:13,color:C.textMuted,marginBottom:20,lineHeight:1.9}}>
            <div>· 更新场外基金净值、涨幅、申购状态（41 只）</div>
            <div>· 更新场内 ETF 行情与溢价率</div>
            <div>· 预计耗时 2–3 分钟</div>
          </div>
          <button onClick={trigger} disabled={loading}
            style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",background:loading?C.borderLight:`linear-gradient(135deg,${C.accent},${C.accentDim})`,color:loading?C.textDim:"#fff",fontSize:15,fontWeight:700,cursor:loading?"wait":"pointer",transition:"all 0.2s",letterSpacing:0.3}}>
            {loading?"更新中，请稍候...":"立即更新数据"}
          </button>
        </Card>
        {status&&(
          <div style={{background:status.ok?C.greenBg:C.redBg,border:`1px solid ${status.ok?C.green:C.red}22`,borderRadius:12,padding:"12px 16px",marginBottom:16,fontSize:13}}>
            <span style={{color:status.ok?C.green:C.red,fontWeight:700}}>{status.ok?"✓ 成功":"✗ 失败"}</span>
            <span style={{color:C.textMuted,marginLeft:10}}>{status.msg} · {status.elapsed}s</span>
          </div>
        )}
        {log.length>0&&(
          <Card style={{padding:"16px 18px"}}>
            <div style={{fontSize:11,color:C.textDim,marginBottom:10,letterSpacing:0.6,textTransform:"uppercase",fontWeight:600}}>操作记录</div>
            {log.map((e,i)=>(
              <div key={i} style={{fontSize:12,color:C.textMuted,padding:"5px 0",borderBottom:i<log.length-1?`1px solid ${C.border}`:"none",display:"flex",gap:10}}>
                <span style={{color:C.textDim,fontFamily:"monospace"}}>{e.time}</span>
                <span style={{color:e.ok?C.green:C.red}}>{e.ok?"✓":"✗"}</span>
                <span>{e.msg}</span>
              </div>
            ))}
          </Card>
        )}
        <div style={{textAlign:"center",marginTop:20}}>
          <a href="/" style={{color:C.accent,fontSize:13,textDecoration:"none"}}>← 返回主站</a>
        </div>
      </div>
      <style>{`*{box-sizing:border-box}`}</style>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS=[
  {id:"overview",  label:"总览"},
  {id:"nasdaq",    label:"纳指被动"},
  {id:"sp500",     label:"标普500"},
  {id:"active",    label:"美股主动"},
  {id:"etf",       label:"场内ETF"},
  {id:"watchlist", label:"自选"},
];

// ─── Canvas Export Utilities ──────────────────────────────────────────────────
const EC={
  bg:'#07090f',card:'#0d1320',dim:'#131d2e',border:'#182033',head:'#0b1524',
  blue:'#3d82ff',green:'#26c258',red:'#ff3b30',orange:'#ff9a00',
  purple:'#a04cf5',cyan:'#14c8b4',white:'#edf0f9',muted:'#5e6270',
  F:'"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif',
};

function _rr(c,x,y,w,h,r=8){
  c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arcTo(x+w,y,x+w,y+r,r);
  c.lineTo(x+w,y+h-r);c.arcTo(x+w,y+h,x+w-r,y+h,r);c.lineTo(x+r,y+h);
  c.arcTo(x,y+h,x,y+h-r,r);c.lineTo(x,y+r);c.arcTo(x,y,x+r,y,r);c.closePath();
}

function _fit(c,v,maxW){
  if(v==null)return'—';const s=String(v);
  if(c.measureText(s).width<=maxW)return s;
  let t=s;while(t.length>1&&c.measureText(t+'…').width>maxW)t=t.slice(0,-1);
  return t+'…';
}

function drawTableCanvas({titleParts,date,cols,rows}){
  const W=1080,SC=2,PX=20;
  const F=EC.F;
  const BRAND_H=46,TITLE_H=88,CH=44,RH=40,FH=44;
  const H=BRAND_H+TITLE_H+CH+rows.length*RH+FH;
  const cvs=document.createElement('canvas');
  cvs.width=W*SC;cvs.height=H*SC;
  const c=cvs.getContext('2d');c.scale(SC,SC);

  // White background
  c.fillStyle='#FFFFFF';c.fillRect(0,0,W,H);

  // Top accent bar
  const ag=c.createLinearGradient(0,0,W,0);
  ag.addColorStop(0,'#1a56db');ag.addColorStop(1,'#7c3aed');
  c.fillStyle=ag;c.fillRect(0,0,W,5);

  // Brand row
  c.fillStyle='#f0f6ff';c.fillRect(0,5,W,BRAND_H-5);
  c.font=`bold 15px ${F}`;c.fillStyle='#1a56db';
  c.fillText('Wise 定投致富 整理',PX+4,32);
  c.font=`12px ${F}`;c.fillStyle='#9ca3af';
  c.textAlign='right';c.fillText('Wise-etf.org',W-PX,32);c.textAlign='left';

  // Title row
  c.fillStyle='#FFFFFF';c.fillRect(0,BRAND_H,W,TITLE_H);
  c.font=`bold 30px ${F}`;
  let tx=PX+4;
  const TY=BRAND_H+46;
  (titleParts||[]).forEach(p=>{
    c.fillStyle=p.color||'#0f172a';
    c.fillText(p.text,tx,TY);
    tx+=c.measureText(p.text).width;
  });
  // Date appended inline in blue
  c.font=`bold 22px ${F}`;c.fillStyle='#1a56db';
  // Format date for display: 2026/04/15 → 2026.4.15
  const dd=date.replace(/\//g,'.');c.fillText(`  (${dd})`,tx,TY);

  // Subtitle
  c.font=`12px ${F}`;c.fillStyle='#9ca3af';
  c.fillText('数据仅供参考，不构成投资建议',PX+4,BRAND_H+72);

  // Header separator
  c.strokeStyle='#dde3f0';c.lineWidth=1;
  c.beginPath();c.moveTo(0,BRAND_H+TITLE_H);c.lineTo(W,BRAND_H+TITLE_H);c.stroke();

  const tableY=BRAND_H+TITLE_H;
  const xp=[];let cx2=PX;for(const col of cols){xp.push(cx2);cx2+=col.w;}

  // Table header — blue gradient
  const hg=c.createLinearGradient(0,tableY,0,tableY+CH);
  hg.addColorStop(0,'#1e40af');hg.addColorStop(1,'#1a56db');
  c.fillStyle=hg;c.fillRect(0,tableY,W,CH);

  c.font=`bold 13px ${F}`;
  cols.forEach((col,i)=>{
    c.fillStyle='#FFFFFF';
    c.textAlign=col.right?'right':'left';
    c.fillText(col.label,col.right?xp[i]+col.w-8:xp[i]+8,tableY+CH/2+5);
  });
  c.textAlign='left';

  rows.forEach((row,ri)=>{
    const ry=tableY+CH+ri*RH;
    c.fillStyle=ri%2===0?'#FFFFFF':'#eef3ff';c.fillRect(0,ry,W,RH);
    c.strokeStyle='#dde3f0';c.lineWidth=0.5;
    c.beginPath();c.moveTo(0,ry+RH);c.lineTo(W,ry+RH);c.stroke();
    cols.forEach((col,ci)=>{
      const v=row[col.key];
      const cell=col.render?col.render(v,row):{text:v??'—'};
      const{text='—',color='#1a1a2e',bold=false,pill=false,pillBg=null}=cell;
      const cX=xp[ci],cW=col.w,ty=ry+RH/2+5;
      if(pill){
        c.font=`bold 11px ${F}`;
        const tw=c.measureText(text).width,pw=tw+20,ph=20;
        const px2=col.right?cX+cW-pw-6:cX+6,py2=ry+(RH-ph)/2;
        _rr(c,px2,py2,pw,ph,ph/2);c.fillStyle=pillBg||'#dbeafe';c.fill();
        c.fillStyle=color;c.textAlign='center';
        c.fillText(text,px2+pw/2,py2+14);c.textAlign='left';
      }else{
        c.font=`${bold?'bold ':''}13px ${F}`;
        c.textAlign=col.right?'right':'left';c.fillStyle=color;
        c.fillText(_fit(c,text,cW-10),col.right?cX+cW-8:cX+8,ty);
        c.textAlign='left';
      }
    });
  });

  const fy=tableY+CH+rows.length*RH;
  c.fillStyle='#f0f6ff';c.fillRect(0,fy,W,FH);
  c.strokeStyle='#dde3f0';c.lineWidth=1;
  c.beginPath();c.moveTo(0,fy);c.lineTo(W,fy);c.stroke();
  c.font=`12px ${F}`;c.fillStyle='#9ca3af';c.textAlign='center';
  c.fillText(`Wise-etf.org  ·  @Wise 定投致富 整理  ·  ${dd}`,W/2,fy+FH/2+5);
  c.textAlign='left';
  return cvs;
}

function drawOverviewCanvas({nasdaq,sp500,active,etfs,usdcny}){
  const W=900,SC=2,PX=28,GAP=14;
  const F=EC.F;
  const avg=(arr,k)=>{const vs=arr.map(e=>e[k]).filter(v=>v!=null);return vs.length?(vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(2):'—';};
  const nasdaqAvg=avg(nasdaq,'ytd_return');
  const sp500Avg=avg(sp500,'ytd_return');
  const activeAvg=avg(active,'ytd_return');
  const etfAvg=avg(etfs,'premium');
  const openCount=[...nasdaq,...sp500,...active].filter(f=>f.buy_status==='open').length;
  const totalCount=nasdaq.length+sp500.length+active.length;

  const HEADER_H=108,STATS_H=188,CHART_H=280,HIST_H=316,FX_H=268,FOOTER_H=56;
  const H=HEADER_H+STATS_H+CHART_H+HIST_H+FX_H+FOOTER_H;

  const cvs=document.createElement('canvas');
  cvs.width=W*SC;cvs.height=H*SC;
  const c=cvs.getContext('2d');c.scale(SC,SC);

  c.fillStyle=EC.bg;c.fillRect(0,0,W,H);

  // Header
  const hg=c.createLinearGradient(0,0,W,0);
  hg.addColorStop(0,'#0c1e3a');hg.addColorStop(1,'#0e0b24');
  c.fillStyle=hg;c.fillRect(0,0,W,HEADER_H);
  const ag=c.createLinearGradient(0,0,0,HEADER_H);
  ag.addColorStop(0,EC.blue);ag.addColorStop(1,EC.purple);
  c.fillStyle=ag;c.fillRect(0,0,5,HEADER_H);

  c.font=`bold 13px ${F}`;c.fillStyle=EC.blue;c.fillText('Wise ETF',PX+10,30);
  c.font=`bold 38px ${F}`;c.fillStyle=EC.white;c.fillText('每日市场快照',PX+10,74);
  const today=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
  c.font=`15px ${F}`;c.fillStyle=EC.muted;c.fillText(today,PX+10,96);
  if(usdcny){
    c.textAlign='right';
    c.font=`bold 22px ${F}`;c.fillStyle=EC.orange;c.fillText(`¥${usdcny}`,W-PX,68);
    c.font=`12px ${F}`;c.fillStyle=EC.muted;c.fillText('USD/CNY',W-PX,90);
    c.textAlign='left';
  }

  // Stat cards
  const statData=[
    {label:'纳指均涨幅',value:`+${nasdaqAvg}%`,sub:'近一年',color:EC.blue},
    {label:'标普均涨幅',value:`+${sp500Avg}%`,sub:'近一年',color:EC.cyan},
    {label:'主动均涨幅',value:`+${activeAvg}%`,sub:'近一年',color:EC.purple},
    {label:'ETF均溢价',value:`${etfAvg}%`,sub:'当前',color:EC.orange},
    {label:'可申购数',value:`${openCount}`,sub:`共${totalCount}只`,color:EC.green},
  ];
  const cW=(W-PX*2-GAP*4)/5,cH=128,sy=HEADER_H+22;
  statData.forEach((s,i)=>{
    const cx=PX+i*(cW+GAP);
    _rr(c,cx,sy,cW,cH,10);c.fillStyle=EC.card;c.fill();
    c.strokeStyle=EC.border;c.lineWidth=0.5;c.stroke();
    const bg=c.createLinearGradient(cx,sy,cx,sy+4);
    bg.addColorStop(0,s.color);bg.addColorStop(1,s.color+'00');
    _rr(c,cx,sy,cW,4,2);c.fillStyle=bg;c.fill();
    c.font=`bold 26px ${F}`;c.fillStyle=s.color;c.textAlign='center';
    c.fillText(s.value,cx+cW/2,sy+52);
    c.font=`11px ${F}`;c.fillStyle=EC.muted;c.fillText(s.sub,cx+cW/2,sy+72);
    c.font=`bold 12px ${F}`;c.fillStyle=EC.white;c.fillText(s.label,cx+cW/2,sy+98);
    c.textAlign='left';
  });

  // Chart section
  const charty=HEADER_H+STATS_H;
  c.font=`bold 16px ${F}`;c.fillStyle=EC.white;c.fillText('纳指 vs 标普 · 近12月收益率',PX,charty+28);
  c.font=`12px ${F}`;c.fillStyle=EC.muted;c.fillText('美元口径（2025.04 – 2026.03）',PX,charty+48);
  c.textAlign='right';
  c.fillStyle=EC.blue;c.fillRect(W-PX-126,charty+18,12,12);
  c.font=`11px ${F}`;c.fillStyle=EC.muted;c.fillText('纳斯达克100',W-PX,charty+29);
  c.fillStyle=EC.cyan;c.fillRect(W-PX-56,charty+18,12,12);
  c.fillText('标普500',W-PX-36+6,charty+29);
  c.textAlign='left';

  const chartX=PX+44,chartTopY=charty+58,chartW=W-PX*2-44,chartH2=176;
  const allVals=[...MONTHLY_12M.map(d=>d.nasdaq),...MONTHLY_12M.map(d=>d.sp500)];
  const maxV=Math.ceil(Math.max(...allVals.map(v=>Math.abs(v)))/5)*5||10;
  const zeroY=chartTopY+chartH2/2;

  // Grid lines
  [maxV,maxV/2,0,-maxV/2,-maxV].forEach(v=>{
    const yy=chartTopY+chartH2*(1-v/maxV)/2;
    c.strokeStyle=EC.border+(v===0?'ff':'60');c.lineWidth=v===0?1:0.5;
    c.beginPath();c.moveTo(chartX,yy);c.lineTo(chartX+chartW,yy);c.stroke();
    c.font=`10px ${F}`;c.fillStyle=EC.muted;c.textAlign='right';
    c.fillText(v===0?'0':v+'%',chartX-4,yy+4);
  });
  c.textAlign='left';

  const groupW=chartW/MONTHLY_12M.length;
  const bW=Math.floor(groupW*0.26);
  MONTHLY_12M.forEach((d,i)=>{
    const gx=chartX+i*groupW;
    const nx=gx+(groupW-bW*2-3)/2;
    const nh=Math.max(Math.abs(d.nasdaq)/maxV*chartH2/2,1);
    const ny=d.nasdaq>=0?zeroY-nh:zeroY;
    _rr(c,nx,ny,bW,nh,2);c.fillStyle=d.nasdaq>=0?EC.blue:EC.blue+'99';c.fill();
    const sx2=nx+bW+3;
    const sh=Math.max(Math.abs(d.sp500)/maxV*chartH2/2,1);
    const sy2=d.sp500>=0?zeroY-sh:zeroY;
    _rr(c,sx2,sy2,bW,sh,2);c.fillStyle=d.sp500>=0?EC.cyan:EC.cyan+'99';c.fill();
    c.font=`10px ${F}`;c.fillStyle=EC.muted;c.textAlign='center';
    c.fillText(d.month,gx+groupW/2,chartTopY+chartH2+18);
    c.textAlign='left';
  });

  // ─── Section 3: 35年复利曲线（对数坐标）
  const histY=HEADER_H+STATS_H+CHART_H;

  // Compute cumulative returns from 1990
  const years=Object.keys(INDEX_ANNUAL.nasdaq).map(Number).sort();
  let nV=100,sV=100;
  const cumPts=[[1989,100,100]];
  years.forEach(y=>{nV*=(1+(INDEX_ANNUAL.nasdaq[y]||0)/100);sV*=(1+(INDEX_ANNUAL.sp500[y]||0)/100);cumPts.push([y,+nV.toFixed(1),+sV.toFixed(1)]);});
  const nFinal=cumPts[cumPts.length-1][1],sFinal=cumPts[cumPts.length-1][2];

  // Draw section bg + divider
  c.fillStyle=EC.bg;c.fillRect(0,histY,W,HIST_H);
  c.strokeStyle=EC.border;c.lineWidth=1;c.beginPath();c.moveTo(0,histY);c.lineTo(W,histY);c.stroke();

  // Section title
  c.font=`bold 16px ${F}`;c.fillStyle=EC.white;
  c.fillText('纳指 & 标普 · 35年复利增长',PX,histY+30);
  c.font=`12px ${F}`;c.fillStyle=EC.muted;
  c.fillText(`1990–2025  ·  以100为起点  ·  对数坐标`,PX,histY+50);
  // legends
  c.textAlign='right';
  c.fillStyle=EC.blue;c.fillRect(W-PX-120,histY+18,10,10);
  c.font=`11px ${F}`;c.fillStyle=EC.muted;c.fillText(`纳指 →${nFinal.toFixed(0)}x`,W-PX,histY+28);
  c.fillStyle=EC.cyan;c.fillRect(W-PX-50,histY+18,10,10);
  c.fillText(`标普 →${sFinal.toFixed(0)}x`,W-PX,histY+44);
  c.textAlign='left';

  const hcX=PX+44,hcY=histY+62,hcW=W-PX*2-44,hcH=210;
  const logMin=Math.log10(60),logMax=Math.log10(Math.max(nFinal,sFinal)*1.3);
  const toY2=v=>hcY+hcH*(1-(Math.log10(Math.max(v,1))-logMin)/(logMax-logMin));

  // Grid lines (log scale levels)
  [100,300,1000,3000,10000,30000].forEach(v=>{
    const yy=toY2(v);
    if(yy<hcY-4||yy>hcY+hcH+4) return;
    c.strokeStyle=EC.border+(v===100?'ff':'50');c.lineWidth=v===100?1:0.5;
    c.beginPath();c.moveTo(hcX,yy);c.lineTo(hcX+hcW,yy);c.stroke();
    c.font=`9px ${F}`;c.fillStyle=EC.muted;c.textAlign='right';
    c.fillText(v>=1000?`${v/1000}k`:String(v),hcX-4,yy+3);
  });
  c.textAlign='left';

  // X axis labels (every 5 years)
  const xYrs=[1990,1995,2000,2005,2010,2015,2020,2025];
  xYrs.forEach(y=>{
    const xx=hcX+(y-1989)/(2025-1989)*hcW;
    c.font=`9px ${F}`;c.fillStyle=EC.muted;c.textAlign='center';c.fillText(String(y),xx,hcY+hcH+14);
  });
  c.textAlign='left';

  // 2008/2020 recession markers
  [{y:2000,label:'科网泡沫'},{y:2008,label:'金融危机'},{y:2020,label:'新冠'}].forEach(({y,label})=>{
    const xx=hcX+(y-1989)/(2025-1989)*hcW;
    c.strokeStyle=EC.border+'80';c.lineWidth=0.5;c.setLineDash([3,3]);
    c.beginPath();c.moveTo(xx,hcY);c.lineTo(xx,hcY+hcH);c.stroke();
    c.setLineDash([]);
    c.font=`8px ${F}`;c.fillStyle=EC.muted+'99';c.textAlign='center';c.fillText(label,xx,hcY+hcH+26);
  });
  c.textAlign='left';

  // Nasdaq fill area
  c.beginPath();
  cumPts.forEach(([y,n],i)=>{const xx=hcX+(y-1989)/(2025-1989)*hcW;const yy=toY2(n);if(i===0)c.moveTo(xx,yy);else c.lineTo(xx,yy);});
  c.lineTo(hcX+hcW,hcY+hcH);c.lineTo(hcX,hcY+hcH);c.closePath();
  const nasFill=c.createLinearGradient(0,hcY,0,hcY+hcH);
  nasFill.addColorStop(0,EC.blue+'55');nasFill.addColorStop(1,EC.blue+'08');
  c.fillStyle=nasFill;c.fill();

  // SP500 fill area
  c.beginPath();
  cumPts.forEach(([y,,s],i)=>{const xx=hcX+(y-1989)/(2025-1989)*hcW;const yy=toY2(s);if(i===0)c.moveTo(xx,yy);else c.lineTo(xx,yy);});
  c.lineTo(hcX+hcW,hcY+hcH);c.lineTo(hcX,hcY+hcH);c.closePath();
  const spFill=c.createLinearGradient(0,hcY,0,hcY+hcH);
  spFill.addColorStop(0,EC.cyan+'40');spFill.addColorStop(1,EC.cyan+'05');
  c.fillStyle=spFill;c.fill();

  // Nasdaq line
  c.strokeStyle=EC.blue;c.lineWidth=2.5;c.beginPath();
  cumPts.forEach(([y,n],i)=>{const xx=hcX+(y-1989)/(2025-1989)*hcW;const yy=toY2(n);if(i===0)c.moveTo(xx,yy);else c.lineTo(xx,yy);});
  c.stroke();

  // SP500 line
  c.strokeStyle=EC.cyan;c.lineWidth=2;c.beginPath();
  cumPts.forEach(([y,,s],i)=>{const xx=hcX+(y-1989)/(2025-1989)*hcW;const yy=toY2(s);if(i===0)c.moveTo(xx,yy);else c.lineTo(xx,yy);});
  c.stroke();

  // ─── Section 4: 汇率影响剥离分析（2015年起）
  const fxY=histY+HIST_H;
  c.strokeStyle=EC.border;c.lineWidth=1;c.beginPath();c.moveTo(0,fxY);c.lineTo(W,fxY);c.stroke();
  c.fillStyle=EC.bg;c.fillRect(0,fxY,W,FX_H);

  // Section title
  c.font=`bold 16px ${F}`;c.fillStyle=EC.white;c.fillText('汇率影响剥离分析',PX,fxY+30);
  c.font=`12px ${F}`;c.fillStyle=EC.muted;c.fillText('2015–2025  ·  人民币持有 vs 美元持有  ·  以100为基准，差距即汇率净贡献',PX,fxY+50);

  // Compute FX-adjusted cumulative
  const fxYrs=Object.keys(FX_ANNUAL).map(Number).sort();
  let nuSD=100,nuCNY=100,suSD=100,suCNY=100;
  const fxPts=[[2014,100,100,100,100]];
  fxYrs.forEach(y=>{
    const[startFX2,endFX]=FX_ANNUAL[y];
    const fx=endFX/startFX2;
    const nr=1+(INDEX_ANNUAL.nasdaq[y]||0)/100;
    const sr=1+(INDEX_ANNUAL.sp500[y]||0)/100;
    nuSD*=nr;nuCNY*=nr*fx;suSD*=sr;suCNY*=sr*fx;
    fxPts.push([y,+nuSD.toFixed(1),+nuCNY.toFixed(1),+suSD.toFixed(1),+suCNY.toFixed(1)]);
  });
  const lastFX=fxPts[fxPts.length-1];
  const nUSDv=lastFX[1],nCNYv=lastFX[2],sUSDv=lastFX[3],sCNYv=lastFX[4];
  const nFXc=+(nCNYv-nUSDv).toFixed(1);
  const sFXc=+(sCNYv-sUSDv).toFixed(1);

  // Stat cards (4 across)
  const statCard=(x,y,w,h,label,sub,val,col,bg)=>{
    _rr(c,x,y,w,h,8);c.fillStyle=bg;c.fill();
    c.strokeStyle=EC.border;c.lineWidth=0.5;c.stroke();
    c.font=`bold 22px ${F}`;c.fillStyle=col;c.textAlign='center';c.fillText(val,x+w/2,y+38);
    c.font=`11px ${F}`;c.fillStyle=EC.muted;c.fillText(sub,x+w/2,y+55);
    c.font=`bold 11px ${F}`;c.fillStyle=EC.white;c.fillText(label,x+w/2,y+75);
    c.textAlign='left';
  };
  const scW=(W-PX*2-GAP*3)/4,scH=88,scY=fxY+64;
  statCard(PX,scY,scW,scH,'纳指·美元累计',`+${(nUSDv-100).toFixed(0)}%`,`${nUSDv.toFixed(0)}`,EC.blue,EC.card);
  statCard(PX+scW+GAP,scY,scW,scH,'纳指·人民币累计',`+${(nCNYv-100).toFixed(0)}%`,`${nCNYv.toFixed(0)}`,EC.blue,EC.card);
  statCard(PX+(scW+GAP)*2,scY,scW,scH,'标普·美元累计',`+${(sUSDv-100).toFixed(0)}%`,`${sUSDv.toFixed(0)}`,EC.cyan,EC.card);
  statCard(PX+(scW+GAP)*3,scY,scW,scH,'标普·人民币累计',`+${(sCNYv-100).toFixed(0)}%`,`${sCNYv.toFixed(0)}`,EC.cyan,EC.card);

  // FX contribution labels
  const fxCol=nFXc>=0?EC.green:EC.red;
  const fxColS=sFXc>=0?EC.green:EC.red;
  c.font=`11px ${F}`;c.fillStyle=EC.muted;c.textAlign='center';
  c.fillText(`纳指汇率贡献: ${nFXc>=0?'+':''}${nFXc}%`,PX+scW,scY+scH+16);
  c.fillStyle=fxCol;c.fillText(nFXc>=0?'▲':'▼',PX+scW-20,scY+scH+16);
  c.fillStyle=EC.muted;c.fillText(`标普汇率贡献: ${sFXc>=0?'+':''}${sFXc}%`,PX+(scW+GAP)*3,scY+scH+16);
  c.fillStyle=fxColS;c.fillText(sFXc>=0?'▲':'▼',PX+(scW+GAP)*3-20,scY+scH+16);
  c.textAlign='left';

  // Mini dual line chart for FX divergence (纳指)
  const fc2X=PX+44,fc2Y=fxY+176,fc2W=W/2-PX-60,fc2H=68;
  const fc3X=W/2+16,fc3Y=fxY+176,fc3W=W/2-PX-36,fc3H=68;
  const allVals2=[...fxPts.map(p=>p[1]),...fxPts.map(p=>p[2]),...fxPts.map(p=>p[3]),...fxPts.map(p=>p[4])];
  const fvMin=Math.min(...allVals2)*0.95,fvMax=Math.max(...allVals2)*1.02;
  const toFY=(v,top,h)=>top+h*(1-(v-fvMin)/(fvMax-fvMin));

  const drawFXMini=(cx,cy,cw,ch,usdIdx,cnyIdx,col,titleStr)=>{
    c.font=`bold 11px ${F}`;c.fillStyle=col;c.fillText(titleStr,cx,cy-4);
    c.strokeStyle=EC.border+'50';c.lineWidth=0.5;
    c.beginPath();c.moveTo(cx,cy);c.lineTo(cx,cy+ch);c.lineTo(cx+cw,cy+ch);c.stroke();
    // USD line
    c.strokeStyle=col;c.lineWidth=1.5;c.beginPath();
    fxPts.forEach(([,nuSD2,nuCNY2,suSD2,suCNY2],i)=>{
      const vals=[nuSD2,nuCNY2,suSD2,suCNY2];
      const xx=cx+i/(fxPts.length-1)*cw;
      const yy=toFY(vals[usdIdx],cy,ch);
      if(i===0)c.moveTo(xx,yy);else c.lineTo(xx,yy);
    });c.stroke();
    // CNY line (dashed)
    c.strokeStyle=EC.orange;c.lineWidth=1.5;c.setLineDash([4,3]);c.beginPath();
    fxPts.forEach(([,nuSD2,nuCNY2,suSD2,suCNY2],i)=>{
      const vals=[nuSD2,nuCNY2,suSD2,suCNY2];
      const xx=cx+i/(fxPts.length-1)*cw;
      const yy=toFY(vals[cnyIdx],cy,ch);
      if(i===0)c.moveTo(xx,yy);else c.lineTo(xx,yy);
    });c.stroke();c.setLineDash([]);
    // year labels
    c.font=`8px ${F}`;c.fillStyle=EC.muted;c.textAlign='center';
    [2015,2018,2021,2025].forEach((y,i)=>{
      const idx=fxPts.findIndex(p=>p[0]===y);
      if(idx<0)return;
      const xx=cx+idx/(fxPts.length-1)*cw;
      c.fillText(String(y),xx,cy+ch+12);
    });
    c.textAlign='left';
    // legend
    c.font=`9px ${F}`;c.fillStyle=col;c.fillText('美元',cx+cw+4,cy+10);
    c.fillStyle=EC.orange;c.fillText('人民币',cx+cw+4,cy+24);
  };
  drawFXMini(fc2X,fc2Y,fc2W,fc2H,0,1,EC.blue,'纳指100  美元 vs 人民币');
  drawFXMini(fc3X,fc3Y,fc3W,fc3H,2,3,EC.cyan,'标普500  美元 vs 人民币');

  // Footer
  const fy=H-FOOTER_H;
  c.fillStyle=EC.head;c.fillRect(0,fy,W,FOOTER_H);
  c.font=`12px ${F}`;c.fillStyle=EC.muted+'80';c.textAlign='center';
  c.fillText('Wise-etf.org  ·  数据仅供参考，不构成投资建议',W/2,fy+FOOTER_H/2+5);
  c.textAlign='left';
  return cvs;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  if(window.location.pathname==="/admin") return <AdminPage/>;

  const [activeTab,setActiveTab]=useState("overview");
  const [sortKey,setSortKey]=useState(null);
  const [sortDir,setSortDir]=useState("desc");
  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState("all");
  const [selETF,setSelETF]=useState("513100");
  const [scrolled,setScrolled]=useState(false);
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [showDisclaimer,setShowDisclaimer]=useState(()=>{
    if(typeof window!=="undefined"&&window.innerWidth<=768){
      localStorage.setItem("etf-disclaimer","1");
      return false;
    }
    return !localStorage.getItem("etf-disclaimer");
  });
  const [exportPreview,setExportPreview]=useState(null); // { url, filename }
  const [showBriefing,setShowBriefing]=useState(()=>{
    if(!localStorage.getItem("etf-disclaimer")) return false;
    if(localStorage.getItem("group_chat_no_show")===new Date().toDateString()) return false;
    const last=localStorage.getItem("group_chat_last_shown");
    if(!last) return true;
    return Date.now()-parseInt(last)>3*60*60*1000;
  });
  const [favorites,setFavorites]=useState(()=>JSON.parse(localStorage.getItem("etf-favorites")||"[]"));
  const [lastUpdate,setLastUpdate]=useState(null);
  const [dataLoading,setDataLoading]=useState(false);
  const [usdcny,setUsdcny]=useState(null);
  const [sentiment,setSentiment]=useState(null);
  const [compareList,setCompareList]=useState([]);
  const [showCompare,setShowCompare]=useState(false);
  const [showWechat,setShowWechat]=useState(false);
  const navRef=useRef(null);
  const [indicator,setIndicator]=useState({left:0,width:0,opacity:0});

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 768;

  const [nasdaq,setNasdaq]=useState(FALLBACK.nasdaq_passive);
  const [sp500, setSp500 ]=useState(FALLBACK.sp500_passive);
  const [active,setActive]=useState(FALLBACK.us_active);
  const [etfs,  setEtfs  ]=useState(FALLBACK.etfs);
  // 同步读缓存，避免首屏 loading 闪烁
  const [liveData,setLiveData]=useState(()=>{
    try{
      const raw=localStorage.getItem("wise_etf_live");
      if(!raw) return {};
      const {data,ts}=JSON.parse(raw);
      const H21=21*3600*1000,DAY=24*3600*1000;
      if(ts>=Math.floor((Date.now()-H21)/DAY)*DAY+H21) return data;
    }catch{}
    return {};
  });
  const [liveTs,setLiveTs]=useState(()=>{
    try{
      const raw=localStorage.getItem("wise_etf_live");
      if(!raw) return null;
      const {liveTs,ts}=JSON.parse(raw);
      const H21=21*3600*1000,DAY=24*3600*1000;
      if(ts>=Math.floor((Date.now()-H21)/DAY)*DAY+H21) return liveTs||null;
    }catch{}
    return null;
  });

  useEffect(()=>{
    const h=()=>{setScrolled(window.scrollY>8);};
    window.addEventListener("scroll",h,{passive:true});
    return()=>window.removeEventListener("scroll",h);
  },[]);

  // Sliding tab indicator
  useEffect(()=>{
    if(!navRef.current) return;
    const btn=navRef.current.querySelector(`[data-tab="${activeTab}"]`);
    if(!btn) return;
    const nr=navRef.current.getBoundingClientRect();
    const br=btn.getBoundingClientRect();
    setIndicator({left:br.left-nr.left,width:br.width,opacity:1});
  },[activeTab]);

  useEffect(()=>{
    // 仅拉取 overview 时间戳，不阻塞渲染（基金静态数据已内置 FALLBACK）
    apiFetch("/overview").then(ov=>{ if(ov?.last_update) setLastUpdate(ov.last_update); });
    // 拉取场内ETF实时行情（含溢价率），以 FALLBACK 为兜底
    apiFetch("/etfs").then(d=>{ if(d?.data?.length) setEtfs(d.data); });
    // 拉取市场情绪指标
    apiFetch("/market-sentiment").then(d=>{ if(d?.data) setSentiment(d.data); });
  },[]);

  // ── 实时行情（day_change / rolling_1y / buy_status / daily_limit）
  // 数据每日在北京时间凌晨5点（美股收盘后）更新一次，缓存到下一个北京时间5点再失效
  useEffect(()=>{
    const CACHE_KEY="wise_etf_live";
    const H21=21*3600*1000,DAY=24*3600*1000;
    const lastBeijing5am=()=>Math.floor((Date.now()-H21)/DAY)*DAY+H21;
    // 已在 useState 初始化时同步加载缓存；这里只在缓存失效时重新拉取
    try{
      const raw=localStorage.getItem(CACHE_KEY);
      if(raw){const {ts}=JSON.parse(raw);if(ts>=lastBeijing5am()) return;}
    }catch{}
    apiFetch("/live_data").then(d=>{
      if(d?.data){
        const timeStr=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
        setLiveData(d.data);
        setLiveTs(timeStr);
        try{ localStorage.setItem(CACHE_KEY,JSON.stringify({data:d.data,ts:Date.now(),liveTs:timeStr})); }catch{}
      }
    });
  },[]);

  useEffect(()=>{
    (async()=>{
      // 优先：ExchangeRate-API (免费，数据准确，更新及时)
      try {
        const r=await fetch("https://open.er-api.com/v6/latest/USD");
        const d=await r.json();
        if(d.result==="success"&&d.rates?.CNY) {setUsdcny(d.rates.CNY.toFixed(4));return;}
      } catch{}
      // 备用：Fawazahmed0 CDN
      try {
        const r=await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json");
        const d=await r.json();
        if(d.usd?.cny) {setUsdcny(d.usd.cny.toFixed(4));return;}
      } catch{}
      // 兜底：使用静态近期值
      setUsdcny("7.2400");
    })();
  },[]);

  const handleSort = k => {
    if(sortKey===k) setSortDir(d=>d==="asc"?"desc":"asc");
    else{setSortKey(k);setSortDir("desc");}
  };
  const parseDailyLimit = v => {
    if(!v||v==="暂停申购") return -1;
    if(v==="不限额") return Infinity;
    const n = parseFloat(String(v).replace(/[^\d.]/g,""));
    return isNaN(n)?-1:n;
  };
  const sortData = data => {
    if(!sortKey) return data;
    return [...data].sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      if(sortKey==="daily_limit"){
        const na=parseDailyLimit(av),nb=parseDailyLimit(bv);
        return sortDir==="asc"?na-nb:nb-na;
      }
      if(typeof av==="number"&&typeof bv==="number") return sortDir==="asc"?av-bv:bv-av;
      return sortDir==="asc"?String(av||"").localeCompare(String(bv||"")):String(bv||"").localeCompare(String(av||""));
    });
  };
  const switchTab = id=>{setActiveTab(id);setSortKey(null);setSearch("");setStatusFilter("all");window.scrollTo({top:0,behavior:"smooth"});};

  const [premHist, setPremHist] = useState([]);
  const [premHistLoading, setPremHistLoading] = useState(false);
  useEffect(()=>{
    setPremHistLoading(true);
    setPremHist([]);
    apiFetch(`/premium_history/${selETF}`).then(d=>{
      if(d?.data?.length) setPremHist(d.data);
      setPremHistLoading(false);
    });
  },[selETF]);

  const filterData = data => {
    let filtered = data;
    if(search.trim()){
      const q=search.trim().toLowerCase();
      filtered=filtered.filter(f=>(f.name||"").toLowerCase().includes(q)||(f.code||"").toLowerCase().includes(q));
    }
    if(statusFilter==="open")      filtered=filtered.filter(f=>f.buy_status==="open");
    if(statusFilter==="suspended") filtered=filtered.filter(f=>f.buy_status==="suspended");
    return filtered;
  };
  const toggleFavorite = code=>{
    setFavorites(prev=>{
      const next=prev.includes(code)?prev.filter(c=>c!==code):[...prev,code];
      localStorage.setItem("etf-favorites",JSON.stringify(next));
      return next;
    });
  };
  const toggleCompare = row=>{
    setCompareList(prev=>{
      if(prev.some(f=>f.code===row.code)) return prev.filter(f=>f.code!==row.code);
      if(prev.length>=4) return prev;
      const cat=nasdaq.some(f=>f.code===row.code)?"纳指被动"
        :sp500.some(f=>f.code===row.code)?"标普500"
        :active.some(f=>f.code===row.code)?"美股主动":"场内ETF";
      return [...prev,{...row,_cat:cat}];
    });
  };

  const avg=(arr,k)=>arr.length?(arr.reduce((s,f)=>s+(f[k]||0),0)/arr.length).toFixed(1):"0";
  const totalFunds = nasdaq.length+sp500.length+active.length+etfs.length;
  const openFunds  = [...nasdaq,...sp500,...active].filter(f=>f.buy_status==="open").length+etfs.length;
  const topPerf    = [...active].sort((a,b)=>(b.ytd_return||0)-(a.ytd_return||0)).slice(0,5);

  // 合并 liveData 到各基金数组
  // 只合并非 null 字段，API 失败时保留静态兜底值
  const mergeLive = useCallback((arr)=>arr.map(f=>{
    const live=liveData[f.code];
    if(!live) return f;
    const patch=Object.fromEntries(Object.entries(live).filter(([,v])=>v!=null));
    return {...f,...patch};
  }),[liveData]);
  const nasdaqM = useMemo(()=>mergeLive(nasdaq),[nasdaq,mergeLive]);
  const sp500M  = useMemo(()=>mergeLive(sp500), [sp500, mergeLive]);
  const activeM = useMemo(()=>mergeLive(active),[active,mergeLive]);
  const etfsM   = useMemo(()=>mergeLive(etfs),  [etfs,  mergeLive]);

  // ── 申购上限排序（高→低，暂停在底）
  const byLimit = useCallback((arr)=>{
    const parse=s=>{
      if(!s||s==='暂停申购') return -1;
      if(s==='不限额') return 9999999;
      return parseFloat(s)||0;
    };
    return [...arr].sort((a,b)=>parse(b.daily_limit)-parse(a.daily_limit));
  },[]);

  // ── Export handlers（放在 nasdaqM 之后才能引用）
  const handleExport = useCallback(()=>{
    const cvs = drawOverviewCanvas({nasdaq:nasdaqM, sp500:sp500M, active:activeM, etfs:etfsM, usdcny});
    const today = new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
    setExportPreview({url:cvs.toDataURL('image/png'), filename:`wise-etf-overview-${today.replace(/\//g,'-')}.png`});
  },[nasdaqM, sp500M, activeM, etfsM, usdcny]);

  const handleExportNasdaqTable = useCallback(()=>{
    const today = new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
    const cols=[
      {label:'A类代码',    key:'code',        w:72,render:v=>({text:v,color:'#1a56db',bold:true})},
      {label:'基金名称',   key:'name',        w:262,render:v=>({text:v,color:'#0f172a'})},
      {label:'C类代码',    key:'code_c',      w:72,render:v=>({text:v||'—',color:'#7c3aed',bold:!!v})},
      {label:'总费率',     key:'fee_rate',    w:66,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>0.8?'#e85d04':'#374151'})},
      {label:'规模(亿)',   key:'scale',       w:72,right:true,render:v=>({text:v??'—',color:'#374151'})},
      {label:'25年涨幅',   key:'ytd_return',  w:88,right:true,render:v=>({text:v!=null?`${v>0?'+':''}${v}%`:'—',color:v>0?'#16a34a':v<0?'#dc2626':'#374151',bold:true})},
      {label:'昨日涨幅',   key:'day_change',  w:82,right:true,render:v=>({text:v!=null?`${v>0?'+':''}${v}%`:'—',color:v>0?'#16a34a':v<0?'#dc2626':'#374151'})},
      {label:'跟踪误差',   key:'track_error', w:78,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>2.5?'#e85d04':'#374151'})},
      {label:'每日申购上限',key:'daily_limit', w:104,right:true,render:(v,row)=>({text:v||'—',color:row.buy_status==='suspended'?'#9ca3af':'#374151'})},
      {label:'申购状态',   key:'buy_status',  w:90,render:v=>v==='open'?{text:'可申购',pill:true,pillBg:'#dcfce7',color:'#16a34a'}:{text:'暂停',pill:true,pillBg:'#f3f4f6',color:'#9ca3af'}},
    ];
    const cvs=drawTableCanvas({titleParts:[
      {text:'场外',color:'#0f172a'},{text:'纳斯达克',color:'#e85d04'},{text:'（被动型）基金对比',color:'#0f172a'}
    ],date:today,cols,rows:byLimit(nasdaqM)});
    setExportPreview({url:cvs.toDataURL('image/png'),filename:`wise-etf-nasdaq-${today.replace(/\//g,'-')}.png`});
  },[nasdaqM, byLimit]);

  const handleExportSP500ETFTable = useCallback(()=>{
    const today = new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
    const passiveCols=[
      {label:'A类代码',    key:'code',        w:72,render:v=>({text:v,color:'#1a56db',bold:true})},
      {label:'基金名称',   key:'name',        w:260,render:v=>({text:v,color:'#0f172a'})},
      {label:'C类代码',    key:'code_c',      w:72,render:v=>({text:v||'—',color:'#7c3aed',bold:!!v})},
      {label:'总费率',     key:'fee_rate',    w:66,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>0.9?'#e85d04':'#374151'})},
      {label:'规模(亿)',   key:'scale',       w:72,right:true,render:v=>({text:v??'—',color:'#374151'})},
      {label:'25年涨幅',   key:'ytd_return',  w:88,right:true,render:v=>({text:v!=null?`${v>0?'+':''}${v}%`:'—',color:v>0?'#16a34a':v<0?'#dc2626':'#374151',bold:true})},
      {label:'昨日涨幅',   key:'day_change',  w:82,right:true,render:v=>({text:v!=null?`${v>0?'+':''}${v}%`:'—',color:v>0?'#16a34a':v<0?'#dc2626':'#374151'})},
      {label:'跟踪误差',   key:'track_error', w:78,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>2.5?'#e85d04':'#374151'})},
      {label:'每日申购上限',key:'daily_limit', w:104,right:true,render:(v,row)=>({text:v||'—',color:row.buy_status==='suspended'?'#9ca3af':'#374151'})},
      {label:'申购状态',   key:'buy_status',  w:90,render:v=>v==='open'?{text:'可申购',pill:true,pillBg:'#dcfce7',color:'#16a34a'}:{text:'暂停',pill:true,pillBg:'#f3f4f6',color:'#9ca3af'}},
    ];
    const etfCols=[
      {label:'代码',       key:'code',           w:76,render:v=>({text:v,color:'#1a56db',bold:true})},
      {label:'ETF名称',    key:'name',           w:238,render:v=>({text:v,color:'#0f172a'})},
      {label:'跟踪指数',   key:'tracking_index', w:150,render:v=>({text:v||'—',color:'#6b7280'})},
      {label:'总费率',     key:'fee_rate',       w:70,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>=1.0?'#e85d04':'#374151'})},
      {label:'规模(亿)',   key:'scale',          w:76,right:true,render:v=>({text:v??'—',color:'#374151'})},
      {label:'近1年涨幅',  key:'ytd_return',     w:96,right:true,render:v=>({text:v!=null?`+${v}%`:'—',color:'#16a34a',bold:true})},
      {label:'溢价率',     key:'premium',        w:80,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>1.5?'#e85d04':v>0?'#374151':'#9ca3af'})},
      {label:'日均成交(亿)',key:'volume',         w:96,right:true,render:v=>({text:v??'—',color:'#374151'})},
      {label:'交易方式',   key:'buy_status',     w:86,render:()=>({text:'场内交易',pill:true,pillBg:'#dbeafe',color:'#1a56db'})},
    ];
    const c1=drawTableCanvas({titleParts:[
      {text:'场外',color:'#0f172a'},{text:'标普500',color:'#dc2626'},{text:'基金对比',color:'#0f172a'}
    ],date:today,cols:passiveCols,rows:byLimit(sp500M)});
    const c2=drawTableCanvas({titleParts:[
      {text:'场内',color:'#0f172a'},{text:'ETF',color:'#1a56db'},{text:'（纳指 / 标普）',color:'#0f172a'}
    ],date:today,cols:etfCols,rows:etfsM});
    const GAP=32,W=c1.width;
    const combined=document.createElement('canvas');
    combined.width=W;combined.height=c1.height+GAP+c2.height;
    const ctx=combined.getContext('2d');
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,combined.width,combined.height);
    ctx.drawImage(c1,0,0);ctx.drawImage(c2,0,c1.height+GAP);
    setExportPreview({url:combined.toDataURL('image/png'),filename:`wise-etf-sp500-etf-${today.replace(/\//g,'-')}.png`});
  },[sp500M, etfsM, byLimit]);

  const handleExportActiveTable = useCallback(()=>{
    const today = new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
    const cols=[
      {label:'基金代码',   key:'code',        w:80,render:v=>({text:v,color:'#7c3aed',bold:true})},
      {label:'基金名称',   key:'name',        w:316,render:v=>({text:v,color:'#0f172a'})},
      {label:'运作费率',   key:'fee_rate',    w:78,right:true,render:v=>({text:v!=null?`${v}%`:'—',color:v>1.4?'#e85d04':'#374151'})},
      {label:'规模(亿)',   key:'scale',       w:76,right:true,render:v=>({text:v??'—',color:'#374151'})},
      {label:'近1年涨幅',  key:'ytd_return',  w:96,right:true,render:v=>({text:v!=null?`+${v}%`:'—',color:'#16a34a',bold:true})},
      {label:'每日申购上限',key:'daily_limit', w:120,right:true,render:(v,row)=>({text:v||'—',color:row.buy_status==='suspended'?'#9ca3af':'#374151'})},
      {label:'申购状态',   key:'buy_status',  w:102,render:v=>v==='open'?{text:'可申购',pill:true,pillBg:'#dcfce7',color:'#16a34a'}:{text:'暂停',pill:true,pillBg:'#f3f4f6',color:'#9ca3af'}},
    ];
    const cvs=drawTableCanvas({titleParts:[
      {text:'场外',color:'#0f172a'},{text:'美股',color:'#dc2626'},{text:'（主动型）基金对比',color:'#0f172a'}
    ],date:today,cols,rows:activeM});
    setExportPreview({url:cvs.toDataURL('image/png'),filename:`wise-etf-active-${today.replace(/\//g,'-')}.png`});
  },[activeM]);

  const maxReturn  = Math.max(...[...nasdaqM,...sp500M,...activeM].map(f=>f.ytd_return||0));

  const actionsCol=(accent)=>({key:"_act",label:"",sortable:false,align:"center",render:(_,row)=>{
    const isFav=favorites.includes(row.code);
    const inCmp=compareList.some(f=>f.code===row.code);
    const cmpFull=compareList.length>=4&&!inCmp;
    return (
      <div style={{display:"flex",gap:4,justifyContent:"center",alignItems:"center",whiteSpace:"nowrap"}}>
        <button onClick={e=>{e.stopPropagation();toggleFavorite(row.code);}}
          title={isFav?"取消自选":"加入自选"}
          style={{background:"none",border:"none",cursor:"pointer",padding:"2px 3px",fontSize:15,lineHeight:1,color:isFav?C.orange:C.textDim,transition:"transform 0.2s,color 0.2s",transform:isFav?"scale(1.15)":"scale(1)"}}>
          {isFav?"★":"☆"}
        </button>
        <button onClick={e=>{e.stopPropagation();if(!cmpFull||inCmp)toggleCompare(row);}}
          title={inCmp?"取消对比":cmpFull?"最多4只":"加入对比"}
          style={{background:inCmp?accent+"15":"none",border:`1px solid ${inCmp?accent+"60":C.borderLight}`,borderRadius:5,cursor:cmpFull&&!inCmp?"not-allowed":"pointer",padding:"2px 6px",fontSize:11,lineHeight:1.5,color:inCmp?accent:C.textDim,fontWeight:inCmp?700:400,transition:"all 0.18s",opacity:cmpFull&&!inCmp?0.35:1}}>
          {inCmp?"−对比":"+对比"}
        </button>
      </div>
    );
  }});

  const renderDayChange = v => {
    if(v==null) return <span style={{color:C.textDim,fontSize:11}}>—</span>;
    const n=parseFloat(v);
    const color = n>0?C.green : n<0?C.red:C.textDim;
    return <span style={{color,fontWeight:700,fontSize:12}}>{n>0?"+":""}{n.toFixed(2)}%</span>;
  };
  const renderRolling1y = v => {
    if(v==null) return <span style={{color:C.textDim,fontSize:11}}>—</span>;
    const n=parseFloat(v);
    return <MiniBar value={n} max={Math.max(maxReturn,50)} color={n>0?C.green:C.red}/>;
  };

  const passiveCols=[
    actionsCol(C.accent),
    {key:"code",   label:"代码",    render:v=><span style={{fontFamily:"monospace",color:C.accent,fontWeight:700,fontSize:12}}>{v}</span>},
    {key:"name",   label:"基金名称", render:v=><span style={{fontSize:12,color:C.text}}>{v}</span>},
    {key:"code_c", label:"C类代码", sortable:false, tip:"同基金的C类份额：无申购费，有年化0.2%~0.4%销售服务费。持有≤1年选C类可省申购费，持有＞1年A类总费更低。",align:"center",
     render:v=>v?<span style={{fontFamily:"monospace",fontSize:11,color:C.cyan,background:C.cyan+"18",padding:"2px 7px",borderRadius:4,fontWeight:700,letterSpacing:"0.5px"}}>{v}</span>:<span style={{color:C.textDim,fontSize:11}}>—</span>},
    {key:"fee_rate",label:"运作费率",tip:"管理费+托管费（年化），不含申购赎回费，越低越好",align:"right",render:v=>v!=null?<span style={{color:v>1?C.orange:C.textMuted,fontWeight:v>1?600:400}}>{v}%</span>:"—"},
    {key:"scale",  label:"规模(亿)",tip:"基金总规模，规模大流动性好",align:"right",render:v=><span style={{fontWeight:600}}>{v||"—"}</span>},
    {key:"ytd_return",label:"25年涨幅",tip:"2025年全年涨幅（静态数据）",align:"right",render:v=>v!=null?<MiniBar value={v} max={maxReturn} color={v>0?C.green:C.red}/>:"—"},
    {key:"rolling_1y",label:"近1年滚动",tip:"最近365天滚动涨幅，实时数据，每5分钟更新",align:"right",render:(_,row)=>renderRolling1y(row.rolling_1y)},
    {key:"day_change",label:"昨日涨跌",tip:"绿色=上涨，红色=下跌",align:"right",render:(_,row)=>renderDayChange(row.day_change)},
    {key:"track_error",label:"跟踪误差",tip:"年化跟踪误差，越小越紧密",align:"right",render:v=>v!=null?<span style={{color:v>2?C.orange:C.textDim}}>{v}%</span>:"—"},
    {key:"daily_limit",label:"申购上限",tip:"每日单笔最大申购金额",align:"right",render:v=><span style={{fontSize:12,color:C.textMuted}}>{v}</span>},
    {key:"buy_status",label:"申购状态",tip:"当前是否开放申购",align:"center",sortable:false,render:v=><StatusBadge status={v}/>},
  ];
  const activeCols=[
    actionsCol(C.purple),
    {key:"code",   label:"代码",    render:v=><span style={{fontFamily:"monospace",color:C.purple,fontWeight:700,fontSize:12}}>{v}</span>},
    {key:"name",   label:"基金名称", render:v=><span style={{fontSize:12}}>{v}</span>},
    {key:"fee_rate",label:"运作费率",tip:"管理费+托管费（年化），主动型普遍偏高(~1.55%)",align:"right",render:v=>v!=null?`${v}%`:"—"},
    {key:"scale",  label:"规模(亿)",tip:"基金总规模",align:"right",render:v=><span style={{fontWeight:600}}>{v||"—"}</span>},
    {key:"ytd_return",label:"25年涨幅",tip:"2025年全年涨幅（静态数据）",align:"right",render:v=>v!=null?<MiniBar value={v} max={maxReturn} color={C.green}/>:"—"},
    {key:"rolling_1y",label:"近1年滚动",tip:"最近365天滚动涨幅，实时数据",align:"right",render:(_,row)=>renderRolling1y(row.rolling_1y)},
    {key:"day_change",label:"昨日涨跌",tip:"绿色=上涨，红色=下跌",align:"right",render:(_,row)=>renderDayChange(row.day_change)},
    {key:"daily_limit",label:"每日限额",tip:"每日单笔最大申购金额，额度越低说明越紧俏",align:"right",render:v=><span style={{fontSize:12,color:C.textMuted}}>{v}</span>},
    {key:"buy_status",label:"申购状态",tip:"当前是否开放申购",align:"center",sortable:false,render:v=><StatusBadge status={v}/>},
  ];
  const etfCols=[
    actionsCol(C.cyan),
    {key:"code",  label:"代码",  render:v=><span style={{fontFamily:"monospace",color:C.cyan,fontWeight:700,fontSize:12}}>{v}</span>},
    {key:"name",  label:"ETF名称"},
    {key:"tracking_index",label:"跟踪指数",render:v=><span style={{color:C.textMuted,fontSize:12}}>{v||"—"}</span>},
    {key:"scale", label:"规模(亿)",tip:"基金总规模，越大流动性越好",align:"right",render:v=><span style={{fontWeight:600}}>{v||"—"}</span>},
    {key:"ytd_return",label:"25年涨幅",tip:"2025年全年涨幅（静态数据）",align:"right",render:v=>v!=null?<MiniBar value={v} max={30} color={C.green}/>:"—"},
    {key:"rolling_1y",label:"近1年滚动",tip:"最近365天滚动涨幅，实时数据",align:"right",render:(_,row)=>renderRolling1y(row.rolling_1y)},
    {key:"day_change",label:"昨日涨跌",tip:"绿色=上涨，红色=下跌",align:"right",render:(_,row)=>renderDayChange(row.day_change)},
    {key:"fee_rate",label:"运作费率",tip:"管理费+托管费（年化），场内ETF区间0.65%~1.00%",align:"right",render:v=>v!=null?<span style={{color:v>=1.0?C.orange:C.textMuted,fontWeight:v>=1.0?600:400}}>{v}%</span>:"—"},
    {key:"track_error",label:"跟踪误差",tip:"年化跟踪误差，越小说明与指数越贴近",align:"right",render:v=>v!=null?<span style={{color:v>1.5?C.orange:C.textDim,fontWeight:v>1.5?600:400}}>{v}%</span>:"—"},
    {key:"premium",label:"溢价率",tip:"场内价格相对净值的溢价。>1%注意；>2%偏高；>3%极高",align:"center",sortable:false,render:v=>v!=null?<PremiumBadge value={v}/>:"—"},
    {key:"volume",label:"日均成交(亿)",tip:"日均成交额（亿元），越大流动性越好",align:"right"},
  ];

  // 移动端隐藏次要列，保留核心信息
  const _mobileHide = new Set(["code_c","fee_rate","ytd_return","track_error"]);
  const passiveColsF = isMobile ? passiveCols.filter(c=>!_mobileHide.has(c.key)) : passiveCols;
  const activeColsF  = isMobile ? activeCols.filter(c=>c.key!=="fee_rate") : activeCols;
  const etfColsF     = isMobile ? etfCols.filter(c=>!["fee_rate","track_error"].includes(c.key)) : etfCols;

  const dismissDisclaimer = ()=>{
    localStorage.setItem("etf-disclaimer","1");
    setShowDisclaimer(false);
    if(localStorage.getItem("briefing_date")!==new Date().toDateString()) setShowBriefing(true);
  };

  return (
    <>
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif",overflowX:"hidden"}}>
      {showDisclaimer&&<DisclaimerModal onClose={dismissDisclaimer}/>}
      {/* 导出预览弹窗 */}
      {exportPreview&&(
        <div onClick={()=>setExportPreview(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)",padding:24}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#1c1c1e",borderRadius:20,padding:20,display:"flex",flexDirection:"column",alignItems:"center",gap:16,maxHeight:"90vh"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}>
              <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>预览</span>
              <button onClick={()=>setExportPreview(null)}
                style={{width:28,height:28,borderRadius:"50%",border:"none",background:"#3a3a3c",color:"#fff",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <img src={exportPreview.url} alt="导出预览"
              style={{maxHeight:"calc(90vh - 140px)",maxWidth:"100%",borderRadius:12,objectFit:"contain"}}/>
            <a href={exportPreview.url} download={exportPreview.filename}
              style={{display:"flex",alignItems:"center",gap:8,padding:"11px 32px",borderRadius:12,background:"linear-gradient(135deg,#007aff,#5856d6)",color:"#fff",fontSize:14,fontWeight:700,textDecoration:"none",letterSpacing:0.2}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              下载图片
            </a>
          </div>
        </div>
      )}
      {/* 微信公众号二维码弹窗 */}
      {showWechat&&(
        <div onClick={()=>setShowWechat(false)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:C.card,borderRadius:16,padding:"28px 32px",boxShadow:"0 20px 60px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column",alignItems:"center",gap:16,minWidth:240}}>
            <div style={{fontSize:15,fontWeight:700,color:C.text}}>微信公众号</div>
            <div style={{borderRadius:16,overflow:"hidden",border:`1px solid ${C.border}`,flexShrink:0}}>
              <img src="/公众号.png" alt="微信公众号二维码"
                style={{width:420,height:"auto",display:"block"}}
                onError={e=>{e.currentTarget.parentElement.style.display="none";}}/>
            </div>
            <div style={{fontSize:12,color:C.textDim}}>扫码关注，获取最新资讯</div>
            <button onClick={()=>setShowWechat(false)}
              style={{padding:"6px 20px",borderRadius:8,border:`1px solid ${C.border}`,background:"none",color:C.textMuted,fontSize:13,cursor:"pointer"}}>
              关闭
            </button>
          </div>
        </div>
      )}
      {showBriefing&&!showDisclaimer&&(
        <GroupChatModal onClose={()=>setShowBriefing(false)}/>
      )}
      {/* 导出图片按钮（仅 overview 时显示） */}
      {activeTab==="overview"&&!isMobile&&(
        <button onClick={handleExport}
          title="导出今日快照"
          style={{position:"fixed",right:24,bottom:compareList.length>0?88:36,zIndex:90,display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#007aff,#5856d6)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 16px rgba(0,122,255,0.35)",transition:"transform 0.15s,box-shadow 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,122,255,0.45)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 16px rgba(0,122,255,0.35)";}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出图片
        </button>
      )}
      {activeTab==="nasdaq"&&!isMobile&&(
        <button onClick={handleExportNasdaqTable}
          title="导出纳指表格"
          style={{position:"fixed",right:24,bottom:compareList.length>0?88:36,zIndex:90,display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#007aff,#5856d6)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 16px rgba(0,122,255,0.35)",transition:"transform 0.15s,box-shadow 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,122,255,0.45)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 16px rgba(0,122,255,0.35)";}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出纳指表格
        </button>
      )}
      {(activeTab==="sp500"||activeTab==="etf")&&!isMobile&&(
        <button onClick={handleExportSP500ETFTable}
          title="导出标普+ETF"
          style={{position:"fixed",right:24,bottom:compareList.length>0?88:36,zIndex:90,display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#14c8b4,#007aff)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 16px rgba(20,200,180,0.35)",transition:"transform 0.15s,box-shadow 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(20,200,180,0.45)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 16px rgba(20,200,180,0.35)";}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出标普+ETF
        </button>
      )}
      {activeTab==="active"&&!isMobile&&(
        <button onClick={handleExportActiveTable}
          title="导出主动型基金表格"
          style={{position:"fixed",right:24,bottom:compareList.length>0?88:36,zIndex:90,display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#a04cf5,#5856d6)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 16px rgba(160,76,245,0.35)",transition:"transform 0.15s,box-shadow 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(160,76,245,0.45)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 16px rgba(160,76,245,0.35)";}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出主动型表格
        </button>
      )}

      {/* ── Header ── */}
      <header style={{
        background:"rgba(255,255,255,0.88)",
        backdropFilter:"saturate(180%) blur(24px)",
        WebkitBackdropFilter:"saturate(180%) blur(24px)",
        borderBottom:`1px solid ${scrolled?C.border:"transparent"}`,
        boxShadow:scrolled?"0 1px 24px rgba(0,0,0,0.08)":"none",
        position:"sticky",top:0,zIndex:100,
        transition:"box-shadow 0.35s ease, border-color 0.35s ease",
      }}>
        <div style={{maxWidth:1440,margin:"0 auto",padding:isMobile?"0 16px":"0 40px",height:60,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <a href="/" onClick={e=>{e.preventDefault();switchTab("overview");}} style={{textDecoration:"none",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="url(#logobg)"/>
              <polyline points="4,20 9,13 14,16 19,8 24,11" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="24" cy="11" r="2" fill="white"/>
              <defs><linearGradient id="logobg" x1="0" y1="0" x2="28" y2="28"><stop stopColor="#007aff"/><stop offset="1" stopColor="#5856d6"/></linearGradient></defs>
            </svg>
            <span style={{fontSize:17,fontWeight:800,letterSpacing:-0.5,color:C.text}}>Wise <span style={{color:C.accent}}>ETF</span></span>
          </a>

          {/* Sliding tab nav */}
          <nav ref={navRef} style={{display:"flex",alignItems:"center",height:"100%",position:"relative"}}>
            {/* Sliding indicator */}
            <div style={{position:"absolute",bottom:0,left:indicator.left,width:indicator.width,height:2,background:`linear-gradient(90deg,${C.accent},${C.accent}80)`,borderRadius:"2px 2px 0 0",transition:"left 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1)",opacity:indicator.opacity}}/>
            {TABS.map(tab=>(
              <button key={tab.id} data-tab={tab.id} onClick={()=>switchTab(tab.id)}
                style={{height:"100%",padding:"0 20px",border:"none",background:"none",color:activeTab===tab.id?C.accent:C.textMuted,fontWeight:activeTab===tab.id?700:500,fontSize:14,cursor:"pointer",borderBottom:"2px solid transparent",transition:"color 0.2s",whiteSpace:"nowrap"}}>
                {tab.label}
              </button>
            ))}
          </nav>

          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:12}}>
            {!isMobile&&usdcny&&(
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:8,background:C.accentBg,border:`1px solid ${C.accent}22`}}>
                <span style={{fontSize:10,color:C.textDim,letterSpacing:0.3}}>USD/CNY</span>
                <span style={{fontSize:13,fontWeight:700,color:C.accent,fontFamily:"monospace",letterSpacing:0.5}}>{usdcny}</span>
              </div>
            )}
            {!isMobile&&<button onClick={()=>setShowBriefing(true)}
              title="加入群聊"
              style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.borderLight}`,background:"none",color:C.textMuted,fontSize:12,fontWeight:500,cursor:"pointer",transition:"all 0.18s",whiteSpace:"nowrap"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#07c16014";e.currentTarget.style.color="#07c160";e.currentTarget.style.borderColor="#07c16044";}}
              onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=C.textMuted;e.currentTarget.style.borderColor=C.borderLight;}}>
              <span style={{fontSize:13}}>💬</span> 加入群聊
            </button>}
            {/* Twitter / X */}
            {!isMobile&&<a href="https://x.com/WiseInvest513" target="_blank" rel="noopener noreferrer"
              title="关注博主 Twitter"
              style={{display:"flex",alignItems:"center",justifyContent:"center",width:30,height:30,borderRadius:8,border:`1px solid ${C.borderLight}`,background:"none",color:C.textMuted,textDecoration:"none",transition:"all 0.18s",flexShrink:0}}
              onMouseEnter={e=>{e.currentTarget.style.background="#000";e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor="#000";}}
              onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=C.textMuted;e.currentTarget.style.borderColor=C.borderLight;}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>}
            {/* WeChat 公众号 */}
            {!isMobile&&<button onClick={()=>setShowWechat(true)}
              title="微信公众号"
              style={{display:"flex",alignItems:"center",justifyContent:"center",width:30,height:30,borderRadius:8,border:`1px solid ${C.borderLight}`,background:"none",color:C.textMuted,cursor:"pointer",transition:"all 0.18s",flexShrink:0}}
              onMouseEnter={e=>{e.currentTarget.style.background="#07c160";e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor="#07c160";}}
              onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=C.textMuted;e.currentTarget.style.borderColor=C.borderLight;}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-7.062-6.122zm-3.74 2.632c.535 0 .969.44.969.983a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.543.434-.983.97-.983zm5.08 0c.535 0 .969.44.969.983a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.543.434-.983.97-.983z"/>
              </svg>
            </button>}
            {!isMobile&&lastUpdate&&<span style={{fontSize:11,color:C.textDim,whiteSpace:"nowrap"}}>更新于 {lastUpdate}</span>}
            {/* Hamburger (mobile only) */}
            <button onClick={()=>setMobileMenuOpen(o=>!o)} className="hamburger-btn"
              aria-label="菜单"
              style={{display:"none",flexDirection:"column",gap:5,background:"none",border:"none",cursor:"pointer",padding:6}}>
              <span style={{display:"block",width:22,height:2,background:mobileMenuOpen?C.accent:C.textMuted,borderRadius:2,transition:"all 0.25s",transform:mobileMenuOpen?"rotate(45deg) translateY(7px)":"none"}}/>
              <span style={{display:"block",width:22,height:2,background:mobileMenuOpen?C.accent:C.textMuted,borderRadius:2,transition:"all 0.25s",opacity:mobileMenuOpen?0:1}}/>
              <span style={{display:"block",width:22,height:2,background:mobileMenuOpen?C.accent:C.textMuted,borderRadius:2,transition:"all 0.25s",transform:mobileMenuOpen?"rotate(-45deg) translateY(-7px)":"none"}}/>
            </button>
          </div>
        </div>
        {/* Mobile dropdown menu */}
        {mobileMenuOpen&&(
          <div className="mobile-menu" style={{borderTop:`1px solid ${C.border}`,background:"rgba(255,255,255,0.97)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)"}}>
            {TABS.map(tab=>(
              <button key={tab.id} onClick={()=>{switchTab(tab.id);setMobileMenuOpen(false);}}
                style={{display:"block",width:"100%",padding:"14px 24px",textAlign:"left",background:"none",border:"none",borderBottom:`1px solid ${C.border}30`,color:activeTab===tab.id?C.accent:C.text,fontWeight:activeTab===tab.id?700:400,fontSize:15,cursor:"pointer"}}>
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ── Content ── */}
      <main style={{maxWidth:1440,margin:"0 auto",padding:isMobile?"16px 12px 80px":"36px 40px 100px"}}>
        <div key={activeTab} className="tab-content">

        {/* ════ WATCHLIST ════ */}
        {activeTab==="watchlist"&&(
          <>
            <SectionHeader title="我的自选" subtitle={favorites.length>0?`共 ${favorites.length} 只基金`:"还没有自选"} color={C.orange}/>
            {favorites.length===0 ? (
              <WatchlistEmpty onGo={()=>switchTab("nasdaq")}/>
            ) : (
              <>
                {nasdaq.filter(f=>favorites.includes(f.code)).length>0&&(
                  <Reveal delay={0}><div style={{marginBottom:28}}>
                    <SectionHeader title="纳指被动" color={C.accent}/>
                    <DataTable columns={passiveColsF} data={nasdaqM.filter(f=>favorites.includes(f.code))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>
                  </div></Reveal>
                )}
                {sp500M.filter(f=>favorites.includes(f.code)).length>0&&(
                  <Reveal delay={0.05}><div style={{marginBottom:28}}>
                    <SectionHeader title="标普500被动" color={C.cyan}/>
                    <DataTable columns={passiveColsF} data={sp500M.filter(f=>favorites.includes(f.code))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>
                  </div></Reveal>
                )}
                {activeM.filter(f=>favorites.includes(f.code)).length>0&&(
                  <Reveal delay={0.1}><div style={{marginBottom:28}}>
                    <SectionHeader title="美股主动" color={C.purple}/>
                    <DataTable columns={activeColsF} data={activeM.filter(f=>favorites.includes(f.code))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>
                  </div></Reveal>
                )}
                {etfsM.filter(f=>favorites.includes(f.code)).length>0&&(
                  <Reveal delay={0.15}><div style={{marginBottom:28}}>
                    <SectionHeader title="场内ETF" color={C.orange}/>
                    <DataTable columns={etfColsF} data={etfsM.filter(f=>favorites.includes(f.code))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>
                  </div></Reveal>
                )}
              </>
            )}
          </>
        )}

        {/* ════ OVERVIEW ════ */}
        {activeTab==="overview"&&(
          <>
            {/* Stat row */}
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(5,1fr)",gap:isMobile?10:16,marginBottom:isMobile?20:36}}>
              {[
                {label:"纳指均涨幅",value:`+${avg(nasdaq,"ytd_return")}%`,sub:"近一年",color:C.accent},
                {label:"标普均涨幅",value:`+${avg(sp500,"ytd_return")}%`,sub:"近一年",color:C.cyan},
                {label:"主动均涨幅",value:`+${avg(active,"ytd_return")}%`,sub:"近一年",color:C.purple},
                {label:"ETF均溢价",value:`${avg(etfs,"premium")}%`,sub:"当前",color:C.orange},
                {label:"监控总数",value:String(totalFunds),sub:`${openFunds}只可申购`,color:C.green},
              ].map((s,i)=><StatCard key={s.label} {...s} index={i}/>)}
            </div>

            {/* ── 市场情绪指标 ── */}
            <MarketSentimentRow sentiment={sentiment} isMobile={isMobile}/>

            {/* Charts */}
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?12:20,marginBottom:isMobile?16:28}}>
              <Reveal delay={0.05}>
                <Card style={{padding:"24px 26px"}}>
                  <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>纳指 vs 标普 · 月度收益</div>
                  <div style={{fontSize:12,color:C.textDim,marginBottom:20}}>2025年4月 — 2026年3月（美元口径）</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={MONTHLY_12M} barGap={3} barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="2 4" stroke={C.borderLight} vertical={false}/>
                      <XAxis dataKey="month" tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false} unit="%"/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <ReferenceLine y={0} stroke={C.border}/>
                      <Legend wrapperStyle={{fontSize:11,paddingTop:12}}/>
                      <Bar dataKey="nasdaq" name="纳斯达克100" fill={C.accent} radius={[4,4,0,0]}/>
                      <Bar dataKey="sp500"  name="标普500"    fill={C.cyan}   radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Reveal>

              <Reveal delay={0.1}>
                <Card style={{padding:"24px 26px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:C.text}}>场内ETF溢价走势</div>
                      <div style={{fontSize:12,color:C.textDim,marginTop:2}}>近30交易日 · 真实市价/净值计算</div>
                    </div>
                    <select value={selETF} onChange={e=>setSelETF(e.target.value)}
                      style={{background:C.bg,border:`1px solid ${C.border}`,color:C.text,borderRadius:8,padding:"5px 10px",fontSize:12,outline:"none",cursor:"pointer"}}>
                      {etfs.map(e=><option key={e.code} value={e.code}>{e.code} {e.name}</option>)}
                    </select>
                  </div>
                  {premHistLoading?(
                    <div style={{height:220,display:"flex",alignItems:"center",justifyContent:"center",color:C.textDim,fontSize:13}}>
                      正在加载真实溢价率数据…
                    </div>
                  ):premHist.length===0?(
                    <div style={{height:220,display:"flex",alignItems:"center",justifyContent:"center",color:C.textDim,fontSize:13}}>
                      暂无历史数据
                    </div>
                  ):(
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={premHist} margin={{top:16,right:0,left:0,bottom:0}}>
                      <defs>
                        <linearGradient id="premGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={C.orange} stopOpacity={0.18}/>
                          <stop offset="95%" stopColor={C.orange} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.borderLight} vertical={false}/>
                      <XAxis dataKey="date" tick={{fill:C.textDim,fontSize:10}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false} unit="%"/>
                      <ReferenceLine y={1.5} stroke={C.orange} strokeDasharray="3 3" label={{value:"警戒线",fill:C.orange,fontSize:10,position:"right"}}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Area type="monotone" dataKey="premium" name="溢价率" stroke={C.orange} fill="url(#premGrad)" strokeWidth={2} dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                  )}
                </Card>
              </Reveal>
            </div>

            {/* Index History */}
            <IndexHistoryCard/>

            {/* FX Analysis */}
            <FXAnalysisCard/>

            {/* Top 5 */}            <Reveal delay={0.08}>
              <SectionHeader title="近一年涨幅 TOP 5 · 主动型" color={C.purple}/>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(5,1fr)",gap:isMobile?10:16,marginBottom:36}}>
                {topPerf.map((f,i)=>(
                  <Card key={f.code} style={{padding:isMobile?"14px 16px":"20px 22px",position:"relative",overflow:"hidden"}}>
                    <div style={{position:"absolute",top:-10,right:-10,fontSize:80,fontWeight:900,color:C.accent+(i===0?"10":"07"),lineHeight:1,userSelect:"none"}}>
                      {i+1}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                      {i===0&&<span style={{fontSize:10,background:C.accent+"18",color:C.accent,padding:"1px 7px",borderRadius:10,fontWeight:700}}>TOP</span>}
                      <span style={{fontSize:11,color:C.textDim,fontFamily:"monospace"}}>{f.code}</span>
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14,lineHeight:1.4,paddingRight:40,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                    <div style={{fontSize:28,fontWeight:800,color:C.green,letterSpacing:-0.5,marginBottom:6}}>+{f.ytd_return}%</div>
                    <div style={{height:3,borderRadius:2,background:C.borderLight,overflow:"hidden",marginBottom:8}}>
                      <div style={{height:"100%",width:`${Math.min(f.ytd_return/120*100,100)}%`,background:`linear-gradient(90deg,${C.green},${C.green}80)`,borderRadius:2}}/>
                    </div>
                    <div style={{fontSize:11,color:C.textDim}}>规模 {f.scale}亿 · 限额 {f.daily_limit}</div>
                  </Card>
                ))}
              </div>
            </Reveal>

            {/* ETF warning */}
            <Reveal delay={0.1}>
              <SectionHeader title="场内ETF溢价预警" subtitle="溢价 >1% 注意 · >2% 偏高 · >3% 极高建议等待收窄" color={C.orange}/>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:isMobile?10:16}}>
                {etfs.map(e=>{
                  const prem = e.premium||0;
                  const barColor = prem>3?C.red:prem>2?"#ff6b35":prem>1?C.orange:C.green;
                  return (
                  <Card key={e.code} style={{padding:isMobile?"14px 16px":"18px 22px",borderColor:prem>3?`${C.red}40`:prem>2?`#ff6b3530`:C.border}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:11,color:C.textDim,fontFamily:"monospace",marginBottom:4}}>{e.code}</div>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{e.name}</div>
                        <div style={{fontSize:11,color:C.textDim,marginTop:2}}>{e.tracking_index}</div>
                      </div>
                      <PremiumBadge value={prem}/>
                    </div>
                    {/* Premium meter — 刻度0/1/2/3/4% */}
                    <div style={{marginBottom:12}}>
                      <div style={{position:"relative",height:6,borderRadius:3,background:C.borderLight,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(prem/4*100,100)}%`,background:`linear-gradient(90deg,${C.green},${barColor})`,borderRadius:3,transition:"width 0.6s ease"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                        {["0%","1%","2%","3%","4%+"].map(t=><span key={t} style={{fontSize:9,color:C.textDim}}>{t}</span>)}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                      <div><div style={{fontSize:10,color:C.textDim,marginBottom:1}}>近1年</div><div style={{fontSize:13,fontWeight:700,color:C.green}}>+{e.ytd_return}%</div></div>
                      <div><div style={{fontSize:10,color:C.textDim,marginBottom:1}}>规模</div><div style={{fontSize:13,fontWeight:600}}>{e.scale}亿</div></div>
                      <div><div style={{fontSize:10,color:C.textDim,marginBottom:1}}>成交</div><div style={{fontSize:13,fontWeight:600}}>{e.volume}亿</div></div>
                      {e.fee_rate!=null&&<div><div style={{fontSize:10,color:C.textDim,marginBottom:1}}>费率</div><div style={{fontSize:13,fontWeight:600,color:C.textMuted}}>{e.fee_rate}%</div></div>}
                      {e.track_error!=null&&<div><div style={{fontSize:10,color:C.textDim,marginBottom:1}}>跟踪误差</div><div style={{fontSize:13,fontWeight:600,color:e.track_error>1?C.orange:C.textMuted}}>{e.track_error}%</div></div>}
                    </div>
                  </Card>
                  );
                })}
              </div>
            </Reveal>
          </>
        )}

        {/* ════ NASDAQ ════ */}
        {activeTab==="nasdaq"&&(
          <Reveal>
            <SectionHeader title="场外纳斯达克100（被动型）" subtitle="数据来源：天天基金网" count={filterData(nasdaqM).length} color={C.accent} timestamp={liveTs}/>
            <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:4}}>
              <div style={{flex:1,minWidth:200}}><SearchBar value={search} onChange={setSearch} color={C.accent}/></div>
              <StatusFilterBar value={statusFilter} onChange={setStatusFilter} color={C.accent}/>
            </div>
            {dataLoading?<SkeletonTable rows={8} cols={9}/>:<><DataTable columns={passiveColsF} data={sortData(filterData(nasdaqM))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>{filterData(nasdaqM).length===0&&<EmptyResult query={search}/>}</>}
            <TipBox color={C.accent} text="综合费率最低的有天弘(018043, 0.70%)和嘉实(016532, 0.70%)，但目前均暂停申购。可申购中费率较低的是摩根(019172, 0.72%)和易方达(161130, 0.72%)。广发(270042)规模最大(108亿)，跟踪误差最小(1.10%)。"/>
            <AcInfoBox/>
          </Reveal>
        )}

        {/* ════ SP500 ════ */}
        {activeTab==="sp500"&&(
          <Reveal>
            <SectionHeader title="场外标普500基金对比" subtitle="数据来源：天天基金网" count={filterData(sp500M).length} color={C.cyan} timestamp={liveTs}/>
            <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:4}}>
              <div style={{flex:1,minWidth:200}}><SearchBar value={search} onChange={setSearch} color={C.cyan}/></div>
              <StatusFilterBar value={statusFilter} onChange={setStatusFilter} color={C.cyan}/>
            </div>
            {dataLoading?<SkeletonTable rows={8} cols={9}/>:<><DataTable columns={passiveColsF} data={sortData(filterData(sp500M))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>{filterData(sp500M).length===0&&<EmptyResult query={search}/>}</>}
            <TipBox color={C.cyan} text="博时(050025)规模最大(67.56亿)、跟踪误差最小(1.31%)，但暂停申购。可申购推荐摩根(017641, 0.77%)和易方达(161125)。注意161128跟踪标普信息科技指数，波动更大。"/>
            <AcInfoBox/>
          </Reveal>
        )}

        {/* ════ ACTIVE ════ */}
        {activeTab==="active"&&(
          <Reveal>
            <SectionHeader title="场外美股（主动型）基金对比" subtitle="数据来源：天天基金网" count={filterData(activeM).length} color={C.purple} timestamp={liveTs}/>
            <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:4}}>
              <div style={{flex:1,minWidth:200}}><SearchBar value={search} onChange={setSearch} color={C.purple}/></div>
              <StatusFilterBar value={statusFilter} onChange={setStatusFilter} color={C.purple}/>
            </div>
            {dataLoading?<SkeletonTable rows={8} cols={8}/>:<><DataTable columns={activeColsF} data={sortData(filterData(activeM))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>{filterData(activeM).length===0&&<EmptyResult query={search}/>}</>}
            <TipBox color={C.purple} text="主动型管理费较高(~1.55%)，但优秀经理可带来超额收益。易方达全球成长(012920)近一年+100.44%，但限额仅50元/日。申购限额越低说明额度越紧张。"/>
          </Reveal>
        )}

        {/* ════ ETF ════ */}
        {activeTab==="etf"&&(
          <Reveal>
            <SectionHeader title="场内ETF（纳指 / 标普）" subtitle="可在A股账户直接交易，关注溢价风险" count={filterData(etfsM).length} color={C.orange} timestamp={liveTs}/>
            <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:4}}>
              <div style={{flex:1,minWidth:200}}><SearchBar value={search} onChange={setSearch} color={C.orange}/></div>
            </div>
            {dataLoading?<SkeletonTable rows={8} cols={8}/>:<><DataTable columns={etfColsF} data={sortData(filterData(etfsM))} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>{filterData(etfsM).length===0&&<EmptyResult query={search}/>}</>}
            <Card style={{marginTop:24,padding:"24px 26px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>溢价率历史走势（近30交易日）</div>
                  <div style={{fontSize:12,color:C.textDim,marginTop:2}}>真实市价/净值计算 · 来源：新浪财经 + 东方财富</div>
                </div>
                <select value={selETF} onChange={e=>setSelETF(e.target.value)}
                  style={{background:C.bg,border:`1px solid ${C.border}`,color:C.text,borderRadius:8,padding:"5px 12px",fontSize:12,outline:"none"}}>
                  {etfs.map(e=><option key={e.code} value={e.code}>{e.code} {e.name}</option>)}
                </select>
              </div>
              {premHistLoading?(
                <div style={{height:280,display:"flex",alignItems:"center",justifyContent:"center",color:C.textDim,fontSize:13}}>
                  正在加载真实溢价率数据…
                </div>
              ):premHist.length===0?(
                <div style={{height:280,display:"flex",alignItems:"center",justifyContent:"center",color:C.textDim,fontSize:13}}>
                  暂无历史数据
                </div>
              ):(
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={premHist} margin={{top:20,right:0,left:0,bottom:0}}>
                  <defs>
                    <linearGradient id="premGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.orange} stopOpacity={0.2}/>
                      <stop offset="95%" stopColor={C.orange} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke={C.borderLight} vertical={false}/>
                  <XAxis dataKey="date" tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false} unit="%" domain={["auto","auto"]}/>
                  <ReferenceLine y={1.5} stroke={C.orange} strokeDasharray="3 3" label={{value:"1.5%",fill:C.orange,fontSize:10,position:"right"}}/>
                  <ReferenceLine y={3} stroke={C.red} strokeDasharray="3 3" label={{value:"3%",fill:C.red,fontSize:10,position:"right"}}/>
                  <Tooltip content={<ChartTooltip/>}/>
                  <Area type="monotone" dataKey="premium" name="溢价率" stroke={C.orange} fill="url(#premGrad2)" strokeWidth={2} dot={{r:2,fill:C.orange,strokeWidth:0}}/>
                </AreaChart>
              </ResponsiveContainer>
              )}
            </Card>
            <TipBox color={C.orange} text="溢价 < 1%：正常，可正常买入。溢价 1~2%：注意，考虑申购场外联接替代。溢价 2~3%：偏高，建议等待收窄。溢价 > 3%：极高，强烈建议避开或改买场外联接基金。"/>
          </Reveal>
        )}

        </div>
      </main>

      {/* ── Compare Bar & Modal ── */}
      <CompareBar
        list={compareList}
        onOpen={()=>setShowCompare(true)}
        onRemove={code=>setCompareList(p=>p.filter(f=>f.code!==code))}
        onClear={()=>setCompareList([])}
      />
      {showCompare&&compareList.length>=2&&(
        <CompareModal list={compareList} onClose={()=>setShowCompare(false)}/>
      )}

      {/* ── Footer ── */}
      <footer style={{background:"#fff",borderTop:`1px solid ${C.border}`}}>
        <div style={{maxWidth:1440,margin:"0 auto",padding:isMobile?"32px 16px 24px":"56px 40px 48px",display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr auto auto",gap:isMobile?"32px":"60px 80px"}}>
          <div style={{maxWidth:340}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${C.accent},#5856d6)`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:14,color:"#fff"}}>W</div>
              <span style={{fontSize:19,fontWeight:800,letterSpacing:-0.5,color:C.text}}>Wise<span style={{color:C.accent}}>ETF</span></span>
            </div>
            <p style={{fontSize:14,color:C.textMuted,lineHeight:1.85,marginBottom:10}}>
              中国投资者的美股ETF与QDII基金追踪平台，覆盖纳斯达克100、标普500被动指数及主动型QDII基金，提供费率对比、溢价监控与申购状态追踪。
            </p>
            <p style={{fontSize:12,color:C.textDim}}>wise-etf.com</p>
          </div>

          <div style={{minWidth:120}}>
            <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:20}}>快速导航</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {TABS.slice(1).filter(tab=>tab.id!=="watchlist").map(tab=>(
                <button key={tab.id} onClick={()=>{switchTab(tab.id);}}
                  className="footer-link"
                  style={{background:"none",border:"none",padding:0,fontSize:14,color:C.textMuted,cursor:"pointer",textAlign:"left",transition:"color 0.15s,transform 0.15s",lineHeight:"20px",height:20}}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{minWidth:160}}>
            <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:20}}>其他</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {[
                {label:"投资主站",   href:"https://www.wise-invest.org",  icon:"🌐"},
                {label:"Wise-Witness",href:"https://www.wise-witness.com",icon:"🏦"},
                {label:"Wise-Hold",  href:"https://www.wise-hold.com",    icon:"📈"},
                {label:"Wise-SIM",   href:"https://www.wise-sim.org",     icon:"📱"},
              ].map(l=>(
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
                  className="footer-link"
                  style={{fontSize:14,color:C.textMuted,textDecoration:"none",display:"flex",alignItems:"center",gap:8,transition:"color 0.15s,transform 0.15s",lineHeight:"20px",height:20}}>
                  <span style={{fontSize:14,lineHeight:"20px"}}>{l.icon}</span>{l.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div style={{borderTop:`1px solid ${C.border}`}}/>
        <div style={{maxWidth:1440,margin:"0 auto",padding:isMobile?"14px 16px":"18px 40px",display:"flex",justifyContent:"center",flexDirection:"column",alignItems:"center",gap:5}}>
          <div style={{fontSize:12,color:C.textDim}}>© 2026 wise-etf.com · All rights reserved</div>
          <div style={{fontSize:12,color:C.textDim}}>仅提供信息参考，不构成任何投资建议</div>
        </div>
      </footer>

      <style>{`
        *{box-sizing:border-box}

        /* Tab content */
        @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .tab-content{animation:fadeInUp 0.4s cubic-bezier(0.25,0.46,0.45,0.94) both}

        /* StatCard stagger */
        @keyframes cardIn{from{opacity:0;transform:translateY(16px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
        .stat-card{animation:cardIn 0.45s cubic-bezier(0.25,0.46,0.45,0.94) both}

        /* Status pulse */
        @keyframes statusPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(1.4)}}

        /* Premium alert */
        @keyframes premiumAlert{0%,100%{opacity:1}60%{opacity:0.6}}

        /* Table */
        .table-row{transition:background 0.15s,border-left 0.15s}

        /* Footer links */
        .footer-link:hover{color:${C.text} !important;transform:translateX(3px)}

        /* Nav hover */
        header nav button:hover{color:${C.text} !important}

        /* Skeleton */
        @keyframes skeletonPulse{0%,100%{opacity:1}50%{opacity:0.45}}

        /* Compare bar slide up */
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}

        /* Crash reason panel */
        @keyframes fadeSlideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}

        /* Scrollbar */
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:${C.textDim}}

        @media(max-width:900px){
          header nav{flex:1;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
          header nav::-webkit-scrollbar{display:none}
          header nav button{padding:0 14px;font-size:13px}
          .hamburger-btn{display:none !important}
          .mobile-menu{display:block}
        }

        @media(max-width:768px){
          html,body{overflow-x:hidden;max-width:100vw}
          /* 表格单元格紧凑 */
          .table-row td{padding:9px 10px !important;font-size:12px !important;white-space:nowrap}
          table thead th{padding:9px 10px !important;font-size:10px !important}
          /* StatCard 字号缩小 */
          .stat-card{padding:16px 14px !important;border-radius:14px !important}
          /* 卡片圆角收小 */
          .lift-card{border-radius:14px !important}
          /* 搜索框与筛选条换行 */
          .search-filter-row{flex-direction:column}
        }
      `}</style>
    </div>
    <Analytics />
    </>
  );
}
