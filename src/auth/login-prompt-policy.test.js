import assert from "node:assert/strict";
import test from "node:test";
import { isLoginPromptPage, shouldShowLoginPrompt } from "./login-prompt-policy.js";

test("all public entry pages share the optional login prompt", () => {
  for (const pathname of ["/", "/nasdaq", "/sp500", "/learn/etf", "/learn/etf/articles/what-is-etf", "/fund/019441", "/etf/513100", "/today/qdii-limits", "/today/etf-premium", "/chooser", "/lazy"]) {
    assert.equal(isLoginPromptPage(pathname), true, pathname);
    assert.equal(shouldShowLoginPrompt({ pathname, loading:false, user:null, dismissed:false }), true, pathname);
  }
});

test("loading, signed-in and dismissed states never prompt", () => {
  const visit = { pathname:"/nasdaq", loading:false, user:null, dismissed:false };
  assert.equal(shouldShowLoginPrompt({ ...visit, loading:true }), false);
  assert.equal(shouldShowLoginPrompt({ ...visit, user:{ membershipTier:"MEMBER" } }), false);
  assert.equal(shouldShowLoginPrompt({ ...visit, user:{ membershipTier:"VIP" } }), false);
  assert.equal(shouldShowLoginPrompt({ ...visit, dismissed:true }), false);
});

test("existing hard login/admin/API routes and unknown pages are unchanged", () => {
  for (const pathname of ["/login", "/qdii", "/admin", "/api/auth/callback/wise", "/missing", "/fund/not-a-code"]) {
    assert.equal(isLoginPromptPage(pathname), false, pathname);
  }
});

test("dismissal belongs to one visit, not to a stored browser-wide exemption", () => {
  assert.equal(shouldShowLoginPrompt({ pathname:"/nasdaq", dismissed:true }), false);
  assert.equal(shouldShowLoginPrompt({ pathname:"/sp500", dismissed:false }), true);
  assert.equal(shouldShowLoginPrompt({ pathname:"/nasdaq", dismissed:false }), true);
});
