import assert from "node:assert/strict";
import test from "node:test";
import {
  mainSiteAuthorizationParams,
  sanitizeAttributionPath,
  withMainSiteAttribution,
} from "./main-site-attribution.js";

test("etf attribution helper appends the short site code and a safe path", () => {
  assert.equal(sanitizeAttributionPath("/qdii?code=017436#detail"), "/qdii?code=017436");
  assert.equal(sanitizeAttributionPath("javascript:alert(1)"), "/");
  assert.equal(
    withMainSiteAttribution("https://www.wise-invest.org/", "/qdii"),
    "https://www.wise-invest.org/?utm_source=etf&utm_campaign=%2Fqdii",
  );
  assert.deepEqual(mainSiteAuthorizationParams("/learn/foo"), {
    utm_source: "etf",
    utm_campaign: "/learn/foo",
  });
});
