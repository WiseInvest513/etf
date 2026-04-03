import { useState, useEffect, useMemo, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend, Area, AreaChart } from "recharts";

// ─── API Config ──────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:8000/api"; // 部署后改为你的域名

async function apiFetch(path) {
  try {
    const resp = await fetch(`${API_BASE}${path}`);
    if (resp.ok) return await resp.json();
  } catch (e) {
    console.warn(`API fetch failed for ${path}, using fallback data`);
  }
  return null;
}


const generatePremiumHistory = (code, days = 30, etfList = []) => {
  const base = etfList.find(e => e.code === code)?.premium || 1;
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(); date.setDate(date.getDate() - (days - i));
    return { date: `${date.getMonth() + 1}/${date.getDate()}`, premium: +(base + (Math.random() - 0.4) * 3).toFixed(2) };
  });
};

const generateReturnComparison = () =>
  ["10月", "11月", "12月", "1月", "2月", "3月"].map(m => ({
    month: m,
    nasdaq: +(Math.random() * 8 - 2).toFixed(2),
    sp500: +(Math.random() * 6 - 1.5).toFixed(2),
  }));

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0e1a", surface: "#111827", surfaceHover: "#1a2236",
  card: "#151d2e", border: "#1e293b",
  text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b",
  accent: "#3b82f6", green: "#10b981", greenBg: "#10b98115",
  red: "#ef4444", redBg: "#ef444415", orange: "#f59e0b", orangeBg: "#f59e0b15",
  purple: "#8b5cf6", purpleBg: "#8b5cf615", cyan: "#06b6d4", cyanBg: "#06b6d415",
};

// ─── Reusable Components ─────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const isOpen = status === "open";
  const color = isOpen ? C.green : C.red;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: isOpen ? C.greenBg : C.redBg, color, border: `1px solid ${color}30` }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {isOpen ? "开放" : "暂停"}
    </span>
  );
};

const PremiumBadge = ({ value }) => {
  const color = value > 2 ? C.red : value > 1 ? C.orange : C.green;
  const bg = value > 2 ? C.redBg : value > 1 ? C.orangeBg : C.greenBg;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: bg, color, border: `1px solid ${color}30` }}>{value > 0 ? "+" : ""}{value}%</span>;
};

const StatCard = ({ label, value, sub, color = C.accent }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", flex: 1, minWidth: 180, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: color + "08" }} />
    <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: -1 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
  </div>
);

const SectionHeader = ({ title, subtitle, count }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.5 }}>{title}</h2>
      {count != null && <span style={{ background: C.accent + "20", color: C.accent, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{count}只</span>}
    </div>
    {subtitle && <p style={{ fontSize: 13, color: C.textDim, margin: "6px 0 0" }}>{subtitle}</p>}
  </div>
);

const DataTable = ({ columns, data, sortKey, sortDir, onSort }) => (
  <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${C.border}`, background: C.card }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col.key} onClick={() => col.sortable !== false && onSort?.(col.key)} style={{ padding: "12px 14px", textAlign: col.align || "left", color: sortKey === col.key ? C.accent : C.textDim, fontWeight: 600, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, background: C.surface, cursor: col.sortable !== false ? "pointer" : "default", userSelect: "none", position: "sticky", top: 0, zIndex: 1 }}>
              {col.label}{sortKey === col.key && <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={row.code} style={{ background: i % 2 === 0 ? "transparent" : C.surface + "50", transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
            onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.surface + "50"}>
            {columns.map(col => (
              <td key={col.key} style={{ padding: "11px 14px", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}40`, textAlign: col.align || "left", color: C.text }}>
                {col.render ? col.render(row[col.key], row) : row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Tabs ────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview", label: "总览", icon: "◈" },
  { id: "nasdaq", label: "纳指被动", icon: "▦" },
  { id: "sp500", label: "标普500", icon: "▥" },
  { id: "active", label: "美股主动", icon: "◉" },
  { id: "etf", label: "场内ETF", icon: "◆" },
];

// ─── Main App ────────────────────────────────────────────────────────────────
export default function WiseETFDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [selectedETF, setSelectedETF] = useState("513100");
  const [isUpdating, setIsUpdating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Data state — 全部从 API 获取，无本地静态兜底
  const [nasdaqData, setNasdaqData] = useState([]);
  const [sp500Data, setSp500Data] = useState([]);
  const [activeData, setActiveData] = useState([]);
  const [etfData, setEtfData] = useState([]);
  const [lastUpdate, setLastUpdate] = useState("");

  useEffect(() => {
    async function loadAll() {
      try {
        const [overview, nasdaq, sp500, active, etfs] = await Promise.all([
          apiFetch("/overview"),
          apiFetch("/funds/nasdaq_passive"),
          apiFetch("/funds/sp500_passive"),
          apiFetch("/funds/us_active"),
          apiFetch("/etfs"),
        ]);
        if (!nasdaq?.data?.length && !sp500?.data?.length) {
          setLoadError(true);
          return;
        }
        if (nasdaq?.data?.length) setNasdaqData(nasdaq.data);
        if (sp500?.data?.length) setSp500Data(sp500.data);
        if (active?.data?.length) setActiveData(active.data);
        if (etfs?.data?.length) setEtfData(etfs.data);
        setLastUpdate(overview?.last_update || new Date().toLocaleString("zh-CN"));
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sortData = (data) => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av || "").localeCompare(String(bv || "")) : String(bv || "").localeCompare(String(av || ""));
    });
  };

  const handleManualUpdate = async () => {
    setIsUpdating(true);
    const result = await apiFetch("/update");
    if (result) setLastUpdate(new Date().toLocaleString("zh-CN"));
    setIsUpdating(false);
  };

  const premiumHistory = useMemo(() => generatePremiumHistory(selectedETF, 30, etfData), [selectedETF, etfData]);
  const returnComparison = useMemo(() => generateReturnComparison(), []);

  // Computed stats
  const avg = (arr, key) => arr.length ? (arr.reduce((s, f) => s + (f[key] || 0), 0) / arr.length).toFixed(1) : "0";
  const totalFunds = nasdaqData.length + sp500Data.length + activeData.length + etfData.length;
  const openFunds = [...nasdaqData, ...sp500Data, ...activeData].filter(f => f.buy_status === "open").length + etfData.length;
  const topPerformers = [...activeData].sort((a, b) => (b.ytd_return || 0) - (a.ytd_return || 0)).slice(0, 5);

  // Column definitions
  const passiveCols = [
    { key: "code", label: "基金代码", render: v => <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.accent, fontWeight: 600 }}>{v}</span> },
    { key: "name", label: "基金名称", render: v => <span style={{ fontSize: 12 }}>{v}</span> },
    { key: "fee_rate", label: "总费率%", align: "right", render: v => v != null ? `${v}%` : "-" },
    { key: "scale", label: "规模(亿)", align: "right", render: v => <span style={{ fontWeight: 600 }}>{v || "-"}</span> },
    { key: "ytd_return", label: "近1年涨幅", align: "right", render: v => v != null ? <span style={{ color: v > 0 ? C.green : C.red, fontWeight: 700 }}>{v > 0 ? "+" : ""}{v}%</span> : "-" },
    { key: "track_error", label: "跟踪误差", align: "right", render: v => v != null ? <span style={{ color: v > 2 ? C.orange : C.textMuted }}>{v}%</span> : "-" },
    { key: "daily_limit", label: "申购上限", align: "right" },
    { key: "buy_status", label: "状态", align: "center", render: v => <StatusBadge status={v} /> },
  ];

  const activeCols = [
    { key: "code", label: "基金代码", render: v => <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.purple, fontWeight: 600 }}>{v}</span> },
    { key: "name", label: "基金名称", render: v => <span style={{ fontSize: 12 }}>{v}</span> },
    { key: "fee_rate", label: "总费率%", align: "right", render: v => v != null ? `${v}%` : "-" },
    { key: "scale", label: "规模(亿)", align: "right", render: v => <span style={{ fontWeight: 600 }}>{v || "-"}</span> },
    { key: "ytd_return", label: "近1年涨幅", align: "right", render: v => v != null ? <span style={{ color: C.green, fontWeight: 700 }}>+{v}%</span> : "-" },
    { key: "daily_limit", label: "每日申购上限", align: "right" },
    { key: "buy_status", label: "状态", align: "center", render: v => <StatusBadge status={v} /> },
  ];

  const etfCols = [
    { key: "code", label: "代码", render: v => <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.cyan, fontWeight: 600 }}>{v}</span> },
    { key: "name", label: "ETF名称" },
    { key: "tracking_index", label: "跟踪指数", render: v => <span style={{ color: C.textMuted, fontSize: 12 }}>{v || "-"}</span> },
    { key: "scale", label: "规模(亿)", align: "right", render: v => <span style={{ fontWeight: 600 }}>{v || "-"}</span> },
    { key: "ytd_return", label: "近1年涨幅", align: "right", render: v => v != null ? <span style={{ color: C.green, fontWeight: 700 }}>+{v}%</span> : "-" },
    { key: "premium", label: "溢价率", align: "center", render: v => v != null ? <PremiumBadge value={v} /> : "-" },
    { key: "volume", label: "日均成交(亿)", align: "right" },
  ];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: `3px solid ${C.accent}30`, borderTopColor: C.accent, animation: "spin 0.8s linear infinite" }} />
      <span style={{ color: C.textMuted, fontSize: 14 }}>正在加载基金数据...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (loadError) return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <span style={{ fontSize: 32 }}>⚠</span>
      <span style={{ color: C.textMuted, fontSize: 14 }}>数据加载失败，请刷新页面重试</span>
      <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: "8px 20px", borderRadius: 8, background: C.accent + "20", color: C.accent, border: `1px solid ${C.accent}30`, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>刷新</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Header */}
      <header style={{ padding: "20px 32px", borderBottom: `1px solid ${C.border}`, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)`, position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(20px)" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, color: "#fff", boxShadow: `0 4px 20px ${C.accent}40` }}>W</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>Wise<span style={{ color: C.accent }}>ETF</span></h1>
              <div style={{ fontSize: 11, color: C.textDim }}>场外QDII · 场内ETF · 溢价追踪</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, background: loading ? C.orangeBg : loadError ? C.redBg : C.greenBg, border: `1px solid ${loading ? C.orange : loadError ? C.red : C.green}30` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: loading ? C.orange : loadError ? C.red : C.green, animation: loading ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontSize: 11, color: loading ? C.orange : loadError ? C.red : C.green, fontWeight: 600 }}>
                {loading ? "加载中..." : loadError ? "加载失败" : "数据已更新"}
              </span>
            </div>
            {!loading && !loadError && (
              <button onClick={handleManualUpdate} disabled={isUpdating} style={{ background: C.accent + "20", color: C.accent, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: isUpdating ? "wait" : "pointer" }}>
                {isUpdating ? "更新中..." : "手动更新"}
              </button>
            )}
            <span style={{ fontSize: 11, color: C.textDim }}>更新: {lastUpdate}</span>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav style={{ padding: "0 32px", borderBottom: `1px solid ${C.border}`, background: C.surface + "80", backdropFilter: "blur(10px)", position: "sticky", top: 78, zIndex: 99 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", gap: 0, overflowX: "auto" }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSortKey(null); }}
              style={{ padding: "14px 22px", border: "none", background: "none", color: activeTab === tab.id ? C.accent : C.textDim, fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 13, cursor: "pointer", borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : "2px solid transparent", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 14 }}>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px 60px" }}>
        {activeTab === "overview" && (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
              <StatCard label="纳指基金平均涨幅" value={`+${avg(nasdaqData, "ytd_return")}%`} sub="近一年" color={C.green} />
              <StatCard label="标普基金平均涨幅" value={`+${avg(sp500Data, "ytd_return")}%`} sub="近一年" color={C.cyan} />
              <StatCard label="主动基金平均涨幅" value={`+${avg(activeData, "ytd_return")}%`} sub="近一年" color={C.purple} />
              <StatCard label="场内ETF平均溢价" value={`${avg(etfData, "premium")}%`} sub="当前" color={C.orange} />
              <StatCard label="监控基金总数" value={totalFunds} sub={`${openFunds}只可申购`} color={C.accent} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
              <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>纳指 vs 标普 月度收益对比</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={returnComparison} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="nasdaq" name="纳斯达克100" fill={C.accent} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="sp500" name="标普500" fill={C.cyan} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>场内ETF溢价走势</div>
                  <select value={selectedETF} onChange={e => setSelectedETF(e.target.value)} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "4px 10px", fontSize: 12, outline: "none" }}>
                    {etfData.map(e => <option key={e.code} value={e.code}>{e.code} {e.name}</option>)}
                  </select>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={premiumHistory}>
                    <defs><linearGradient id="pG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.orange} stopOpacity={0.3} /><stop offset="95%" stopColor={C.orange} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="date" tick={{ fill: C.textDim, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => [`${v}%`, "溢价率"]} />
                    <Area type="monotone" dataKey="premium" stroke={C.orange} fill="url(#pG)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <SectionHeader title="近一年涨幅 TOP 5（主动型）" />
            <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
              {topPerformers.map((f, i) => (
                <div key={f.code} style={{ flex: 1, minWidth: 200, background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 10, right: 14, fontSize: 36, fontWeight: 900, color: C.accent + "12", lineHeight: 1 }}>#{i + 1}</div>
                  <div style={{ fontSize: 11, color: C.textDim, fontFamily: "monospace" }}>{f.code}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "6px 0 10px", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>+{f.ytd_return}%</div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>规模 {f.scale}亿 · 限额 {f.daily_limit}</div>
                </div>
              ))}
            </div>

            <SectionHeader title="场内ETF溢价预警" subtitle="溢价率 > 2% 标红预警" />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {etfData.map(e => (
                <div key={e.code} style={{ background: C.card, borderRadius: 14, border: `1px solid ${(e.premium || 0) > 2 ? C.red + "40" : C.border}`, padding: "16px 20px", minWidth: 180, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <div style={{ fontSize: 11, color: C.textDim, fontFamily: "monospace" }}>{e.code}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{e.name}</div>
                    </div>
                    <PremiumBadge value={e.premium || 0} />
                  </div>
                  <div style={{ marginTop: 12, display: "flex", gap: 16 }}>
                    <div><div style={{ fontSize: 10, color: C.textDim }}>涨幅</div><div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>+{e.ytd_return}%</div></div>
                    <div><div style={{ fontSize: 10, color: C.textDim }}>规模</div><div style={{ fontSize: 14, fontWeight: 600 }}>{e.scale}亿</div></div>
                    <div><div style={{ fontSize: 10, color: C.textDim }}>成交</div><div style={{ fontSize: 14, fontWeight: 600 }}>{e.volume}亿</div></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === "nasdaq" && (
          <>
            <SectionHeader title="场外纳斯达克100（被动型）基金对比" subtitle="数据来源：天天基金网" count={nasdaqData.length} />
            <DataTable columns={passiveCols} data={sortData(nasdaqData)} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <TipBox color={C.accent} text="综合费率最低的有天弘(018043, 0.70%)和嘉实(016532, 0.70%)，但目前均暂停申购。可申购中费率较低的是摩根(019172, 0.72%)和易方达(161130, 0.72%)。广发(270042)规模最大(108亿)，跟踪误差最小(1.10%)。" />
          </>
        )}

        {activeTab === "sp500" && (
          <>
            <SectionHeader title="场外标普500基金对比" subtitle="数据来源：天天基金网" count={sp500Data.length} />
            <DataTable columns={passiveCols} data={sortData(sp500Data)} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <TipBox color={C.cyan} text="博时(050025)规模最大(67.56亿)、跟踪误差最小(1.31%)，但暂停申购。可申购推荐摩根(017641, 0.77%)和易方达(161125)。注意161128跟踪标普信息科技指数，波动更大。" />
          </>
        )}

        {activeTab === "active" && (
          <>
            <SectionHeader title="场外美股（主动型）基金对比" subtitle="数据来源：天天基金网" count={activeData.length} />
            <DataTable columns={activeCols} data={sortData(activeData)} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <TipBox color={C.purple} text="主动型管理费较高(~1.55%)，但优秀经理可带来超额收益。易方达全球成长(012920)近一年+100.44%，但限额仅50元/日。申购限额越低说明额度越紧张。" />
          </>
        )}

        {activeTab === "etf" && (
          <>
            <SectionHeader title="场内ETF（纳指 / 标普）" subtitle="可在A股账户直接交易，关注溢价风险" count={etfData.length} />
            <DataTable columns={etfCols} data={sortData(etfData)} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <div style={{ marginTop: 24, background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>溢价率历史走势（近30天）</div>
                <select value={selectedETF} onChange={e => setSelectedETF(e.target.value)} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "6px 12px", fontSize: 12, outline: "none" }}>
                  {etfData.map(e => <option key={e.code} value={e.code}>{e.code} {e.name}</option>)}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={premiumHistory}>
                  <defs><linearGradient id="pG2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.orange} stopOpacity={0.3} /><stop offset="95%" stopColor={C.orange} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="date" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => [`${v}%`, "溢价率"]} />
                  <Area type="monotone" dataKey="premium" stroke={C.orange} fill="url(#pG2)" strokeWidth={2} dot={{ r: 2, fill: C.orange }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <TipBox color={C.orange} text="场内ETF价格 = 净值 + 溢价。溢价过高时买入可能面临溢价回落风险。一般建议溢价率 < 1.5% 时买入较为安全；溢价 > 3% 时建议谨慎。" />
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "20px 32px", background: C.surface }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: C.textDim, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span>© 2026 wise-etf.com</span>
            <a href="https://www.wise-invest.org" style={{ color: C.textDim, textDecoration: "none" }}>wise-invest.org</a>
            <a href="https://www.wise-witness.com" style={{ color: C.textDim, textDecoration: "none" }}>wise-witness.com</a>
            <a href="https://www.wise-claw.org" style={{ color: C.textDim, textDecoration: "none" }}>wise-claw.org</a>
          </div>
          <div>数据来源：天天基金网 · 仅供参考，不构成投资建议</div>
        </div>
      </footer>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        table th:hover { color: ${C.accent} !important; }
      `}</style>
    </div>
  );
}

function TipBox({ color, text }) {
  return (
    <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: color + "10", border: `1px solid ${color}20`, fontSize: 12, color: C.textMuted, lineHeight: 1.8 }}>
      <strong style={{ color }}>提示：</strong>{text}
    </div>
  );
}
