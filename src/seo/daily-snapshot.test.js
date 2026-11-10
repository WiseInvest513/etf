import test from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_DAILY,
  datedDailyText,
  formatEtfDaily,
  formatFundDaily,
  snapshotByCode,
} from "./daily-snapshot.js";

test("fund daily values require a dated usable snapshot", () => {
  assert.equal(formatFundDaily({ daily_limit: "1000元", subscription_status: "limited" }).text, PENDING_DAILY);
  assert.equal(formatFundDaily({
    daily_limit: "1000元",
    subscription_status: "limited",
    subscription_snapshot_status: "fresh",
    subscription_as_of: "2026-11-10",
  }).text, "限额申购 · 1000元");
  assert.equal(datedDailyText(formatFundDaily({
    daily_limit: "暂停申购",
    subscription_status: "suspended",
    subscription_snapshot_status: "stale",
    subscription_as_of: "2026-11-09",
  })), "暂停申购（2026-11-09）");
});

test("etf premiums never come from catalog-only rows", () => {
  assert.equal(formatEtfDaily({ premium: 12.5, premium_snapshot_status: "catalog" }).text, PENDING_DAILY);
  assert.deepEqual(formatEtfDaily({
    premium: 12.5,
    premium_snapshot_status: "fresh",
    premium_as_of: "2026-11-10T15:30:00+08:00",
  }), { text: "12.50%", asOf: "2026-11-10", usable: true });
});

test("snapshotByCode indexes funds and etfs without mixing kinds", () => {
  const map = snapshotByCode({
    funds: { data: [{ code: "000001", daily_limit: "100" }] },
    etfs: { data: [{ code: "513100", premium: 1.2 }] },
  });
  assert.equal(map.get("000001").kind, "fund");
  assert.equal(map.get("513100").kind, "etf");
});
