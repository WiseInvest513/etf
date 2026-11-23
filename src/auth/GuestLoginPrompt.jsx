import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { pageVisits } from "../navigation/page-navigation.js";
import { useAuth } from "./AuthProvider.jsx";
import { currentReturnTo } from "./auth-client.js";
import { shouldShowLoginPrompt } from "./login-prompt-policy.js";
import { WiseMark } from "./WiseLoginGate.jsx";
import "./auth.css";

function hasOtherDialog() {
  if (document.querySelector('dialog[open]:not([data-wise-login-prompt]), [role="dialog"][aria-modal="true"]:not([data-wise-login-prompt])')) return true;
  return [...document.querySelectorAll("wise-community-popup, wise-kraken-popup")]
    .some(host => host.shadowRoot?.querySelector("dialog[open]"));
}

function LoginDialog({ onDismiss }) {
  const { login, error } = useAuth();
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    dialog.showModal();
    document.documentElement.style.overflow = "hidden";
    dialog.querySelector("h2").focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.documentElement.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className="wise-guest-dialog" data-wise-login-prompt
      aria-labelledby="wise-guest-title" aria-describedby="wise-guest-description"
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onClose={event => { if (!event.currentTarget.open) onDismiss(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onDismiss();
      }}>
      <div className="wise-guest-content">
        <button className="wise-login-close" type="button" onClick={onDismiss} aria-label="关闭登录提示">×</button>
        <div className="wise-login-brand"><WiseMark/><span>Wise <strong>ETF</strong></span></div>
        <div className="wise-login-badge">WISE ID · 统一账号</div>
        <h2 id="wise-guest-title" tabIndex={-1}>登录 Wise ETF</h2>
        <p id="wise-guest-description">使用主站 Wise ID 登录，继续探索基金与估值工具。没有账号？可在主站注册，授权后自动返回当前页面。</p>
        {error && <p className="wise-guest-note" role="status">{error} 你也可以关闭提示继续浏览。</p>}
        <button className="wise-login-primary" type="button" onClick={() => login(currentReturnTo())}>去登录 / 注册 <span aria-hidden="true">→</span></button>
        <button className="wise-guest-dismiss" type="button" onClick={onDismiss}>暂不登录，继续浏览</button>
        <div className="wise-login-points"><span>统一账号</span><span>安全授权</span><span>返回当前页面</span></div>
        <small>登录与注册将在 Wise Invest 完成。Wise ETF 不会读取或保存你的登录密码。</small>
      </div>
    </dialog>, document.body,
  );
}

function VisitPrompt({ pathname }) {
  const { user, loading } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [blocked, setBlocked] = useState(true);
  const eligible = shouldShowLoginPrompt({ pathname, loading, user, dismissed });

  useEffect(() => {
    if (!eligible) return;
    const sync = () => setBlocked(hasOtherDialog());
    // Queue behind risk notices and existing community/campaign dialogs rather
    // than stacking multiple overlays on a first-time visitor.
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-modal"] });
    const events = ["wise-community:opening", "wise-community:closed", "wise-campaign:closed"];
    events.forEach(type => window.addEventListener(type, sync));
    sync();
    return () => {
      observer.disconnect();
      events.forEach(type => window.removeEventListener(type, sync));
    };
  }, [eligible]);

  if (!eligible || blocked) return null;
  return <LoginDialog onDismiss={() => setDismissed(true)}/>;
}

export default function GuestLoginPrompt() {
  const { pathname, visit } = useSyncExternalStore(pageVisits.subscribe, pageVisits.getSnapshot);
  return <VisitPrompt key={visit} pathname={pathname}/>;
}
