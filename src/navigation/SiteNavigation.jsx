import { useState } from "react";
import { NAV_GROUPS } from "./navigationConfig.js";
import "./site-navigation.css";

const Chevron = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>;
const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-4-4 4 4-4 4"/></svg>;

const groupIsActive = (group, activeTab) => group.tab === activeTab || group.children?.some(item => item.id === activeTab);

export function DesktopNavigation({ activeTab, onNavigate }) {
  const [open, setOpen] = useState(null);
  return <nav className="site-nav" aria-label="主导航" onMouseLeave={() => setOpen(null)}>
    {NAV_GROUPS.map(group => {
      const active = groupIsActive(group, activeTab);
      if (!group.children) return <button key={group.key} type="button" className={`site-nav-direct ${active ? "is-active" : ""} ${group.featured ? "is-featured" : ""}`} onClick={() => { onNavigate(group.tab); setOpen(null); }}>
        {group.label}{group.badge && <em>{group.badge}</em>}
      </button>;
      const expanded = open === group.key;
      return <div key={group.key} className={`site-nav-group ${active ? "is-active" : ""} ${expanded ? "is-open" : ""}`} onMouseEnter={() => setOpen(group.key)}>
        <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : group.key)}>{group.label}<Chevron/></button>
        {expanded && <div className="site-nav-dropdown">{group.children.map(item => item.href
          ? <a key={item.id} href={item.href}><span><strong>{item.label}</strong><small>{item.description}</small></span><Arrow/></a>
          : <button key={item.id} type="button" className={activeTab === item.id ? "is-current" : ""} onClick={() => { onNavigate(item.id); setOpen(null); }}><span><strong>{item.label}</strong><small>{item.description}</small></span><Arrow/></button>
        )}</div>}
      </div>;
    })}
  </nav>;
}

export function MobileNavigation({ activeTab, onNavigate, onClose, onCommunity }) {
  return <div className="site-mobile-nav">
    {NAV_GROUPS.map(group => !group.children
      ? <button key={group.key} type="button" className={`${activeTab === group.tab ? "is-active" : ""} ${group.featured ? "is-featured" : ""}`} onClick={() => { onNavigate(group.tab); onClose(); }}><span>{group.label}{group.badge && <em>{group.badge}</em>}</span><Arrow/></button>
      : <section key={group.key}><h3>{group.label}</h3>{group.children.map(item => item.href
        ? <a key={item.id} href={item.href}><span><strong>{item.label}</strong><small>{item.description}</small></span><Arrow/></a>
        : <button key={item.id} type="button" className={activeTab === item.id ? "is-active" : ""} onClick={() => { onNavigate(item.id); onClose(); }}><span><strong>{item.label}</strong><small>{item.description}</small></span><Arrow/></button>)}</section>)}
    <button type="button" className="site-mobile-community" onClick={() => { onCommunity(); onClose(); }}>💬 <span>加入群聊</span></button>
  </div>;
}
