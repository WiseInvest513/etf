const PUBLIC_PAGES = new Set([
  "/", "/guide", "/learn/etf", "/nasdaq", "/sp500", "/etf", "/active",
  "/watchlist", "/onchain", "/lazy", "/chooser", "/export",
  "/today/qdii-limits", "/today/etf-premium",
]);

export function isLoginPromptPage(pathname) {
  return PUBLIC_PAGES.has(pathname)
    || /^\/(fund|etf)\/\d{6}$/.test(pathname)
    || /^\/learn\/etf\/articles\/[a-z0-9-]+$/.test(pathname);
}

export function shouldShowLoginPrompt({ pathname, loading, user, dismissed }) {
  return isLoginPromptPage(pathname) && !loading && !user && !dismissed;
}
