const SESSION_KEY = "rhythm-supabase-session-v1";

function hasSession() {
  try {
    const session = JSON.parse(globalThis.localStorage?.getItem(SESSION_KEY) || "null");
    return Boolean(session?.access_token && session?.user?.id);
  } catch {
    return false;
  }
}

function route(path) {
  if (globalThis.location?.protocol !== "file:") return path;
  if (path.startsWith("/auth")) return `auth.html${path.includes("?") ? path.slice(path.indexOf("?")) : ""}`;
  if (path === "/app") return "index.html";
  return "landing.html";
}

function initialize() {
  const recoveryHash = String(globalThis.location?.hash || "");
  if (recoveryHash.includes("type=recovery") && recoveryHash.includes("access_token=")) {
    globalThis.location.replace(`${route("/auth")}${recoveryHash}`);
    return;
  }

  document.querySelectorAll("a[href^='/']").forEach((link) => {
    const url = new URL(link.href, globalThis.location.href);
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
}

initialize();
