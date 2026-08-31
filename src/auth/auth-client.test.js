import assert from "node:assert/strict";
import test from "node:test";

import { authErrorMessage, membershipLabel, normalizeAuthSession, wiseLoginUrl } from "./auth-client.js";

test("Wise ID login keeps the requested local route", () => {
  assert.equal(
    wiseLoginUrl("/qdii?code=017436#detail"),
    "/api/auth/login/wise?return_to=%2Fqdii%3Fcode%3D017436%23detail",
  );
});

test("session response is normalized into the frontend user model", () => {
  assert.deepEqual(normalizeAuthSession({
    ok: true,
    authenticated: true,
    user: {
      wise_user_id: "wise-123",
      email: "user@example.com",
      email_verified: true,
      name: "测试用户",
      membership_tier: "VIP_PLUS",
    },
  }), {
    wiseUserId: "wise-123",
    email: "user@example.com",
    emailVerified: true,
    name: "测试用户",
    picture: null,
    membershipTier: "VIP_PLUS",
    membershipLabel: "Wise SVIP",
  });
});

test("anonymous or malformed session is rejected", () => {
  assert.equal(normalizeAuthSession({ ok: true, authenticated: false, user: null }), null);
  assert.equal(normalizeAuthSession({ ok: true, authenticated: true, user: { email: "user@example.com" } }), null);
});

test("unknown membership does not gain paid access labels", () => {
  assert.equal(membershipLabel("unexpected"), "普通用户");
});

test("callback failures explain the failing SSO stage", () => {
  assert.match(authErrorMessage("client_configuration"), /客户端配置/);
  assert.match(authErrorMessage("profile_incomplete"), /账号资料不完整/);
  assert.match(authErrorMessage("session_unavailable"), /登录会话/);
});
