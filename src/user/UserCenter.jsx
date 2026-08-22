import { useEffect, useMemo, useState } from "react";
import { normalizeSubscriptionStatus } from "../data/model.js";
import "./user-center.css";

const GROUPS = [
  { key: "nasdaq", label: "纳指被动", color: "#4f46e5" },
  { key: "sp500", label: "标普 500", color: "#0891b2" },
  { key: "active", label: "美股主动", color: "#9333ea" },
  { key: "etfs", label: "场内 ETF", color: "#ea580c" },
];

const NAV_ITEMS = [
  { key: "overview", label: "个人概览", icon: "home" },
  { key: "favorites", label: "我的收藏", icon: "star" },
  { key: "compare", label: "产品对比", icon: "compare" },
  { key: "security", label: "账号安全", icon: "shield" },
];

function Icon({ name, size = 18 }) {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></>,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>,
    compare: <><path d="M8 5h13"/><path d="m17 2 4 3-4 3"/><path d="M16 19H3"/><path d="m7 16-4 3 4 3"/></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.8 3.1 8 7.5 9.5 4.4-1.5 7.5-4.7 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/></>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    logout: <><path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4"/><path d="M8 12h10"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function UserAvatar({ email = "", size = 34 }) {
  const initial = (email.trim()[0] || "W").toUpperCase();
  return <span className="uc-avatar" style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) }} aria-hidden="true">{initial}</span>;
}

const formatMetric = (value, suffix = "") => value == null || value === "" ? "—" : `${value}${suffix}`;

function scoreFunds(funds) {
  if (!funds.length) return {};
  const normalize = (values, higherBetter) => {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return values.map(() => null);
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    return values.map(value => {
      if (!Number.isFinite(value)) return null;
      if (max === min) return 50;
      return (higherBetter ? value - min : max - value) / (max - min) * 100;
    });
  };
  const rolling = normalize(funds.map(fund => fund.rolling_1y), true);
  const fee = normalize(funds.map(fund => fund.fee_rate), false);
  const error = normalize(funds.map(fund => fund.track_error), false);
  const scale = normalize(funds.map(fund => fund.scale), true);
  return Object.fromEntries(funds.map((fund, index) => {
    const parts = [[rolling[index], .4], [fee[index], .3], [error[index], .2], [scale[index], .1]].filter(([value]) => value != null);
    const weight = parts.reduce((sum, [, partWeight]) => sum + partWeight, 0);
    const raw = weight ? parts.reduce((sum, [value, partWeight]) => sum + value * partWeight / weight, 0) : 50;
    const subscription = normalizeSubscriptionStatus(fund);
    const bonus = subscription.canSubscribe ? 3 : subscription.isSuspended ? -3 : 0;
    return [fund.code, Math.max(0, Math.min(100, Math.round(raw + bonus)))];
  }));
}

function PasswordDialog({ onClose }) {
  const [form, setForm] = useState({ old: "", next: "", confirm: "", visible: false });
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setMessage(null);
    if (!form.old) return setMessage({ ok: false, text: "请输入当前密码" });
    if (form.next.length < 8) return setMessage({ ok: false, text: "新密码至少需要 8 位" });
    if (form.next !== form.confirm) return setMessage({ ok: false, text: "两次输入的新密码不一致" });
    setLoading(true);
    try {
      const token = localStorage.getItem("wise_token") || "";
      const response = await fetch("/api/auth/change_password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ old_password: form.old, new_password: form.next }),
      });
      const data = await response.json();
      setMessage({ ok: Boolean(data.ok), text: data.msg || (data.ok ? "密码修改成功" : "修改失败，请重试") });
      if (data.ok) window.setTimeout(onClose, 1000);
    } catch {
      setMessage({ ok: false, text: "网络异常，请稍后重试" });
    } finally {
      setLoading(false);
    }
  };
  return <div className="uc-dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="uc-dialog" onSubmit={submit}>
      <button type="button" className="uc-icon-button uc-dialog-close" onClick={onClose} aria-label="关闭"><Icon name="close"/></button>
      <div className="uc-dialog-icon"><Icon name="lock" size={22}/></div>
      <h3>修改登录密码</h3>
      <p>设置新密码后，当前设备仍会保持登录。</p>
      {[['old','当前密码'],['next','新密码'],['confirm','确认新密码']].map(([key, label]) => <label className="uc-field" key={key}>
        <span>{label}</span>
        <input type={form.visible ? "text" : "password"} value={form[key]} onChange={event => { setForm(current => ({ ...current, [key]: event.target.value })); setMessage(null); }} autoComplete={key === 'old' ? 'current-password' : 'new-password'} />
      </label>)}
      <label className="uc-checkbox"><input type="checkbox" checked={form.visible} onChange={event => setForm(current => ({ ...current, visible: event.target.checked }))}/>显示密码</label>
      {message && <div className={`uc-message ${message.ok ? "is-success" : "is-error"}`}>{message.text}</div>}
      <button className="uc-primary-button" disabled={loading}>{loading ? "处理中…" : "确认修改"}</button>
    </form>
  </div>;
}

export default function UserCenter({ user, onClose, onLogout, favorites, allFunds, onToggleFavorite, localPreview = false }) {
  const [active, setActive] = useState("overview");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [compareCodes, setCompareCodes] = useState([]);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = event => event.key === "Escape" && (showPassword ? setShowPassword(false) : onClose());
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose, showPassword]);

  const groupedFunds = useMemo(() => GROUPS.map(group => ({
    ...group,
    funds: (allFunds[group.key] || []).map(fund => ({ ...fund, categoryKey: group.key, categoryLabel: group.label, categoryColor: group.color })),
  })), [allFunds]);
  const all = useMemo(() => groupedFunds.flatMap(group => group.funds), [groupedFunds]);
  const saved = useMemo(() => all.filter(fund => favorites.includes(fund.code)), [all, favorites]);
  const visible = useMemo(() => saved.filter(fund => {
    const categoryMatch = filter === "all" || fund.categoryKey === filter;
    const keyword = query.trim().toLowerCase();
    return categoryMatch && (!keyword || `${fund.name || ""} ${fund.code || ""}`.toLowerCase().includes(keyword));
  }), [saved, filter, query]);
  const compareFunds = compareCodes.map(code => all.find(fund => fund.code === code)).filter(Boolean);
  const scores = scoreFunds(compareFunds);
  const availableCount = saved.filter(fund => normalizeSubscriptionStatus(fund).canSubscribe).length;
  const etfCount = saved.filter(fund => fund.categoryKey === "etfs").length;

  const toggleCompare = code => {
    setCompareCodes(current => current.includes(code) ? current.filter(item => item !== code) : current.length < 4 ? [...current, code] : current);
  };
  const removeFavorite = code => {
    onToggleFavorite?.(code);
    setCompareCodes(current => current.filter(item => item !== code));
  };

  const goToFavorites = () => { setActive("favorites"); setFilter("all"); };

  return <div className="uc-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="uc-shell" role="dialog" aria-modal="true" aria-label="个人中心">
      <aside className="uc-sidebar">
        <div className="uc-brand"><span>WISE</span> ETF</div>
        <div className="uc-profile-compact">
          <UserAvatar email={user.email} size={48}/>
          <div><strong>{user.email?.split("@")[0] || "Wise 用户"}</strong><span>{user.email}</span></div>
        </div>
        <nav className="uc-nav" aria-label="个人中心导航">
          {NAV_ITEMS.map(item => <button key={item.key} className={active === item.key ? "is-active" : ""} onClick={() => setActive(item.key)}><Icon name={item.icon}/><span>{item.label}</span>{item.key === "favorites" && favorites.length > 0 && <em>{favorites.length}</em>}{item.key === "compare" && compareCodes.length > 0 && <em>{compareCodes.length}</em>}</button>)}
        </nav>
        <button className="uc-sidebar-logout" onClick={localPreview ? onClose : onLogout}><Icon name="logout"/>{localPreview ? "关闭个人中心" : "退出登录"}</button>
      </aside>

      <main className="uc-main">
        <header className="uc-mobile-header"><div className="uc-brand"><span>WISE</span> ETF</div><button className="uc-icon-button" onClick={onClose} aria-label="关闭"><Icon name="close"/></button></header>
        <div className="uc-mobile-nav">{NAV_ITEMS.map(item => <button key={item.key} className={active === item.key ? "is-active" : ""} onClick={() => setActive(item.key)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</div>
        <button className="uc-desktop-close uc-icon-button" onClick={onClose} aria-label="关闭"><Icon name="close"/></button>

        <div className="uc-content">
          {active === "overview" && <>
            <div className="uc-page-heading"><div><span className="uc-eyebrow">PERSONAL CENTER</span><h2>你好，{user.email?.split("@")[0] || "Wise 用户"}</h2><p>在这里集中管理关注的产品和账号设置。</p></div><UserAvatar email={user.email} size={58}/></div>
            <div className="uc-stat-grid">
              <button onClick={goToFavorites}><span>已收藏产品</span><strong>{saved.length}</strong><small>集中查看关注标的</small></button>
              <button onClick={() => { setFilter("etfs"); setActive("favorites"); }}><span>场内 ETF</span><strong>{etfCount}</strong><small>重点关注每日溢价</small></button>
              <button onClick={goToFavorites}><span>当前可申购</span><strong>{availableCount}</strong><small>以最新额度状态为准</small></button>
            </div>
            <section className="uc-panel">
              <div className="uc-section-title"><div><h3>收藏分布</h3><p>按产品类型快速定位你的关注范围</p></div><button onClick={goToFavorites}>管理收藏</button></div>
              {saved.length ? <div className="uc-distribution">{groupedFunds.map(group => {
                const count = group.funds.filter(fund => favorites.includes(fund.code)).length;
                return <button key={group.key} onClick={() => { setFilter(group.key); setActive("favorites"); }}><span className="uc-color-dot" style={{ background: group.color }}/><div><strong>{group.label}</strong><small>{count} 只产品</small></div><em>{saved.length ? Math.round(count / saved.length * 100) : 0}%</em></button>;
              })}</div> : <EmptyFavorites onAction={onClose}/>}
            </section>
            {saved.length > 0 && <section className="uc-panel"><div className="uc-section-title"><div><h3>我的重点关注</h3><p>最近收藏的产品会显示在这里</p></div></div><div className="uc-quick-list">{saved.slice(-4).reverse().map(fund => <FavoriteRow key={fund.code} fund={fund} inCompare={compareCodes.includes(fund.code)} onCompare={toggleCompare} onRemove={removeFavorite}/>)}</div></section>}
          </>}

          {active === "favorites" && <>
            <div className="uc-page-heading"><div><span className="uc-eyebrow">WATCHLIST</span><h2>我的收藏</h2><p>搜索、筛选并管理你持续关注的产品。</p></div><span className="uc-heading-count">{saved.length} 只</span></div>
            <div className="uc-favorite-tools"><label><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索基金名称或代码"/></label><div>{[{key:"all",label:"全部"}, ...GROUPS].map(item => <button key={item.key} className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div></div>
            {visible.length ? <div className="uc-favorite-list">{visible.map(fund => <FavoriteRow key={fund.code} fund={fund} inCompare={compareCodes.includes(fund.code)} onCompare={toggleCompare} onRemove={removeFavorite}/>)}</div> : saved.length ? <div className="uc-empty"><div>没有找到匹配的收藏</div><p>换一个关键词或分类试试。</p></div> : <EmptyFavorites onAction={onClose}/>}
          </>}

          {active === "compare" && <ComparePanel funds={compareFunds} scores={scores} saved={saved} compareCodes={compareCodes} onToggle={toggleCompare}/>}

          {active === "security" && <>
            <div className="uc-page-heading"><div><span className="uc-eyebrow">ACCOUNT</span><h2>账号安全</h2><p>管理登录信息与当前账号状态。</p></div><div className="uc-safe-badge"><Icon name="shield"/>{localPreview ? "本地预览" : "状态正常"}</div></div>
            <section className="uc-panel uc-account-card">
              <div><span>登录邮箱</span><strong>{user.email}</strong><small>该邮箱是当前账号的唯一登录标识</small></div>
              <div><span>登录密码</span><strong>{localPreview ? "预览模式不可用" : "已设置"}</strong>{!localPreview && <button onClick={() => setShowPassword(true)}>修改密码</button>}</div>
              <div><span>会话状态</span><strong>{localPreview ? "仅本机开发预览" : "当前设备已登录"}</strong><small>{localPreview ? "未创建账号，也不会写入登录凭证" : "请勿在公共设备上保持登录"}</small></div>
            </section>
            <section className="uc-security-tip"><div><Icon name="shield" size={22}/></div><p><strong>账号安全建议</strong><span>使用与其他网站不同的密码，并避免将登录信息分享给他人。目前暂不提供邮箱验证码和找回密码功能，请妥善保存密码。</span></p></section>
            <button className="uc-logout-button" onClick={localPreview ? onClose : onLogout}><Icon name="logout"/>{localPreview ? "关闭个人中心" : "退出当前账号"}</button>
          </>}
        </div>
      </main>
    </section>
    {showPassword && <PasswordDialog onClose={() => setShowPassword(false)}/>}
  </div>;
}

function EmptyFavorites({ onAction }) {
  return <div className="uc-empty uc-empty-favorites"><span><Icon name="star" size={26}/></span><div>还没有收藏产品</div><p>返回产品列表，点击星标即可加入收藏。</p><button onClick={onAction}>去浏览产品</button></div>;
}

function FavoriteRow({ fund, inCompare, onCompare, onRemove }) {
  const status = normalizeSubscriptionStatus(fund);
  const isEtf = fund.categoryKey === "etfs";
  return <article className="uc-favorite-row">
    <div className="uc-favorite-identity"><span className="uc-color-dot" style={{ background: fund.categoryColor }}/><div><strong>{fund.name}</strong><span>{fund.code} · {fund.categoryLabel}</span></div></div>
    <div className="uc-favorite-metrics"><div><span>近 1 年</span><strong className={fund.rolling_1y == null ? "" : fund.rolling_1y >= 0 ? "is-up" : "is-down"}>{fund.rolling_1y == null ? "—" : `${fund.rolling_1y >= 0 ? "+" : ""}${fund.rolling_1y.toFixed(2)}%`}</strong></div><div><span>{isEtf ? "溢价率" : "申购状态"}</span><strong>{isEtf ? formatMetric(fund.premium, "%") : status.label}</strong></div><div><span>费率</span><strong>{formatMetric(fund.fee_rate, "%")}</strong></div></div>
    <div className="uc-favorite-actions"><button className={inCompare ? "is-selected" : ""} onClick={() => onCompare(fund.code)} title={inCompare ? "移出对比" : "加入对比"}>{inCompare ? <Icon name="check"/> : <Icon name="plus"/>}<span>{inCompare ? "已选" : "对比"}</span></button><button className="is-remove" onClick={() => onRemove(fund.code)} title="取消收藏"><Icon name="trash"/></button></div>
  </article>;
}

function ComparePanel({ funds, scores, saved, compareCodes, onToggle }) {
  const metrics = [
    ["近 1 年滚动", "rolling_1y", value => formatMetric(value, "%")],
    ["年化费率", "fee_rate", value => formatMetric(value, "%")],
    ["跟踪误差", "track_error", value => formatMetric(value, "%")],
    ["基金规模", "scale", value => formatMetric(value, " 亿")],
  ];
  return <>
    <div className="uc-page-heading"><div><span className="uc-eyebrow">COMPARE</span><h2>产品对比</h2><p>从收藏中选择 2–4 只产品进行横向比较。</p></div><span className="uc-heading-count">{compareCodes.length}/4</span></div>
    <section className="uc-panel uc-compare-picker"><div className="uc-section-title"><div><h3>选择对比产品</h3><p>点击产品即可加入或移出对比</p></div></div>{saved.length ? <div>{saved.map(fund => <button key={fund.code} className={compareCodes.includes(fund.code) ? "is-selected" : ""} onClick={() => onToggle(fund.code)}><span>{fund.code}</span>{fund.name}<Icon name={compareCodes.includes(fund.code) ? "check" : "plus"}/></button>)}</div> : <p className="uc-inline-empty">请先在产品列表中添加收藏。</p>}</section>
    {funds.length < 2 ? <div className="uc-empty"><span className="uc-compare-empty-icon"><Icon name="compare" size={28}/></span><div>至少选择 2 只产品</div><p>对比会展示收益、费率、跟踪误差和规模等核心指标。</p></div> : <>
      <div className="uc-score-grid">{funds.map(fund => <div key={fund.code}><span>综合参考分</span><strong>{scores[fund.code] ?? 50}</strong><p>{fund.name}</p><small>{fund.code}</small></div>)}</div>
      <div className="uc-compare-table-wrap"><table><thead><tr><th>指标</th>{funds.map(fund => <th key={fund.code}>{fund.code}</th>)}</tr></thead><tbody>{metrics.map(([label,key,format]) => <tr key={key}><td>{label}</td>{funds.map(fund => <td key={fund.code}>{format(fund[key])}</td>)}</tr>)}<tr><td>申购 / 溢价</td>{funds.map(fund => <td key={fund.code}>{fund.categoryKey === "etfs" ? formatMetric(fund.premium, "%") : normalizeSubscriptionStatus(fund).label}</td>)}</tr></tbody></table></div>
      <p className="uc-compare-note">综合参考分按近 1 年滚动收益、费率、跟踪误差和规模进行同组归一化，仅用于产品筛选参考，不构成投资建议。</p>
    </>}
  </>;
}
