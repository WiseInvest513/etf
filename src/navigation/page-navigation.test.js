import assert from "node:assert/strict";
import test from "node:test";
import { createPageVisitStore, normalizePagePath, PAGE_NAVIGATION_EVENT } from "./page-navigation.js";

function browserAt(pathname) {
  const target = new EventTarget();
  target.location = { pathname };
  return target;
}

test("paths normalize trailing slashes", () => {
  assert.equal(normalizePagePath("/"), "/");
  assert.equal(normalizePagePath("/learn/etf/"), "/learn/etf");
});

test("each tab change and browser back creates a new visit including revisits", () => {
  const browser = browserAt("/");
  const store = createPageVisitStore(browser);
  const visits = [];
  const unsubscribe = store.subscribe(() => visits.push(store.getSnapshot()));
  browser.location.pathname = "/nasdaq";
  browser.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
  browser.location.pathname = "/sp500";
  browser.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
  browser.location.pathname = "/nasdaq";
  browser.dispatchEvent(new Event("popstate"));
  assert.deepEqual(visits, [
    { pathname:"/nasdaq", visit:1 }, { pathname:"/sp500", visit:2 }, { pathname:"/nasdaq", visit:3 },
  ]);
  unsubscribe();
});

test("same-page filters, hashes and ordinary pageshow do not create a visit", () => {
  const browser = browserAt("/nasdaq");
  const store = createPageVisitStore(browser);
  const initial = store.getSnapshot();
  const unsubscribe = store.subscribe(() => assert.fail("not a new page"));
  browser.location.search = "?sort=fee";
  browser.location.hash = "#table";
  browser.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
  browser.dispatchEvent(new Event("popstate"));
  browser.dispatchEvent(new Event("pageshow"));
  assert.equal(store.getSnapshot(), initial);
  unsubscribe();
});

test("BFCache restoration rechecks login even on the same path", () => {
  const browser = browserAt("/learn/etf");
  const store = createPageVisitStore(browser);
  const unsubscribe = store.subscribe(() => {});
  const restore = new Event("pageshow");
  Object.defineProperty(restore, "persisted", { value:true });
  browser.dispatchEvent(restore);
  assert.deepEqual(store.getSnapshot(), { pathname:"/learn/etf", visit:1 });
  unsubscribe();
});

test("shared listeners unsubscribe cleanly across StrictMode remounts", () => {
  const browser = browserAt("/");
  const store = createPageVisitStore(browser);
  let calls = 0;
  const a = store.subscribe(() => { calls++; });
  const b = store.subscribe(() => { calls++; });
  browser.location.pathname = "/nasdaq";
  browser.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
  assert.equal(calls, 2);
  a(); b();
  browser.location.pathname = "/sp500";
  browser.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
  assert.equal(calls, 2);
  const c = store.subscribe(() => { calls++; });
  assert.equal(calls, 3);
  assert.deepEqual(store.getSnapshot(), { pathname:"/sp500", visit:2 });
  c();
});
