import { useAuth } from "./AuthProvider.jsx";
import { currentReturnTo } from "./auth-client.js";
import "./auth.css";

function WiseMark() {
  return <span className="wise-login-mark" aria-hidden="true">
    <svg width="31" height="31" viewBox="0 0 28 28" fill="none">
      <polyline points="3,20 8,13 13,16 19,7 25,10" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="25" cy="10" r="2" fill="white"/>
    </svg>
  </span>;
}

export default function WiseLoginGate({ children, title = "使用 Wise ID 继续" }) {
  const { user, loading, error, login, clearError } = useAuth();
  if (user) return children;

  return <main className="wise-login-page">
    <section className="wise-login-card" aria-labelledby="wise-login-title">
      <div className="wise-login-brand"><WiseMark/><span>Wise <strong>ETF</strong></span></div>
      <div className="wise-login-badge">WISE ID · UNIFIED ACCOUNT</div>
      <h1 id="wise-login-title">{loading ? "正在确认登录状态" : title}</h1>
      <p>{loading
        ? "正在安全读取当前 Wise ETF 会话，请稍候。"
        : "登录将在 Wise Invest 完成。Wise ETF 不会保存或读取你的登录密码。"}</p>

      {error && <div className="wise-login-error" role="alert">
        <span>{error}</span><button type="button" onClick={clearError}>×</button>
      </div>}

      <button className="wise-login-primary" type="button" disabled={loading} onClick={() => login(currentReturnTo())}>
        {loading ? <><i className="wise-login-spinner"/>确认中…</> : <>使用 Wise ID 登录 <span>→</span></>}
      </button>
      <div className="wise-login-points">
        <span>统一账号</span><span>安全授权</span><span>登录后返回当前页面</span>
      </div>
      <small>登录即代表你同意由 Wise ID 向 Wise ETF 提供昵称、邮箱、头像和会员等级。</small>
    </section>
  </main>;
}
