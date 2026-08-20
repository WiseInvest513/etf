import test from "node:test";
import assert from "node:assert/strict";

import {
  DATASET_STATE,
  deriveDatasetState,
  finiteAverage,
  formatPercent,
  normalizeApiEnvelope,
  normalizeObjectDataset,
  normalizeSubscriptionStatus,
  nullLastComparator,
  premiumDisplayModel,
  resolveLocalAuthBypass,
  shouldRequireAuth,
} from "./model.js";

test("local auth bypass requires dev mode, an exact opt-in, and loopback", () => {
  for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(resolveLocalAuthBypass({ isDev: true, flag: "true", hostname }), true);
  }
  assert.equal(resolveLocalAuthBypass({ isDev: false, flag: "true", hostname: "127.0.0.1" }), false);
  assert.equal(resolveLocalAuthBypass({ isDev: true, flag: "TRUE", hostname: "127.0.0.1" }), false);
  assert.equal(resolveLocalAuthBypass({ isDev: true, flag: "1", hostname: "127.0.0.1" }), false);
  assert.equal(resolveLocalAuthBypass({ isDev: true, flag: "true", hostname: "192.168.1.20" }), false);
});

test("protected content skips the login gate only for a real user or local bypass", () => {
  assert.equal(shouldRequireAuth({ isProtected: true }), true);
  assert.equal(shouldRequireAuth({ isProtected: true, hasUser: true }), false);
  assert.equal(shouldRequireAuth({ isProtected: true, localBypass: true }), false);
  assert.equal(shouldRequireAuth({ isProtected: false }), false);
});

test("normalizeObjectDataset rejects empty objects and preserves partial metadata", () => {
  const empty = normalizeObjectDataset(
    { data: {}, status: "empty", source: "empty" },
    { fields: ["vix", "ndx_price"] },
  );
  assert.equal(empty.status, DATASET_STATE.EMPTY);
  assert.equal(empty.data, null);

  const partial = normalizeObjectDataset(
    { data: { vix: { value: 18.2 }, ndx_price: {} }, status: "partial", source: "partial", as_of: "2026-08-20" },
    { fields: ["vix", "ndx_price"] },
  );
  assert.equal(partial.status, DATASET_STATE.PARTIAL);
  assert.equal(partial.meaningfulFieldCount, 1);
  assert.equal(partial.source, "partial");
  assert.equal(partial.asOf, "2026-08-20");
});

test("deriveDatasetState covers loading, empty, and fatal error without data", () => {
  assert.equal(deriveDatasetState({ loading: true, data: [] }), DATASET_STATE.LOADING);
  assert.equal(deriveDatasetState({ data: [] }), DATASET_STATE.EMPTY);
  assert.equal(deriveDatasetState({ data: [], error: new Error("offline") }), DATASET_STATE.ERROR);
});

test("deriveDatasetState preserves retained data as fresh, stale, or partial", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");
  assert.equal(
    deriveDatasetState({ data: [1], asOf: now - 1_000, staleAfterMs: 10_000, now }),
    DATASET_STATE.FRESH,
  );
  assert.equal(
    deriveDatasetState({ data: [1], asOf: now - 20_000, staleAfterMs: 10_000, now }),
    DATASET_STATE.STALE,
  );
  assert.equal(
    deriveDatasetState({ data: [1], staleAfterMs: 10_000, now }),
    DATASET_STATE.STALE,
  );
  assert.equal(
    deriveDatasetState({ data: [1], error: "refresh failed", loading: true }),
    DATASET_STATE.PARTIAL,
  );
  assert.equal(
    deriveDatasetState({ data: [1], partial: true }),
    DATASET_STATE.PARTIAL,
  );
});

test("normalizeApiEnvelope accepts legacy, v2, raw, and failed payloads", () => {
  assert.deepEqual(normalizeApiEnvelope([1, 2]), {
    ok: true,
    data: [1, 2],
    count: 2,
    source: "raw",
    partial: false,
    error: null,
    asOf: null,
    runId: null,
    schemaVersion: null,
  });

  assert.deepEqual(
    normalizeApiEnvelope({
      data: [{ code: "019524" }],
      count: 1,
      source: "partial",
      as_of: "2026-08-20T10:00:00Z",
      run_id: "run-7",
      schema_version: 2,
    }),
    {
      ok: true,
      data: [{ code: "019524" }],
      count: 1,
      source: "partial",
      partial: true,
      error: null,
      asOf: "2026-08-20T10:00:00Z",
      runId: "run-7",
      schemaVersion: 2,
    },
  );

  const failure = normalizeApiEnvelope({ ok: false, msg: "denied" });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, "denied");
  assert.deepEqual(failure.data, []);

  const emptyResponse = normalizeApiEnvelope(null);
  assert.equal(emptyResponse.ok, false);
  assert.equal(emptyResponse.error, "empty_response");
  assert.deepEqual(emptyResponse.data, []);
});

test("finiteAverage ignores non-finite and non-numeric samples and reports counts", () => {
  assert.deepEqual(finiteAverage([1, 2, null, "3", NaN, Infinity, -Infinity, 5]), {
    average: 8 / 3,
    sampleCount: 3,
    totalCount: 8,
    missingCount: 5,
  });

  assert.deepEqual(finiteAverage([{ value: 2 }, { value: null }, { value: 4 }], "value"), {
    average: 3,
    sampleCount: 2,
    totalCount: 3,
    missingCount: 1,
  });

  assert.deepEqual(finiteAverage([null, NaN]), {
    average: null,
    sampleCount: 0,
    totalCount: 2,
    missingCount: 2,
  });
});

test("formatPercent handles signs without ever producing '+-'", () => {
  assert.equal(formatPercent(1.234), "+1.23%");
  assert.equal(formatPercent(-1.234), "-1.23%");
  assert.equal(formatPercent("-1.2%", { digits: 1 }), "-1.2%");
  assert.equal(formatPercent(-0), "0.00%");
  assert.equal(formatPercent(1.2, { showPlus: false, digits: 1 }), "1.2%");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(Infinity), "—");
  assert.equal(formatPercent(-4.5).includes("+-"), false);
});

test("nullLastComparator keeps missing values last in both directions", () => {
  const rows = [
    { id: "null", value: null },
    { id: "two", value: 2 },
    { id: "nan", value: NaN },
    { id: "one", value: 1 },
  ];

  assert.deepEqual(
    [...rows].sort(nullLastComparator("value", "asc")).map(row => row.id),
    ["one", "two", "null", "nan"],
  );
  assert.deepEqual(
    [...rows].sort(nullLastComparator(row => row.value, "desc")).map(row => row.id),
    ["two", "one", "null", "nan"],
  );
});

test("normalizeSubscriptionStatus reconciles backend status and daily limit", () => {
  assert.deepEqual(normalizeSubscriptionStatus("open", "100元"), {
    status: "limited",
    label: "限额申购",
    canSubscribe: true,
    isOpen: true,
    isSuspended: false,
    isLimited: true,
    isUnlimited: false,
    dailyLimit: "100元",
    limitAmount: 100,
  });

  assert.equal(
    normalizeSubscriptionStatus({ buy_status: "open", daily_limit: "暂停申购" }).status,
    "suspended",
  );
  assert.equal(normalizeSubscriptionStatus(null, "不限额").isUnlimited, true);
  assert.equal(normalizeSubscriptionStatus("暂停申购", "100元").canSubscribe, false);
  assert.deepEqual(
    normalizeSubscriptionStatus("暂停大额申购", "500元"),
    {
      status: "limited",
      label: "限额申购",
      canSubscribe: true,
      isOpen: true,
      isSuspended: false,
      isLimited: true,
      isUnlimited: false,
      dailyLimit: "500元",
      limitAmount: 500,
    },
  );
  assert.equal(
    normalizeSubscriptionStatus({ buy_status: "open", subscription_status: "suspended" }).status,
    "suspended",
  );
  assert.equal(normalizeSubscriptionStatus("unexpected").status, "unknown");
});

test("premiumDisplayModel distinguishes unavailable, discount, par, and premium risk", () => {
  assert.deepEqual(premiumDisplayModel(null), {
    available: false,
    value: null,
    kind: "unavailable",
    severity: "unavailable",
    label: "不可用",
    percentText: "—",
    signedPercentText: "—",
    displayText: "—",
  });

  const discount = premiumDisplayModel(-0.86);
  assert.equal(discount.kind, "discount");
  assert.equal(discount.displayText, "折价 0.86%");
  assert.equal(discount.signedPercentText, "-0.86%");

  assert.equal(premiumDisplayModel(0).kind, "par");
  assert.equal(premiumDisplayModel(1.49).severity, "normal");
  assert.equal(premiumDisplayModel(1.5).severity, "warning");
  assert.equal(premiumDisplayModel(3).severity, "warning");
  assert.equal(premiumDisplayModel(3.01).severity, "danger");
});
