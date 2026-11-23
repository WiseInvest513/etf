export const PAGE_NAVIGATION_EVENT = "wise:page-navigation";

export function normalizePagePath(pathname = "/") {
  return pathname.replace(/\/+$/, "") || "/";
}

// One shared subscription for auth revalidation and the per-visit reminder.
// Query/filter changes are not new page visits. Back/forward and BFCache
// restores are: returning to a dismissed page should prompt a guest again.
export function createPageVisitStore(browserWindow) {
  let snapshot = { pathname: normalizePagePath(browserWindow.location.pathname), visit: 0 };
  const listeners = new Set();
  const eventTypes = [PAGE_NAVIGATION_EVENT, "popstate", "pageshow"];

  const sync = (event) => {
    const pathname = normalizePagePath(browserWindow.location.pathname);
    if (pathname === snapshot.pathname && !(event?.type === "pageshow" && event.persisted)) return;
    snapshot = { pathname, visit: snapshot.visit + 1 };
    listeners.forEach(listener => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!listeners.size) eventTypes.forEach(type => browserWindow.addEventListener(type, sync));
      listeners.add(listener);
      sync();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) eventTypes.forEach(type => browserWindow.removeEventListener(type, sync));
      };
    },
  };
}

export const pageVisits = typeof window === "undefined" ? null : createPageVisitStore(window);

export function navigateWithinSite(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
}
