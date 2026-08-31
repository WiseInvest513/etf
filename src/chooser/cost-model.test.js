import test from "node:test";
import assert from "node:assert/strict";
import { calculateCostProjection } from "./cost-model.js";

test("monthly projection accumulates the planned principal", () => {
  const result = calculateCostProjection({ amount: 1000, years: 5, mode: "monthly", grossReturn: 0 });
  assert.equal(result.totals.plannedPrincipal, 60_000);
  assert.equal(result.data.length, 6);
});

test("fresh fund limits reduce executable contributions without changing planned principal", () => {
  const result = calculateCostProjection({
    amount: 1000,
    years: 1,
    grossReturn: 0,
    fundSubscriptionFee: 0,
    fundAnnualFee: 0,
    fundCandidate: { signal: { key: "partial" }, daily_limit: "50元" },
  });
  assert.equal(result.totals.plannedPrincipal, 12_000);
  assert.equal(result.totals.fundInvested, 600);
  assert.equal(result.totals.fundUninvested, 11_400);
});

test("stale limits never silently constrain the hypothetical projection", () => {
  const result = calculateCostProjection({
    amount: 1000,
    years: 1,
    grossReturn: 0,
    fundSubscriptionFee: 0,
    fundAnnualFee: 0,
    fundCandidate: { signal: { key: "stale" }, daily_limit: "10元" },
  });
  assert.equal(result.totals.fundInvested, 12_000);
  assert.equal(result.fundCapacity.confirmed, false);
});

test("ETF entry friction includes minimum commission and premium", () => {
  const result = calculateCostProjection({
    amount: 1000,
    years: 1,
    mode: "once",
    grossReturn: 0,
    etfAnnualFee: 0,
    etfPremium: 1,
    etfCommissionRate: 0.03,
    etfMinimumCommission: 5,
  });
  assert.ok(result.totals.etfEntryCost >= 14 && result.totals.etfEntryCost <= 16);
});
