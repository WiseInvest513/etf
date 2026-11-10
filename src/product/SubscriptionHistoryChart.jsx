import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { emptyHistoryCopy } from "../data/subscription-history.js";

const COLORS = {
  agency: "#2878ff",
  direct: "#0f9f73",
};

function formatAmount(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const amount = Number(value);
  return Number.isInteger(amount) ? `${amount}元` : `${amount.toFixed(2)}元`;
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const statusLabel = point.status === "suspended" ? "暂停申购" : point.status === "open" ? "开放申购" : "限额申购";
  return (
    <div className="subhist-tooltip">
      <strong>{point.date}</strong>
      <span>{statusLabel}{point.daily_limit ? ` · ${point.daily_limit}` : point.daily_limit_cny != null ? ` · ${formatAmount(point.daily_limit_cny)}` : ""}</span>
    </div>
  );
}

export default function SubscriptionHistoryChart({
  title,
  caption,
  points = [],
  events = [],
  channel = "agency",
  emptyText = emptyHistoryCopy(),
}) {
  const chartData = (points || []).map((item) => ({
    ...item,
    chart_value: item.status === "limited" && Number.isFinite(Number(item.daily_limit_cny)) ? Number(item.daily_limit_cny) : null,
  }));
  const hasNumeric = chartData.some((item) => item.chart_value != null);
  const changeEvents = (events || []).filter((item) => !channel || item.channel === channel);

  return (
    <section className="subhist-block">
      {title && <div className="pd-section-title"><span>{title}</span>{caption && <small>{caption}</small>}</div>}
      {chartData.length === 0 ? (
        <p className="pd-history-copy">{emptyText}</p>
      ) : (
        <>
          {hasNumeric ? (
            <div className="subhist-chart">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e8eaf1" strokeDasharray="4 5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#7c8598", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis width={52} tickFormatter={(value) => (value >= 10000 ? `${value / 10000}万` : `${value}`)} tick={{ fill: "#7c8598", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="chart_value" name={channel === "direct" ? "直销限额" : "代销限额"} fill={COLORS[channel] || COLORS.agency} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="pd-history-copy">已记录的观察日里没有可绘制的限额数字，暂停或开放会列在下方变化里。</p>
          )}
          {changeEvents.length > 0 && (
            <ul className="subhist-events">
              {changeEvents.map((event) => (
                <li key={`${event.date}-${event.channel}-${event.kind}-${event.code || ""}`}>{event.label}{event.name ? ` · ${event.name}` : ""}{event.code ? `（${event.code}）` : ""}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
