import { parseLimitAmount } from "../seo/today-data-model.js";

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const annualToMonthly = (annualPercent) => Math.pow(1 + finiteNumber(annualPercent) / 100, 1 / 12) - 1;

function confirmedFundCapacity(candidate, plannedAmount) {
  const signal = candidate?.signal?.key;
  if (signal === "blocked") return { amount: 0, confirmed: true, label: "当前暂停申购" };
  if (!["fit", "partial"].includes(signal)) return { amount: plannedAmount, confirmed: false, label: "额度未确认，曲线暂按可完整投入计算" };
  const limit = parseLimitAmount(candidate?.daily_limit);
  if (limit === null || limit === Infinity) return { amount: plannedAmount, confirmed: true, label: limit === Infinity ? "当前不限额" : "当前开放申购" };
  return {
    amount: Math.min(plannedAmount, limit),
    confirmed: true,
    label: limit < plannedAmount ? `当前额度每期最多覆盖 ¥${limit.toLocaleString("zh-CN")}` : "当前额度可覆盖计划投入",
  };
}

export function calculateCostProjection({
  amount = 1000,
  years = 5,
  mode = "monthly",
  grossReturn = 8,
  fundAnnualFee = 0.8,
  etfAnnualFee = 0.8,
  fundSubscriptionFee = 0.1,
  etfPremium = 0.5,
  etfCommissionRate = 0.03,
  etfMinimumCommission = 5,
  fundCandidate = null,
} = {}) {
  const plannedAmount = Math.max(0, finiteNumber(amount));
  const totalYears = Math.max(1, Math.min(30, Math.round(finiteNumber(years, 5))));
  const months = totalYears * 12;
  const fundCapacity = confirmedFundCapacity(fundCandidate, plannedAmount);
  const fundMonthlyRate = annualToMonthly(finiteNumber(grossReturn) - Math.max(0, finiteNumber(fundAnnualFee)));
  const etfMonthlyRate = annualToMonthly(finiteNumber(grossReturn) - Math.max(0, finiteNumber(etfAnnualFee)));
  const subscriptionRate = Math.max(0, finiteNumber(fundSubscriptionFee)) / 100;
  const premiumRate = Math.max(-0.99, finiteNumber(etfPremium) / 100);
  const commissionRate = Math.max(0, finiteNumber(etfCommissionRate)) / 100;
  const minimumCommission = Math.max(0, finiteNumber(etfMinimumCommission));
  let fundValue = 0;
  let etfValue = 0;
  let plannedPrincipal = 0;
  let fundInvested = 0;
  let etfInvested = 0;
  let fundEntryCost = 0;
  let etfEntryCost = 0;
  const data = [{ year: 0, label: "现在", principal: 0, fund: 0, etf: 0 }];

  for (let month = 1; month <= months; month += 1) {
    const shouldContribute = mode === "once" ? month === 1 : true;
    if (shouldContribute && plannedAmount > 0) {
      plannedPrincipal += plannedAmount;
      const fundGross = mode === "once" && !fundCapacity.confirmed ? plannedAmount : fundCapacity.amount;
      const fundNet = Math.max(0, fundGross * (1 - subscriptionRate));
      fundValue += fundNet;
      fundInvested += fundGross;
      fundEntryCost += fundGross - fundNet;

      const commission = Math.min(plannedAmount, Math.max(plannedAmount * commissionRate, minimumCommission));
      const afterCommission = Math.max(0, plannedAmount - commission);
      const etfNet = premiumRate > -1 ? afterCommission / (1 + premiumRate) : 0;
      etfValue += etfNet;
      etfInvested += plannedAmount;
      etfEntryCost += plannedAmount - etfNet;
    }
    fundValue *= 1 + fundMonthlyRate;
    etfValue *= 1 + etfMonthlyRate;
    if (month % 12 === 0) {
      data.push({
        year: month / 12,
        label: `${month / 12}年`,
        principal: Math.round(plannedPrincipal),
        fund: Math.round(fundValue),
        etf: Math.round(etfValue),
      });
    }
  }

  return {
    data,
    assumptions: {
      grossReturn: finiteNumber(grossReturn),
      fundAnnualFee: finiteNumber(fundAnnualFee),
      etfAnnualFee: finiteNumber(etfAnnualFee),
      fundSubscriptionFee: finiteNumber(fundSubscriptionFee),
      etfPremium: finiteNumber(etfPremium),
      etfCommissionRate: finiteNumber(etfCommissionRate),
      etfMinimumCommission: minimumCommission,
    },
    totals: {
      plannedPrincipal: Math.round(plannedPrincipal),
      fundInvested: Math.round(fundInvested),
      etfInvested: Math.round(etfInvested),
      fundUninvested: Math.max(0, Math.round(plannedPrincipal - fundInvested)),
      fundEntryCost: Math.round(fundEntryCost),
      etfEntryCost: Math.round(etfEntryCost),
      fundValue: Math.round(fundValue),
      etfValue: Math.round(etfValue),
      difference: Math.round(etfValue - fundValue),
    },
    fundCapacity,
  };
}
