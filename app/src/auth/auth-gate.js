const SESSION_KEY = "rhythm-supabase-session-v1";

function hasStoredSession(storage = globalThis.localStorage) {
  try {
    const session = JSON.parse(storage?.getItem(SESSION_KEY) || "null");
    return Boolean(session?.access_token && session?.user?.id);
  } catch {
    return false;
  }
}

function isAutomationLocation(location = globalThis.location) {
  return new URLSearchParams(String(location?.search || "")).get("automation") === "1";
}

function authTarget(location = globalThis.location, options = {}) {
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

function landingTarget(location = globalThis.location) {
  return location?.protocol === "file:" ? "landing.html" : "/";
}

function redirectToAuth(options = {}) {
  const target = authTarget(globalThis.location, options);
  globalThis.location?.replace?.(target);
  return target;
}

function redirectAfterSignOut() {
  const target = globalThis.location?.protocol === "file:" ? authTarget(globalThis.location) : landingTarget(globalThis.location);
  globalThis.location?.replace?.(target);
  return target;
}

function guard() {
  if (isAutomationLocation() || hasStoredSession()) {
    globalThis.document?.documentElement?.setAttribute("data-auth-ready", "true");
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

if (globalThis.document) guard();

export { authTarget, guard, hasStoredSession, isAutomationLocation, landingTarget, redirectAfterSignOut, redirectToAuth };
export default api;
