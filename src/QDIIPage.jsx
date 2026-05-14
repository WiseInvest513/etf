import { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth <= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
}

// 判断当前市场时段（与后端 _current_session() 保持一致）
function getMarketSession() {
  const now  = new Date();
  const day  = now.getUTCDay();   // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return "closed";
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (h >= 1.5  && h < 7.0)  return "cn";   // 北京 09:30-15:00
  if (h >= 13.5 && h < 21.0) return "us";   // 美东 09:30-17:00
  return "closed";
}

const SESSION_INFO = {
  cn:     { label:"A股时段",   desc:"fundgz 实时全仓估值，15分钟刷新", color:"#059669", bg:"rgba(5,150,105,0.15)" },
  us:     { label:"美股时段",   desc:"Yahoo 实时股价加权，15分钟刷新",  color:"#2563eb", bg:"rgba(37,99,235,0.15)" },
  closed: { label:"盘后数据",   desc:"数据已固定，次日开盘前不变",       color:"#6b7280", bg:"rgba(107,114,128,0.12)" },
};

// ─── 颜色 ─────────────────────────────────────────────────────────────────────
const C = {
  accent:      "#0071e3",
  red:         "#d93025",
  green:       "#1a9e5a",
  text:        "#1d1d1f",
  textMuted:   "#6e6e73",
  textDim:     "#aeaeb2",
  bg:          "#f5f5f7",
  card:        "#ffffff",
  border:      "#e0e0e5",
  borderLight: "#f0f0f5",
};

// ─── 基金数据 ─────────────────────────────────────────────────────────────────
const QDII_FUNDS = [
  { code:"017436", name:"华宝纳斯达克精选股票(QDII)A",         fee_rate:1.40, scale:46.2,  ytd_return:26.08,  daily_limit:"3000元",   buy_status:"open" },
  { code:"006555", name:"浦银安盛全球智能科技股票(QDII)A",      fee_rate:1.40, scale:8.7,   ytd_return:43.81,  daily_limit:"500元",    buy_status:"open" },
  { code:"270023", name:"广发全球精选股票(QDII)A",              fee_rate:1.40, scale:104.5, ytd_return:32.39,  daily_limit:"5000元",   buy_status:"open" },
  { code:"017730", name:"嘉实全球产业升级股票(QDII)A",          fee_rate:1.40, scale:7.2,   ytd_return:75.36,  daily_limit:"100元",    buy_status:"open" },
  { code:"000043", name:"嘉实美国成长股票(QDII)",               fee_rate:1.40, scale:50.1,  ytd_return:20.01,  daily_limit:"100元",    buy_status:"open" },
  { code:"012920", name:"易方达全球成长精选混合(QDII)A",         fee_rate:1.40, scale:28.3,  ytd_return:107.95, daily_limit:"50元",     buy_status:"open" },
  { code:"539002", name:"建信新兴市场优选混合(QDII)A",           fee_rate:1.40, scale:4.6,   ytd_return:92.11,  daily_limit:"50元",     buy_status:"open" },
  { code:"006373", name:"国富全球科技互联混合(QDII)人民币A",     fee_rate:1.40, scale:24.3,  ytd_return:53.48,  daily_limit:"100元",    buy_status:"open" },
  { code:"001668", name:"汇添富全球移动互联混合(QDII)A",         fee_rate:1.40, scale:8.2,   ytd_return:43.29,  daily_limit:"5000元",   buy_status:"open" },
  { code:"005698", name:"华夏全球科技先锋混合(QDII)",            fee_rate:1.40, scale:26.3,  ytd_return:52.49,  daily_limit:"10000元",  buy_status:"open" },
  { code:"002891", name:"华夏移动互联灵活配置混合(QDII)A",       fee_rate:1.40, scale:3.1,   ytd_return:120.50, daily_limit:"1000元",   buy_status:"open" },
  { code:"016701", name:"银华海外数字经济量化选股混合(QDII)A",   fee_rate:1.40, scale:11.2,  ytd_return:27.21,  daily_limit:"50000元",  buy_status:"open" },
  { code:"501226", name:"长城全球新能源汽车股票(QDII-LOF)A",    fee_rate:1.40, scale:4.7,   ytd_return:48.21,  daily_limit:"100元",    buy_status:"open" },
  { code:"017144", name:"华宝海外新能源汽车股票(QDII)A",         fee_rate:1.40, scale:2.6,   ytd_return:24.08,  daily_limit:"10000元",  buy_status:"open" },
  { code:"008253", name:"华宝致远混合(QDII)A",                  fee_rate:1.40, scale:1.7,   ytd_return:47.82,  daily_limit:"3000元",   buy_status:"open" },
  { code:"457001", name:"国富亚洲机会股票(QDII)A",               fee_rate:1.40, scale:3.2,   ytd_return:143.79, daily_limit:"200元",    buy_status:"open" },
  { code:"100055", name:"富国全球科技互联网股票(QDII)A",          fee_rate:1.40, scale:10.2,  ytd_return:37.81,  daily_limit:"暂停申购",  buy_status:"suspended" },
  // ── 新增主题型主动 QDII ──
  { code:"004877", name:"汇添富全球医疗混合(QDII)人民币",          fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"006308", name:"汇添富全球消费混合(QDII)人民币A",          fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"006309", name:"汇添富全球消费混合(QDII)人民币C",          fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"018155", name:"创金合信全球医药生物股票发起式(QDII)A",    fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"018156", name:"创金合信全球医药生物股票发起式(QDII)C",    fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  // ── C 类份额补全 ──
  { code:"017437", name:"华宝纳斯达克精选股票发起式(QDII)C",        fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"017731", name:"嘉实全球产业升级股票发起式(QDII)C",        fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"022184", name:"富国全球科技互联网股票(QDII)C",             fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"016702", name:"银华海外数字经济量化选股混合(QDII)C",       fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"016823", name:"天弘全球新能源汽车股票(QDII-LOF)C",        fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"018036", name:"长城全球新能源车股票发起式(QDII)C",         fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
  { code:"017145", name:"华宝海外新能源汽车股票发起式(QDII)C",       fee_rate:1.40, scale:0,     ytd_return:0,      daily_limit:"不限额",    buy_status:"open" },
];

// ─── 持仓占位数据 ─────────────────────────────────────────────────────────────
const HOLDINGS_PLACEHOLDER = {
  "017436": [
    { name:"奈飞",               symbol:"NFLX",  weight:9.32,  change:null },
    { name:"英伟达",              symbol:"NVDA",  weight:9.28,  change:null },
    { name:"苹果",               symbol:"AAPL",  weight:7.76,  change:null },
    { name:"微软",               symbol:"MSFT",  weight:7.50,  change:null },
    { name:"博通",               symbol:"AVGO",  weight:7.43,  change:null },
    { name:"特斯拉",              symbol:"TSLA",  weight:7.33,  change:null },
    { name:"谷歌-C",              symbol:"GOOGL", weight:6.82,  change:null },
    { name:"亚马逊",              symbol:"AMZN",  weight:6.34,  change:null },
    { name:"Meta Platforms",    symbol:"META",  weight:5.77,  change:null },
    { name:"迈威尔科技",           symbol:"MRVL",  weight:4.96,  change:null },
  ],
};

// ─── 净值走势占位 ─────────────────────────────────────────────────────────────
function genNavHistory() {
  const data = [];
  let nav = 1.0;
  for (let i = 180; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    nav *= (1 + (Math.random() - 0.46) * 0.015);
    data.push({ date: `${d.getMonth()+1}/${d.getDate()}`, nav: parseFloat(nav.toFixed(4)) });
  }
  return data;
}

// ─── 指数迷你卡片（Hero 右侧）────────────────────────────────────────────────
function MiniIndexCard({ label, value, subValue }) {
  const isPos = value !== null && value >= 0;
  return (
    <div style={{
      width: 150, textAlign: "center",
      padding: "10px 14px",
      background: "rgba(255,255,255,0.10)",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.15)",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 5, fontWeight: 500 }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 800, letterSpacing: -0.5,
        color: value === null ? "rgba(255,255,255,0.4)" : isPos ? "#ff6b6b" : "#6ee7b7",
      }}>
        {value === null ? "—" : `${isPos ? "+" : ""}${value.toFixed(2)}%`}
      </div>
      {subValue != null && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 3 }}>{subValue}</div>
      )}
    </div>
  );
}

// ─── 表格样式 ─────────────────────────────────────────────────────────────────
const thStyle = {
  padding: "11px 14px", textAlign: "center",
  fontSize: 13, fontWeight: 800, color: C.text,
  letterSpacing: 0.3, textTransform: "uppercase",
  borderBottom: `1px solid ${C.border}`,
  background: "#fafafa",
  whiteSpace: "nowrap",
  position: "sticky", top: 0, zIndex: 1,
};
const tdStyle = {
  padding: "13px 14px", fontSize: 13,
  color: C.text, fontWeight: 500, borderBottom: `1px solid ${C.borderLight}`,
};

// ─── 可信度 ───────────────────────────────────────────────────────────────────
function getAccuracy(coverage) {
  if (coverage == null) return null;
  if (coverage >= 70) return { label:"高可信", color:"#059669", bg:"#d1fae5", border:"#6ee7b7" };
  if (coverage >= 50) return { label:"中等",   color:"#b45309", bg:"#fef3c7", border:"#fcd34d" };
  return               { label:"仅供参考", color:"#6b7280", bg:"#f3f4f6", border:"#d1d5db" };
}

// 圆环图色盘
const DONUT_COLORS = [
  "#4f46e5","#7c3aed","#2563eb","#0891b2","#0d9488",
  "#059669","#d97706","#dc2626","#db2777","#9333ea",
];

// ─── 基金行 ───────────────────────────────────────────────────────────────────
function FundRow({ fund, onClick, isEven, isMobile }) {
  const ytd = fund.ytd_return;
  const val = fund.valuation;
  const isOpen = fund.buy_status === "open";
  const acc = getAccuracy(fund.coverage);

  return (
    <tr
      onClick={() => onClick(fund)}
      style={{ background: isEven ? "#fafafa" : C.card, cursor: "pointer", transition: "background 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.background = "#eff6ff"}
      onMouseLeave={e => e.currentTarget.style.background = isEven ? "#fafafa" : C.card}
    >
      {isMobile ? (
        <td style={{ ...tdStyle, maxWidth: 220 }}>
          <div style={{ fontWeight:600, color:C.text, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fund.name}</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:3, flexWrap:"nowrap" }}>
            <span style={{ fontFamily:"monospace", fontSize:10, color:"#4f46e5", fontWeight:700, whiteSpace:"nowrap" }}>代码：{fund.code}</span>
            {fund.nav != null && (
              <span style={{ fontSize:10, color:C.red, fontFamily:"monospace", fontWeight:600, whiteSpace:"nowrap" }}>净值：{fund.nav.toFixed(4)}</span>
            )}
            {fund.coverage != null && (
              <span style={{ fontSize:10, color:acc ? acc.color : C.textDim, fontWeight:600, whiteSpace:"nowrap" }}>可信度：{fund.coverage}%</span>
            )}
          </div>
        </td>
      ) : (
        <>
          <td style={tdStyle}>
            <span style={{ fontFamily:"monospace", fontSize:12, color:"#4f46e5", fontWeight:700 }}>{fund.code}</span>
          </td>
          <td style={{ ...tdStyle, maxWidth:260, fontWeight:500, color:C.text }}>
            <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fund.name}</div>
          </td>
        </>
      )}
      {!isMobile && <td style={{ ...tdStyle, textAlign:"center" }}>{fund.fee_rate.toFixed(1)}%</td>}
      {!isMobile && <td style={{ ...tdStyle, textAlign:"center" }}>
        {fund.scale > 0 ? `${fund.scale.toFixed(1)}` : "—"}
      </td>}
      {!isMobile && <td style={{ ...tdStyle, textAlign:"right" }}>
        {ytd != null && ytd !== 0 ? (
          <span style={{ color: ytd >= 0 ? C.red : C.green, fontWeight:600 }}>
            {ytd >= 0 ? "+" : ""}{ytd.toFixed(2)}%
          </span>
        ) : "—"}
      </td>}
      {!isMobile && <td style={{ ...tdStyle, textAlign:"center" }}>
        <span style={{
          padding:"2px 8px", borderRadius:6, fontSize:12,
          background: isOpen ? "#1a9e5a12" : "#e0e0e510",
          color: isOpen ? C.green : C.textDim,
          border: `1px solid ${isOpen ? C.green+"30" : C.border}`,
          whiteSpace:"nowrap",
        }}>
          {fund.daily_limit}
        </span>
      </td>}
      {!isMobile && <td style={{ ...tdStyle, textAlign:"center" }}>
        {acc ? (
          <span style={{
            display:"inline-flex", flexDirection:"column", alignItems:"center",
            padding:"3px 10px", borderRadius:6, fontSize:11, fontWeight:600, lineHeight:1.5,
            color: acc.color, background: acc.bg, border:`1px solid ${acc.border}`,
            whiteSpace:"nowrap",
          }}>
            <span>{acc.label}</span>
            <span style={{ fontSize:10, fontWeight:400, opacity:0.8 }}>{fund.coverage}% 覆盖</span>
          </span>
        ) : (
          <span style={{ color:C.textDim, fontSize:12 }}>—</span>
        )}
      </td>}
      {!isMobile && <td style={{ ...tdStyle, textAlign:"center" }}>
        {fund.nav != null ? (
          <span style={{ fontWeight:600, color:C.text, fontSize:13, fontFamily:"monospace" }}>
            {fund.nav.toFixed(4)}
          </span>
        ) : (
          <span style={{ color:C.textDim, fontSize:12 }}>—</span>
        )}
      </td>}
      <td style={{ ...tdStyle, textAlign:"center", fontWeight:700 }}>
        {val != null ? (
          <span style={{ color: val >= 0 ? C.red : C.green, fontSize:15 }}>
            {val >= 0 ? "+" : ""}{val.toFixed(2)}%
          </span>
        ) : (
          <span style={{ color:"#a5b4fc", fontSize:13 }}>计算中…</span>
        )}
      </td>
    </tr>
  );
}

// ─── 详情面板 ─────────────────────────────────────────────────────────────────
function DetailPanel({ fund, onClose }) {
  // 优先用 API 实时持仓，无数据时显示占位
  const holdings = (fund.holdings && fund.holdings.length > 0)
    ? fund.holdings
    : (HOLDINGS_PLACEHOLDER[fund.code] || []);
  const navHistory = useMemo(() => genNavHistory(), [fund.code]);
  const ytd = fund.ytd_return;
  const val = fund.valuation;
  const acc = getAccuracy(fund.coverage);
  const [showAll, setShowAll] = useState(false);

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.45)", backdropFilter:"blur(6px)", display:"flex", justifyContent:"flex-end" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width:"min(620px,100%)", height:"100%", background:C.card,
        overflowY:"auto", boxShadow:"-8px 0 48px rgba(0,0,0,0.18)",
        borderRadius:"20px 0 0 20px",
        animation:"slideInRight 0.28s ease", display:"flex", flexDirection:"column",
      }}>
        {/* 顶部渐变 Header */}
        <div style={{
          background:"linear-gradient(135deg,#1a56db,#7c3aed)",
          padding:"28px 28px 24px", color:"#fff", position:"sticky", top:0, zIndex:10,
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:11, opacity:0.65, marginBottom:4, fontFamily:"monospace", letterSpacing:1 }}>{fund.code}</div>
              <div style={{ fontSize:18, fontWeight:800, lineHeight:1.3 }}>{fund.name}</div>
            </div>
            <button onClick={onClose} style={{
              width:32, height:32, borderRadius:"50%", border:"none",
              background:"rgba(255,255,255,0.15)", color:"#fff",
              fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
            }}>×</button>
          </div>

          {val != null && (
            <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ fontSize:36, fontWeight:900, letterSpacing:-1, color: val >= 0 ? "#ff6b6b" : "#6ee7b7" }}>
                {val >= 0 ? "+" : ""}{val.toFixed(2)}%
              </div>
              <div style={{ fontSize:12, opacity:0.7, lineHeight:1.5 }}>
                今日估算涨跌幅<br/>
                {fund.data_source === "gszzl" ? "fundgz 全仓实时估值" :
                 fund.data_source === "gszzl_fallback" ? "gszzl 兜底数据" :
                 fund.data_source === "calc_live" ? "Yahoo 实时股价加权" : "季报持仓加权"}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:"24px 28px", flex:1 }}>

          {/* 基本信息 */}
          <SectionTitle icon="📋">基本信息</SectionTitle>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:28 }}>
            {[
              { label:"运作费率", value:`${fund.fee_rate.toFixed(1)}%` },
              { label:"基金规模", value: fund.scale > 0 ? `${fund.scale.toFixed(1)} 亿元` : "—" },
              { label:"2025年涨幅", value: ytd != null && ytd !== 0 ? `${ytd >= 0 ? "+" : ""}${ytd.toFixed(2)}%` : "—" },
              { label:"每日限额", value: fund.daily_limit },
              { label:"申购状态", value: fund.buy_status === "open" ? "✅ 开放申购" : "⛔ 暂停申购" },
              { label:"估值可信度", value: acc ? `${acc.label}（持仓覆盖 ${fund.coverage}% 净值）` : "暂无数据" },
            ].map(item => (
              <div key={item.label} style={{ padding:"10px 14px", borderRadius:10, background:C.bg, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:11, color:C.textDim, marginBottom:3 }}>{item.label}</div>
                <div style={{ fontSize:14, fontWeight:600, color: item.label === "估值可信度" && acc ? acc.color : C.text }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* 估值说明 */}
          <SectionTitle icon="🧮">估值计算说明</SectionTitle>
          <div style={{ padding:"14px 16px", borderRadius:12, background:"#eff6ff", border:"1px solid #bfdbfe", marginBottom:28 }}>
            {fund.data_source === "gszzl" || fund.data_source === "gszzl_fallback" ? (
              <>
                <div style={{ fontSize:13, color:"#1e40af", lineHeight:1.8 }}>
                  数据来源：<strong>天天基金 fundgz 接口</strong>（基金公司官方全仓实时估值）
                </div>
                <div style={{ fontSize:12, color:"#3b82f6", marginTop:6, lineHeight:1.7 }}>
                  fundgz 涵盖基金全部持仓（非仅前十），数据每 15 分钟由基金公司更新一次，
                  精准度远高于持仓加权计算。A股/港股交易时段（09:30-15:00）实时可用。
                  {fund.gszzl_time && <span>（最后更新：{fund.gszzl_time}）</span>}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:13, color:"#1e40af", lineHeight:1.8 }}>
                  估值涨跌幅 ≈ <strong>Σ（持仓占比 × 股票涨跌幅）</strong> + <strong>汇率变动</strong>
                </div>
                <div style={{ fontSize:12, color:"#3b82f6", marginTop:6, lineHeight:1.7 }}>
                  基于季报前十重仓股加权计算。美股交易时段使用 Yahoo 实时价格，盘后使用收盘价缓存。
                  前十覆盖率越高，估值越接近真实净值变动。非美股（港股/欧股）暂无法获取实时价格，会影响覆盖率。
                </div>
              </>
            )}
          </div>

          {/* 持仓圆环图 */}
          {holdings.length > 0 && (() => {
            const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
            const top10 = sorted.slice(0, 10);
            const top10Weight = top10.reduce((s, h) => s + h.weight, 0);
            const otherWeight = Math.max(0, 100 - top10Weight);
            const pieData = [
              ...top10.map((h, i) => ({ name: h.name, symbol: h.symbol, value: h.weight, color: DONUT_COLORS[i % DONUT_COLORS.length] })),
              ...(otherWeight > 0.5 ? [{ name:"其他持仓", symbol:"", value: parseFloat(otherWeight.toFixed(1)), color:"#e2e8f0" }] : []),
            ];
            return (
              <div style={{ marginBottom:28 }}>
                <SectionTitle icon="🍩">前十大持仓结构</SectionTitle>
                <div style={{ borderRadius:14, border:`1px solid ${C.border}`, padding:"16px", background:C.card }}>
                  <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                    {/* 圆环 */}
                    <div style={{ position:"relative", flexShrink:0 }}>
                      <PieChart width={160} height={160}>
                        <Pie
                          data={pieData}
                          cx={75} cy={75}
                          innerRadius={50} outerRadius={75}
                          dataKey="value"
                          strokeWidth={1.5}
                          stroke="#fff"
                        >
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip
                          formatter={(v, n, p) => [`${v.toFixed(1)}%`, p.payload.name]}
                          contentStyle={{ borderRadius:8, fontSize:12 }}
                        />
                      </PieChart>
                      {/* 中心文字 */}
                      <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center", pointerEvents:"none" }}>
                        <div style={{ fontSize:16, fontWeight:800, color:C.text }}>{top10Weight.toFixed(0)}%</div>
                        <div style={{ fontSize:9, color:C.textDim }}>前十</div>
                      </div>
                    </div>
                    {/* 图例 */}
                    <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5, minWidth:0 }}>
                      {pieData.map((d, i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11 }}>
                          <div style={{ width:8, height:8, borderRadius:2, background:d.color, flexShrink:0 }} />
                          <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color: d.symbol ? C.text : C.textDim }}>{d.name || d.symbol}</span>
                          <span style={{ fontWeight:600, color: d.symbol ? C.text : C.textDim, flexShrink:0 }}>{d.value.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 持仓明细 */}
          <SectionTitle icon="🏢">
            {showAll ? `全部持仓明细（${holdings.length}只）` : `前十大持仓`}
          </SectionTitle>
          {holdings.length > 0 ? (
            <div style={{ borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"linear-gradient(135deg,#1a56db,#7c3aed)" }}>
                    <th style={{ ...thStyle, position:"static", color:"rgba(255,255,255,0.8)", background:"transparent" }}>名称</th>
                    <th style={{ ...thStyle, position:"static", textAlign:"center", color:"rgba(255,255,255,0.8)", background:"transparent" }}>占比</th>
                    <th style={{ ...thStyle, position:"static", textAlign:"right", color:"rgba(255,255,255,0.8)", background:"transparent" }}>昨晚涨跌</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => { const maxW = holdings.reduce((m, x) => Math.max(m, x.weight), 1);
                  const sortedAll = [...holdings].sort((a, b) => b.weight - a.weight);
                  const displayed = showAll ? sortedAll : sortedAll.slice(0, 10);
                  return displayed.map((h, i) => {
                    const dotColor = i < 10 ? DONUT_COLORS[i] : "#d1d5db";
                    return (
                      <tr key={h.symbol || i} style={{ background: i % 2 ? "#fafafa" : C.card }}>
                        <td style={tdStyle}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <div style={{ width:8, height:8, borderRadius:2, background:dotColor, flexShrink:0 }} />
                            <div>
                              <div style={{ fontWeight:500, color:C.text }}>{h.name || h.symbol}</div>
                              <div style={{ fontSize:11, color:C.textDim, fontFamily:"monospace" }}>{h.symbol}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign:"center" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"center" }}>
                            <div style={{ width:50, height:4, borderRadius:2, background:C.borderLight, overflow:"hidden" }}>
                              <div style={{ width:`${(h.weight / maxW) * 100}%`, height:"100%", background: dotColor, borderRadius:2 }} />
                            </div>
                            <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{h.weight.toFixed(2)}%</span>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign:"right" }}>
                          {h.change != null ? (
                            <span style={{ color: h.change >= 0 ? C.red : C.green, fontWeight:600 }}>
                              {h.change >= 0 ? "+" : ""}{h.change.toFixed(2)}%
                            </span>
                          ) : (
                            <span style={{ color:C.textDim, fontSize:12 }} title="非美股或暂无报价">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  }); })()}
                </tbody>
              </table>
              {holdings.length > 10 && (
                <div style={{ textAlign:"center", padding:"12px 0", borderTop:`1px solid ${C.borderLight}` }}>
                  <button
                    onClick={() => setShowAll(v => !v)}
                    style={{
                      padding:"6px 20px", borderRadius:8, border:`1px solid ${C.border}`,
                      background:C.card, color:"#4f46e5", fontSize:12, fontWeight:600,
                      cursor:"pointer",
                    }}
                  >
                    {showAll ? "收起" : `展示全部 ${holdings.length} 只持仓`}
                  </button>
                </div>
              )}
              <div style={{ padding:"10px 14px", fontSize:11, color:C.textDim, borderTop:`1px solid ${C.border}`, background:"#fafafa", display:"flex", justifyContent:"space-between" }}>
                <span>数据来源：基金最新季报</span>
                <span>「—」表示非美股或暂无报价，不计入估值</span>
              </div>
            </div>
          ) : (
            <div style={{ padding:"48px 0", textAlign:"center", color:C.textDim, fontSize:13, background:C.bg, borderRadius:12 }}>
              持仓数据加载中…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, children }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <div style={{ fontSize:13, fontWeight:700, color:C.textMuted, letterSpacing:0.3, textTransform:"uppercase" }}>{children}</div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function QDIIPage() {
  const isMobile = useIsMobile();
  const [selected, setSelected]       = useState(null);
  const [search, setSearch]           = useState("");
  const [sortKey, setSortKey]         = useState(null);
  const [sortDir, setSortDir]         = useState("desc");

  // ── API 数据 ──
  const [valuations, setValuations]   = useState({});   // { code -> {valuation, holdings, coverage, nav} }
  const [fxPrice, setFxPrice]         = useState(null);
  const [indexData, setIndexData]     = useState([
    { label:"纳斯达克",    value: null },
    { label:"纳指100",     value: null },
    { label:"标普500",     value: null },
    { label:"美元/人民币", value: null },
  ]);
  const [loading, setLoading]         = useState(true);
  const [updatedAt, setUpdatedAt]     = useState(null);
  const [session, setSession]         = useState(() => getMarketSession());

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  // 拉估值数据（可被自动刷新复用）
  function fetchValuations(showLoading = false) {
    if (showLoading) setLoading(true);
    return fetch("/api/qdii/valuations", { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        const map = {};
        (data.funds || []).forEach(f => { map[f.code] = f; });
        setValuations(map);
        setUpdatedAt(data.updated_at || null);
        setSession(data.session || getMarketSession());
        const fx = data.fx_change ?? null;
        const fp = data.fx_price  ?? null;
        setFxPrice(fp);
        setIndexData(prev => prev.map(d =>
          d.label === "美元/人民币" ? { ...d, value: fx } : d
        ));
      })
      .catch(e => console.warn("[qdii] valuations fetch failed", e))
      .finally(() => { if (showLoading) setLoading(false); });
  }

  // 初始拉取
  useEffect(() => {
    fetchValuations(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 每 15 分钟检查一次：开盘时段则刷新，盘后跳过
  // 始终挂载 interval，避免页面在盘后打开、开盘后无法自动刷新的问题
  useEffect(() => {
    const timer = setInterval(() => {
      if (getMarketSession() !== "closed") fetchValuations(false);
    }, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 拉指数数据（market-sentiment）
  useEffect(() => {
    fetch("/api/market-sentiment")
      .then(r => r.json())
      .then(data => {
        const d   = data?.data ?? {};
        const ndx = d?.ndx_price?.change_pct ?? null;
        const spx = d?.spx_price?.change_pct ?? null;
        setIndexData(prev => prev.map(item => {
          if (item.label === "纳斯达克")  return { ...item, value: ndx };
          if (item.label === "纳指100")   return { ...item, value: ndx };
          if (item.label === "标普500")   return { ...item, value: spx };
          return item;
        }));
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // 将 API 估值数据合并进静态基金列表
    let list = QDII_FUNDS.map(f => {
      const api = valuations[f.code] || {};
      return {
        ...f,
        // API 数据优先，静态数据兜底
        scale:       api.scale       ?? (f.scale      > 0 ? f.scale      : null),
        ytd_return:  api.ytd_return  ?? (f.ytd_return > 0 ? f.ytd_return : null),
        valuation:   api.valuation   ?? null,
        coverage:    api.coverage    ?? null,
        holdings:    api.holdings    ?? null,
        nav:         api.nav         ?? null,
        data_source: api.data_source ?? null,
        gszzl_time:  api.gszzl_time  ?? null,
      };
    });

    if (q) list = list.filter(f => f.name.toLowerCase().includes(q) || f.code.includes(q));

    if (sortKey) {
      list.sort((a, b) => {
        let av, bv;
        if (sortKey === "daily_limit") {
          const parse = s => s === "暂停申购" ? -1 : parseInt(s.replace(/\D/g, ""), 10) || 0;
          av = parse(a.daily_limit); bv = parse(b.daily_limit);
        } else {
          av = a[sortKey] ?? -Infinity; bv = b[sortKey] ?? -Infinity;
        }
        return sortDir === "desc" ? bv - av : av - bv;
      });
    }
    return list;
  }, [search, sortKey, sortDir, valuations]);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, paddingBottom:60 }}>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div style={{ background:"linear-gradient(135deg,#1a56db,#7c3aed)", color:"#fff", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", width:320, height:320, borderRadius:"50%", background:"rgba(255,255,255,0.04)", top:-80, right:-60, pointerEvents:"none" }} />
        <div style={{ position:"absolute", width:180, height:180, borderRadius:"50%", background:"rgba(255,255,255,0.05)", bottom:-40, left:120, pointerEvents:"none" }} />

        <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "14px 16px 18px" : "18px 40px 20px" }}>
          {/* 返回首页 */}
          <a href="/" style={{ display:"inline-flex", alignItems:"center", gap:6, color:"rgba(255,255,255,0.75)", fontSize:12, textDecoration:"none", marginBottom:12, padding:"4px 0" }}>
            <span style={{ fontSize:14 }}>←</span> 返回首页
          </a>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:24, flexWrap: isMobile ? "wrap" : "nowrap" }}>
            {/* 左：标题区 */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"3px 10px", fontSize:10, fontWeight:600, letterSpacing:"0.05em", marginBottom:8 }}>
                QDII VALUATION
              </div>
              <h1 style={{ fontSize: isMobile ? 18 : 23, fontWeight:800, margin:"0 0 6px", letterSpacing:"-0.02em" }}>
                主动 QDII 基金估值
              </h1>
              <p style={{ fontSize: isMobile ? 11 : 12, opacity:0.85, margin:"0 0 10px", lineHeight:1.6, maxWidth:560 }}>
                官方净值延迟 T+1/T+2 公布，美股收盘后用季报十大重仓股加权估算今日涨跌幅，帮你在 3PM 申购截止前提前决策。
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {[
                  { icon:"🧮", text:"持仓加权估算" },
                  { icon:"💱", text:"含汇率变动" },
                  { icon:"🎯", text:"仅主动型 QDII" },
                ].map(tag => (
                  <div key={tag.text} style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.12)", borderRadius:20, padding:"3px 10px", fontSize:11 }}>
                    {tag.icon} {tag.text}
                  </div>
                ))}
                {/* 动态时段状态徽章 */}
                {(() => {
                  const si = SESSION_INFO[session] || SESSION_INFO.closed;
                  return (
                    <div style={{ display:"flex", alignItems:"center", gap:5, background: si.bg, border:`1px solid ${si.color}40`, borderRadius:20, padding:"3px 10px", fontSize:11, color: si.color, fontWeight:600 }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background: si.color, display:"inline-block",
                        ...(session !== "closed" ? { animation:"pulse 1.5s infinite" } : {}) }} />
                      {si.label} · {si.desc}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* 右：指数数据（单行 4 列）*/}
            {!isMobile && (
              <div style={{ display:"flex", flexDirection:"column", gap:5, flexShrink:0 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", textAlign:"center", marginBottom:2 }}>昨晚美股收盘数据</div>
                <div style={{ display:"flex", gap:8 }}>
                  {indexData.map(d => (
                    <MiniIndexCard
                      key={d.label}
                      {...d}
                      subValue={d.label === "美元/人民币" && fxPrice != null ? `¥${fxPrice.toFixed(4)}` : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 说明条 ───────────────────────────────────────────────────────────── */}
      <div style={{ background:C.card, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "10px 16px" : "12px 40px" }}>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: isMobile ? 10 : 20 }}>
            {[
              { icon:"⏰", title:"提前决策", desc:"官方净值 T+1/T+2 才公布，估值帮你在 3PM 截止前做判断" },
              { icon:"🧮", title:"双源估算", desc:"A股时段用 fundgz 全仓实时估值；美股时段用 Yahoo 实时股价加权" },
              { icon:"💱", title:"含汇率", desc:"人民币/美元汇率变动同步纳入计算，影响约 ±0.3%" },
              { icon:"⚠️", title:"仅供参考", desc:"持仓数据滞后 1-2 个月，实际净值以基金公司公告为准" },
            ].map(item => (
              <div key={item.title} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                <span style={{ fontSize:22, lineHeight:1, flexShrink:0 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:3 }}>{item.title}</div>
                  <div style={{ fontSize:11, color:C.textMuted, lineHeight:1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 基金表格 ─────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth:1440, margin:"28px auto", padding: isMobile ? "0 16px" : "0 40px" }}>
        {/* 标题 + 搜索 */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:2 }}>
              {QDII_FUNDS.length} 只主动型 QDII 场外基金
            </div>
            <div style={{ fontSize:12, color:C.textDim }}>点击任意行查看持仓明细和估值计算</div>
          </div>
          <div style={{ position:"relative" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索基金名称或代码…"
              style={{
                width:220, padding:"8px 14px 8px 34px",
                borderRadius:10, border:`1.5px solid ${C.border}`,
                fontSize:13, color:C.text, background:C.card,
                outline:"none", boxSizing:"border-box", transition:"border-color 0.2s",
              }}
              onFocus={e => e.target.style.borderColor = "#4f46e5"}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:14, color:C.textDim }}>🔍</span>
          </div>
        </div>

        {/* 表格 */}
        <div style={{ borderRadius:16, border:`1px solid ${C.border}`, background:C.card, overflow:"hidden", boxShadow:"0 2px 16px rgba(0,0,0,0.06)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                {isMobile ? (
                  <th style={{ ...thStyle, minWidth:180 }}>基金</th>
                ) : (
                  <>
                    <th style={thStyle}>代码</th>
                    <th style={{ ...thStyle, minWidth:200, textAlign:"left" }}>基金名称</th>
                  </>
                )}
                {(isMobile ? [
                  { key:"valuation", label:"今日估值", align:"center" },
                ] : [
                  { key:"fee_rate",    label:"费率",    align:"center" },
                  { key:"scale",       label:"规模(亿)", align:"center" },
                  { key:"ytd_return",  label:"25年涨幅", align:"right"  },
                  { key:"daily_limit", label:"每日限额", align:"center" },
                  { key:"coverage",    label:"可信度",   align:"center" },
                  { key:"nav",         label:"最新净值", align:"center" },
                  { key:"valuation",   label:"今日估值", align:"center"  },
                ]).map(({ key, label, align }) => {
                  const active = sortKey === key;
                  const arrow = active ? (sortDir === "desc" ? " ▼" : " ▲") : " ↕";
                  return (
                    <th key={key}
                      style={{ ...thStyle, textAlign: align, cursor:"pointer", userSelect:"none",
                        color: active ? "#4f46e5" : C.textMuted,
                        background: "#fafafa",
                      }}
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      <span style={{ fontSize:10, opacity: active ? 1 : 0.4 }}>{arrow}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((fund, i) => (
                <FundRow key={fund.code} fund={fund} isEven={i % 2 === 0} onClick={setSelected} isMobile={isMobile} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isMobile ? 2 : 9} style={{ padding:"60px 0", textAlign:"center", color:C.textDim, fontSize:14 }}>
                    未找到相关基金
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}`, fontSize:12, color:C.textDim, display:"flex", justifyContent:"space-between", alignItems:"center", background:"#fafafa" }}>
            <span>共 {filtered.length} 只{loading ? " · 估值加载中…" : ""}</span>
            <span>
              {updatedAt
                ? `更新于 ${new Date(updatedAt).toLocaleString("zh-CN", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})} · `
                : ""}
              {session === "cn" ? "fundgz 全仓估值" : session === "us" ? "Yahoo 实时股价加权" : "季报持仓 × 收盘涨跌 + 汇率"}
            </span>
          </div>
        </div>
      </div>

      {/* 详情面板 */}
      {selected && <DetailPanel fund={selected} onClose={() => setSelected(null)} />}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
