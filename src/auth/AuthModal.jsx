import { useEffect, useMemo, useRef, useState } from "react";

import "./auth.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PRODUCT_POINTS = [
  { icon: "↗", title: "申购额度追踪", text: "及时查看开放、限额与暂停状态" },
  { icon: "%", title: "ETF 溢价监控", text: "关注每日收盘溢价与历史变化" },
  { icon: "◎", title: "自选与估值", text: "集中管理关注产品和 QDII 估值" },
];

function PasswordVisibilityIcon({ show }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {show ? (
        <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
      ) : (
        <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
      )}
    </svg>
  );
}

function WiseLogo() {
  return (
    <div className="auth-brand-logo" aria-label="Wise ETF">
      <span className="auth-brand-mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <polyline points="3,20 8,13 13,16 19,7 25,10" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="25" cy="10" r="2" fill="white" />
        </svg>
      </span>
      <span>Wise <strong>ETF</strong></span>
    </div>
  );
}

function passwordChecks(password) {
  return [
    { key: "length", label: "至少 8 位", ok: password.length >= 8 },
    { key: "upper", label: "大写字母", ok: /[A-Z]/.test(password) },
    { key: "lower", label: "小写字母", ok: /[a-z]/.test(password) },
    { key: "number", label: "数字", ok: /[0-9]/.test(password) },
  ];
}

function PasswordStrength({ password }) {
  const checks = useMemo(() => passwordChecks(password), [password]);
  const passed = checks.filter(item => item.ok).length;
  const label = passed <= 1 ? "较弱" : passed <= 3 ? "中等" : "较强";

  return (
    <div className="auth-strength" aria-live="polite">
      <div className="auth-strength-head">
        <span>密码强度</span>
        <strong data-level={passed}>{password ? label : "待输入"}</strong>
      </div>
      <div className="auth-strength-bars" aria-hidden="true">
        {[1, 2, 3, 4].map(level => <span key={level} className={passed >= level ? "is-active" : ""} data-level={passed} />)}
      </div>
      <div className="auth-checks">
        {checks.map(item => (
          <span key={item.key} className={item.ok ? "is-ok" : ""}>
            <i aria-hidden="true">{item.ok ? "✓" : "·"}</i>{item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AuthModal({ onClose, onLogin, authRequired = false }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const emailRef = useRef(null);
  const completionTimerRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    emailRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === "Escape" && !authRequired) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    };
  }, [authRequired, onClose]);

  const switchMode = nextMode => {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setEmailConfirmed(false);
    setError("");
    setCompleted(false);
    requestAnimationFrame(() => emailRef.current?.focus());
  };

  const validate = () => {
    if (!EMAIL_RE.test(email.trim())) return "请输入正确的邮箱地址";
    if (!password) return "请输入密码";
    if (mode === "register") {
      const failedRule = passwordChecks(password).find(item => !item.ok);
      if (failedRule) return `密码需要满足：${failedRule.label}`;
      if (password !== confirmPassword) return "两次输入的密码不一致";
      if (!emailConfirmed) return "请确认邮箱填写无误";
    }
    return null;
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (loading) return;
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.msg || (typeof data.detail === "string" ? data.detail : "操作失败，请稍后再试"));
        return;
      }

      localStorage.setItem("wise_token", data.token);
      localStorage.setItem("wise_email", data.email);
      if (mode === "register") {
        setCompleted(true);
        completionTimerRef.current = window.setTimeout(() => onLogin({ token: data.token, email: data.email }), 700);
      } else {
        onLogin({ token: data.token, email: data.email });
      }
    } catch {
      setError("网络连接异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onMouseDown={event => {
      if (!authRequired && event.target === event.currentTarget) onClose();
    }}>
      <div className={`auth-dialog auth-dialog-${mode}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <section className="auth-brand-panel">
          <WiseLogo />
          <div className="auth-brand-copy">
            <div className="auth-eyebrow">SMART ETF WORKSPACE</div>
            <h2>把关注的基金数据，<br/>放在一个地方。</h2>
            <p>登录后保存自选、对比产品，并持续跟踪申购额度、ETF 溢价与 QDII 估值。</p>
          </div>
          <div className="auth-product-points">
            {PRODUCT_POINTS.map(item => (
              <div key={item.title} className="auth-product-point">
                <span aria-hidden="true">{item.icon}</span>
                <div><strong>{item.title}</strong><small>{item.text}</small></div>
              </div>
            ))}
          </div>
          <div className="auth-brand-foot">数据持续更新 · 登录信息仅用于 Wise ETF</div>
        </section>

        <section className="auth-form-panel">
          {!authRequired && (
            <button className="auth-close" type="button" onClick={onClose} aria-label="关闭登录窗口">×</button>
          )}

          {completed ? (
            <div className="auth-complete" role="status">
              <span aria-hidden="true">✓</span>
              <h1 id="auth-title">账号创建成功</h1>
              <p>正在为你进入 Wise ETF…</p>
            </div>
          ) : (
            <>
              <div className="auth-mobile-brand"><WiseLogo /></div>
              <div className="auth-form-heading">
                <div className="auth-kicker">{authRequired ? "此功能需要登录" : "WISE ETF ACCOUNT"}</div>
                <h1 id="auth-title">{mode === "login" ? "欢迎回来" : "创建你的账号"}</h1>
                <p>{mode === "login" ? "继续管理你的自选与数据工具。" : "无需邮箱验证码，填写完成即可创建。"}</p>
              </div>

              {authRequired && <div className="auth-required-note">登录后即可继续访问当前功能</div>}

              <div className="auth-tabs" role="tablist" aria-label="登录或注册">
                <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => switchMode("login")}>登录</button>
                <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => switchMode("register")}>注册</button>
              </div>

              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                <label className="auth-field">
                  <span>邮箱</span>
                  <input ref={emailRef} type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} placeholder="name@example.com" autoComplete="email" inputMode="email" />
                </label>

                <label className="auth-field">
                  <span>密码</span>
                  <div className="auth-password-wrap">
                    <input type={showPassword ? "text" : "password"} value={password} onChange={event => { setPassword(event.target.value); setError(""); }} placeholder={mode === "login" ? "请输入密码" : "设置一个安全密码"} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                    <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}><PasswordVisibilityIcon show={showPassword} /></button>
                  </div>
                </label>

                {mode === "register" && (
                  <>
                    <PasswordStrength password={password} />
                    <label className="auth-field">
                      <span>确认密码</span>
                      <div className="auth-password-wrap">
                        <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={event => { setConfirmPassword(event.target.value); setError(""); }} placeholder="再次输入密码" autoComplete="new-password" />
                        <button type="button" onClick={() => setShowConfirmPassword(value => !value)} aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"}><PasswordVisibilityIcon show={showConfirmPassword} /></button>
                      </div>
                    </label>
                    <label className="auth-email-confirm">
                      <input type="checkbox" checked={emailConfirmed} onChange={event => { setEmailConfirmed(event.target.checked); setError(""); }} />
                      <span>
                        <strong>确认邮箱填写无误</strong>
                        <small>当前不发送验证邮件，邮箱将作为登录账号。</small>
                      </span>
                    </label>
                  </>
                )}

                {error && <div className="auth-error" role="alert">{error}</div>}

                <button className="auth-submit" type="submit" disabled={loading}>
                  {loading ? <><i className="auth-spinner" aria-hidden="true"/>处理中…</> : (mode === "login" ? "登录 Wise ETF" : "创建账号")}
                </button>

                <div className="auth-session-note">
                  {mode === "login" ? "登录状态最长保留 30 天" : "创建账号后将自动登录"}
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
