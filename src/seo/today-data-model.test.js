import test from "node:test";
import assert from "node:assert/strict";
import { parseLimitAmount, sortTodayRows } from "./today-data-model.js";

test("parses Chinese purchase limits without inventing missing values", () => {
  assert.equal(parseLimitAmount("50元"), 50);
  assert.equal(parseLimitAmount("1万元"), 10_000);
  assert.equal(parseLimitAmount("100万"), 1_000_000);
  assert.equal(parseLimitAmount("不限额"), Infinity);
  assert.equal(parseLimitAmount("待确认"), null);
});

test("sorts numeric fields with missing values last in both directions", () => {
  const rows = [{ code: "A", premium: null }, { code: "B", premium: 3 }, { code: "C", premium: -1 }];
  assert.deepEqual(sortTodayRows(rows, "premium", "asc").map((row) => row.code), ["C", "B", "A"]);
  assert.deepEqual(sortTodayRows(rows, "premium", "desc").map((row) => row.code), ["B", "C", "A"]);
});

test("sorts subscription status while keeping unknown last", () => {
  const rows = [
    { code: "A", subscription_status: "unknown" },
    { code: "B", subscription_status: "open" },
    { code: "C", subscription_status: "suspended" },
    { code: "D", subscription_status: "limited", daily_limit: "100元" },
  ];
  assert.deepEqual(sortTodayRows(rows, "status", "asc").map((row) => row.code), ["C", "D", "B", "A"]);
  assert.deepEqual(sortTodayRows(rows, "status", "desc").map((row) => row.code), ["B", "D", "C", "A"]);
});

test("keeps fresh values ahead of historical and unavailable snapshots", () => {
  const rows = [
    { code: "OLD", premium: 9, premium_snapshot_status: "stale" },
    { code: "NOW", premium: 2, premium_snapshot_status: "fresh" },
    { code: "NONE", premium: null, premium_snapshot_status: "unavailable" },
  ];
  assert.deepEqual(sortTodayRows(rows, "premium", "desc").map((row) => row.code), ["NOW", "OLD", "NONE"]);
});
