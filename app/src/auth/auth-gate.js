(function (global) {
  const SESSION_KEY = "rhythm-supabase-session-v1";

  function hasStoredSession(storage = global.localStorage) {
    try {
      const session = JSON.parse(storage?.getItem(SESSION_KEY) || "null");
      return Boolean(session?.access_token && session?.user?.id);
    } catch {
      return false;
    }
  }

  function isAutomationLocation(location = global.location) {
    return new URLSearchParams(String(location?.search || "")).get("automation") === "1";
  }

  function authTarget(location = global.location, options = {}) {
    const isFile = location?.protocol === "file:";
    const hash = String(location?.hash || "");
    const authPage = isFile ? "auth.html" : "/auth";
    if (hash.includes("type=recovery") && hash.includes("access_token=")) return `${authPage}${hash}`;
    const currentAppTarget = isFile
      ? `index.html${hash}`
      : `/app${hash}`;
    const mode = options.mode ? `mode=${encodeURIComponent(options.mode)}&` : "";
    return `${authPage}?${mode}next=${encodeURIComponent(currentAppTarget)}`;
  }

  function landingTarget(location = global.location) {
    return location?.protocol === "file:" ? "landing.html" : "/";
  }

  function redirectToAuth(options = {}) {
    const target = authTarget(global.location, options);
    global.location?.replace?.(target);
    return target;
  }

  function redirectAfterSignOut() {
    const target = global.location?.protocol === "file:" ? authTarget(global.location) : landingTarget(global.location);
    global.location?.replace?.(target);
    return target;
  }

  function guard() {
    if (isAutomationLocation() || hasStoredSession()) {
      global.document?.documentElement?.setAttribute("data-auth-ready", "true");
      return true;
    }
    redirectToAuth();
    return false;
  }

  const api = {
    authTarget,
    guard,
    hasStoredSession,
    isAutomationLocation,
    landingTarget,
    redirectAfterSignOut,
    redirectToAuth,
  };
  global.RhythmAuthGate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global.document) guard();
})(typeof window !== "undefined" ? window : globalThis);
