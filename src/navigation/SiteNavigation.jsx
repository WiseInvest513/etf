import { NAV_GROUPS, VIP_JOIN_URL } from "./navigationConfig.js";
import "./site-navigation.css";

const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-4-4 4 4-4 4"/></svg>;

export function DesktopNavigation({ activeTab, onNavigate }) {
  return <nav className="site-nav" aria-label="主导航">
    {NAV_GROUPS.map(item => item.href
      ? <a key={item.key} href={item.href} className={`site-nav-direct ${item.featured ? "is-featured" : ""}`}>
          {item.label}{item.badge && <em>{item.badge}</em>}
        </a>
      : <button key={item.key} type="button" className={`site-nav-direct ${activeTab === item.tab ? "is-active" : ""} ${item.featured ? "is-featured" : ""}`} onClick={() => onNavigate(item.tab)}>
          {item.label}{item.badge && <em>{item.badge}</em>}
        </button>
    )}
  </nav>;
}

export function MobileNavigation({ activeTab, onNavigate, onClose, onCommunity }) {
  const navigate = tab => {
    onClose();
    onNavigate(tab);
  };

  return <div id="site-mobile-menu" className="site-mobile-nav" role="navigation" aria-label="移动端主导航">
    {NAV_GROUPS.map(item => item.href
      ? <a key={item.key} href={item.href} onClick={onClose}><span>{item.label}{item.badge && <em>{item.badge}</em>}</span><Arrow/></a>
      : <button key={item.key} type="button" className={`${activeTab === item.tab ? "is-active" : ""} ${item.featured ? "is-featured" : ""}`} onClick={() => navigate(item.tab)}><span>{item.label}{item.badge && <em>{item.badge}</em>}</span><Arrow/></button>)}
    <a className="site-mobile-vip" href={VIP_JOIN_URL} onClick={onClose}>
      <span><b aria-hidden="true">✦</b> 加入 VIP</span><Arrow/>
    </a>
    <button type="button" className="site-mobile-community" onClick={() => { onClose(); onCommunity(); }}>💬 <span>加入群聊</span></button>
  </div>;
}
