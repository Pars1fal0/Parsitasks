(function (global) {
  const SESSION_KEY = "rhythm-supabase-session-v1";

  function hasSession() {
    try {
      const session = JSON.parse(global.localStorage?.getItem(SESSION_KEY) || "null");
      return Boolean(session?.access_token && session?.user?.id);
    } catch {
      return false;
    }
  }

  function route(path) {
    if (global.location?.protocol !== "file:") return path;
    if (path.startsWith("/auth")) return `auth.html${path.includes("?") ? path.slice(path.indexOf("?")) : ""}`;
    if (path === "/app") return "index.html";
    return "landing.html";
  }

  const recoveryHash = String(global.location?.hash || "");
  if (recoveryHash.includes("type=recovery") && recoveryHash.includes("access_token=")) {
    global.location.replace(`${route("/auth")}${recoveryHash}`);
    return;
  }

  document.querySelectorAll("a[href^='/']").forEach((link) => {
    const url = new URL(link.href, global.location.href);
    link.href = route(`${url.pathname}${url.search}`);
  });

  if (!hasSession()) return;
  document.querySelectorAll("[data-primary-cta]").forEach((link) => {
    link.href = route("/app");
    link.textContent = "Открыть приложение";
  });
  document.querySelectorAll("[data-auth-link]").forEach((link) => {
    link.href = route("/app");
    link.textContent = "Моё пространство";
  });
})(typeof window !== "undefined" ? window : globalThis);
