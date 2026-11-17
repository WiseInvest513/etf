export const WISE_MAIN_SITE_ORIGIN = "https://www.wise-invest.org";
export const WISE_ACQUISITION_SITE = "etf";
export const UTM_SOURCE_PARAM = "utm_source";
export const UTM_CAMPAIGN_PARAM = "utm_campaign";

const MAX_CONTENT_LENGTH = 180;
const SAFE_CONTENT_PATTERN = /^\/[A-Za-z0-9/_\-.~%&=?]*$/;
const MAIN_SITE_HOSTS = new Set(["www.wise-invest.org", "wise-invest.org"]);

export function sanitizeAttributionPath(value, fallback = "/") {
  if (typeof value !== "string") return fallback;
  let raw = value.trim();
  if (!raw) return fallback;

  if (raw.startsWith("//") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) {
    try {
      const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
      raw = `${parsed.pathname}${parsed.search}`;
    } catch {
      return fallback;
    }
  }

  raw = raw.split("#")[0];
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) {
    return fallback;
  }

  if (!SAFE_CONTENT_PATTERN.test(raw)) {
    const pathOnly = raw.split("?")[0];
    if (!SAFE_CONTENT_PATTERN.test(pathOnly)) return fallback;
    raw = pathOnly;
  }

  if (raw.length > MAX_CONTENT_LENGTH) {
    raw = raw.slice(0, MAX_CONTENT_LENGTH);
  }

  return raw || fallback;
}

export function isMainSiteUrl(href) {
  if (!href) return false;
  try {
    return MAIN_SITE_HOSTS.has(new URL(href, WISE_MAIN_SITE_ORIGIN).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function withMainSiteAttribution(href, currentPath) {
  try {
    const url = new URL(href, WISE_MAIN_SITE_ORIGIN);
    if (!MAIN_SITE_HOSTS.has(url.hostname.toLowerCase())) return href;
    url.searchParams.set(UTM_SOURCE_PARAM, WISE_ACQUISITION_SITE);
    url.searchParams.set(UTM_CAMPAIGN_PARAM, sanitizeAttributionPath(currentPath));
    return url.toString();
  } catch {
    return href;
  }
}

export function mainSiteAuthorizationParams(currentPath) {
  return {
    [UTM_SOURCE_PARAM]: WISE_ACQUISITION_SITE,
    [UTM_CAMPAIGN_PARAM]: sanitizeAttributionPath(currentPath),
  };
}
