const DEFAULT_HOSTED_CONFIG_URL = "https://parsitasks.ru/api/public-config";

async function loadHostedConfig(options = {}) {
  const locationRef = options.location || globalThis.location;
  const fetchFn = options.fetchFn || globalThis.fetch?.bind(globalThis);
  const endpoint = hostedConfigEndpoint(locationRef, options.endpoint);
  if (!fetchFn || !endpoint) {
    return { managed: false };
  }

  const controller = typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null;
  const timeoutId = controller ? globalThis.setTimeout(() => controller.abort(), 5000) : null;
  try {
    const response = await fetchFn(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return { managed: false };
    const value = await response.json();
    const supabaseUrl = String(value?.supabaseUrl || "").trim().replace(/\/+$/, "");
    const anonKey = String(value?.anonKey || "").trim();
    if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(supabaseUrl) || !anonKey) {
      return { managed: false };
    }
    return { anonKey, managed: true, supabaseUrl,
      ...(value.turnstileSiteKey ? { turnstileSiteKey: String(value.turnstileSiteKey) } : {}) };
  } catch {
    return { managed: false };
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  }
}

function hostedConfigEndpoint(locationRef, override) {
  if (override) return String(override);
  const protocol = String(locationRef?.protocol || "");
  if (protocol === "file:") return DEFAULT_HOSTED_CONFIG_URL;
  if (!/^https?:$/.test(protocol)) return "";
  const hostname = String(locationRef?.hostname || "").toLowerCase();
  if (["127.0.0.1", "::1", "localhost"].includes(hostname)) return DEFAULT_HOSTED_CONFIG_URL;
  const origin = String(locationRef?.origin || "");
  return origin && origin !== "null" ? `${origin.replace(/\/+$/, "")}/api/public-config` : "/api/public-config";
}

const api = { DEFAULT_HOSTED_CONFIG_URL, hostedConfigEndpoint, loadHostedConfig };

export { DEFAULT_HOSTED_CONFIG_URL, hostedConfigEndpoint, loadHostedConfig };
export default api;
