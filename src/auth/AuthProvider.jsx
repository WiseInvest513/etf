import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  consumeAuthError,
  currentReturnTo,
  normalizeAuthSession,
  wiseLoginUrl,
} from "./auth-client.js";

const AuthContext = createContext(null);

const LOCAL_PREVIEW_USER = Object.freeze({
  wiseUserId: "local-preview",
  email: "local-preview@wise-etf.local",
  emailVerified: true,
  name: "本地预览用户",
  picture: null,
  membershipTier: "MEMBER",
  membershipLabel: "普通用户",
  isVip: false,
  isSvip: false,
  isLocalPreview: true,
});

export function AuthProvider({ children, localBypass = false }) {
  const [sessionUser, setSessionUser] = useState(localBypass ? LOCAL_PREVIEW_USER : null);
  const [loading, setLoading] = useState(!localBypass);
  const [error, setError] = useState(() => consumeAuthError());

  const refresh = useCallback(async () => {
    if (localBypass) {
      setSessionUser(LOCAL_PREVIEW_USER);
      setLoading(false);
      return LOCAL_PREVIEW_USER;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`session_${response.status}`);
      const user = normalizeAuthSession(await response.json());
      setSessionUser(user);
      return user;
    } catch {
      setSessionUser(null);
      setError("暂时无法确认登录状态，请稍后重试。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [localBypass]);

  useEffect(() => {
    // Retire browser-readable legacy credentials. Favorites are deliberately
    // preserved and migrated separately so the SSO cutover loses no user data.
    try {
      localStorage.removeItem("wise_token");
      localStorage.removeItem("wise_email");
    } catch {
      // Storage can be unavailable in private/restricted browser contexts.
    }
    refresh();
  }, [refresh]);

  const login = useCallback((returnTo = currentReturnTo()) => {
    if (localBypass) return;
    window.location.assign(wiseLoginUrl(returnTo));
  }, [localBypass]);

  const logout = useCallback(async () => {
    if (localBypass) return true;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`logout_${response.status}`);
      setSessionUser(null);
      setError(null);
      return true;
    } catch {
      setError("退出登录失败，请稍后重试。");
      return false;
    }
  }, [localBypass]);

  const value = useMemo(() => ({
    user: sessionUser,
    loading,
    error,
    isLocalPreview: Boolean(sessionUser?.isLocalPreview),
    login,
    logout,
    refresh,
    clearError: () => setError(null),
  }), [sessionUser, loading, error, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The provider and hook intentionally share one module so every auth consumer
// uses the exact same context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
