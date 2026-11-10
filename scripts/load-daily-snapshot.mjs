import { emptyDailySnapshot } from "../src/seo/daily-snapshot.js";
import { SITE_ORIGIN } from "../src/seo/seo-content.js";

function snapshotOrigin() {
  return (process.env.WISEETF_SNAPSHOT_ORIGIN || SITE_ORIGIN).replace(/\/$/, "");
}

export async function loadDailySnapshot({ timeoutMs = 8000 } = {}) {
  const url = `${snapshotOrigin()}/api/daily-board`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return emptyDailySnapshot(`http_${response.status}`);
    const payload = await response.json();
    const funds = Array.isArray(payload?.funds?.data) ? payload.funds : null;
    const etfs = Array.isArray(payload?.etfs?.data) ? payload.etfs : null;
    if (!funds || !etfs) return emptyDailySnapshot("invalid_payload");
    return {
      ok: true,
      reason: null,
      generatedAt: payload.generated_at || null,
      expected: payload.expected || null,
      funds,
      etfs,
    };
  } catch {
    return emptyDailySnapshot("unavailable");
  }
}
