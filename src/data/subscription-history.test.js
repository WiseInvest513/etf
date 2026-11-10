import test from "node:test";
import assert from "node:assert/strict";
import { chartPointsForChannel, emptyHistoryCopy, historyEventsFromPayload, splitHistoryChannels } from "./subscription-history.js";

test("chart points keep stored observation days only", () => {
  const points = chartPointsForChannel([
    { date: "2026-11-10", channel: "agency", status: "limited", daily_limit_cny: 10, daily_limit: "10元" },
    { date: "2026-11-08", channel: "agency", status: "limited", daily_limit_cny: 20 },
    { date: "2026-11-12", channel: "direct", status: "limited", daily_limit_cny: 100 },
  ], "agency");
  assert.deepEqual(points.map((item) => item.date), ["2026-11-10"]);
  assert.equal(points[0].daily_limit_cny, 10);
});

test("does not invent a direct series from agency points", () => {
  const split = splitHistoryChannels({
    data: [{ date: "2026-11-10", channel: "agency", status: "suspended", source: "eastmoney_basic" }],
    channels: { agency: [{ date: "2026-11-10", channel: "agency", status: "suspended", source: "eastmoney_basic" }], direct: [] },
  });
  assert.equal(split.agency.length, 1);
  assert.equal(split.direct.length, 0);
});

test("empty history copy explains that missing days stay empty", () => {
  assert.match(emptyHistoryCopy(), /不会补造/);
  assert.deepEqual(historyEventsFromPayload({ events: [] }), []);
});
