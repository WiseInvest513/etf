const VALID_CHANNELS = new Set(["agency"]);
const VALID_STATUS = new Set(["open", "limited", "suspended"]);

function isWeekday(value) {
  if (!value || typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function chartPointsForChannel(points, channel) {
  return (Array.isArray(points) ? points : [])
    .filter((item) => item?.channel === channel && VALID_STATUS.has(item.status) && isWeekday(item.date || item.full_date))
    .map((item) => {
      const date = item.date || item.full_date;
      const parts = String(date).split("-");
      const label = parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
      const amount = item.status === "limited" && Number.isFinite(Number(item.daily_limit_cny))
        ? Number(item.daily_limit_cny)
        : null;
      return {
        date,
        label,
        channel,
        status: item.status,
        daily_limit: item.daily_limit || null,
        daily_limit_cny: amount,
        source: item.source || null,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function historyEventsFromPayload(payload, { channel = null, includeRecorded = true } = {}) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.filter((event) => {
    if (channel && event.channel !== channel) return false;
    if (!includeRecorded && event.kind === "recorded") return false;
    return Boolean(event.date && event.label);
  });
}

export function emptyHistoryCopy() {
  return "限额变化图将从本次起按工作日记录，此前没有存档的日期会留空，不会补造历史点。";
}

export function splitHistoryChannels(payload) {
  const points = Array.isArray(payload?.data) ? payload.data : [];
  const agency = chartPointsForChannel(payload?.channels?.agency || points, "agency");
  const direct = chartPointsForChannel(payload?.channels?.direct || points, "direct");
  return { agency, direct };
}

export function isValidHistoryChannel(channel) {
  return VALID_CHANNELS.has(channel);
}
