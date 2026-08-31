export const MEMBERSHIP_LABELS = Object.freeze({
  MEMBER: "普通用户",
  VIP: "Wise VIP",
  VIP_PLUS: "Wise SVIP",
});

export function membershipLabel(tier) {
  return MEMBERSHIP_LABELS[String(tier || "MEMBER").toUpperCase()] || MEMBERSHIP_LABELS.MEMBER;
}

export function currentReturnTo(locationLike = window.location) {
  const pathname = locationLike?.pathname || "/";
  const search = locationLike?.search || "";
  const hash = locationLike?.hash || "";
  return `${pathname}${search}${hash}`;
}

export function wiseLoginUrl(returnTo = currentReturnTo()) {
  return `/api/auth/login/wise?return_to=${encodeURIComponent(returnTo || "/")}`;
}

export function normalizeAuthSession(payload) {
  if (!payload || payload.ok !== true || payload.authenticated !== true || !payload.user) {
    return null;
  }
  const user = payload.user;
  if (!user.wise_user_id || !user.email) return null;
  return {
    wiseUserId: String(user.wise_user_id),
    email: String(user.email),
    emailVerified: user.email_verified === true,
    name: String(user.name || user.email),
    picture: user.picture || null,
    membershipTier: String(user.membership_tier || "MEMBER").toUpperCase(),
    membershipLabel: user.membership_label || membershipLabel(user.membership_tier),
  };
}

export function consumeAuthError(locationLike = window.location, historyLike = window.history) {
  const url = new URL(locationLike.href);
  const code = url.searchParams.get("auth_error");
  if (!code) return null;
  url.searchParams.delete("auth_error");
  historyLike.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return code === "authorization_failed"
    ? "Wise ID 授权未完成，请重新登录。"
    : "Wise ID 登录暂时失败，请稍后重试。";
}
