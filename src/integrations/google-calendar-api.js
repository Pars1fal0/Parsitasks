(function (global) {
  const HOSTED_BASE_URL = "https://parsitasks.ru";

  function createGoogleCalendarApi(options = {}) {
    const fetchFn = options.fetch || global.fetch?.bind(global);
    const getAccessToken = options.getAccessToken || (() => "");
    const baseUrl = resolveBaseUrl(options.location || global.location);

    async function request(path, requestOptions = {}) {
      if (!fetchFn) throw new Error("Сеть недоступна");
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Сначала войдите в аккаунт Parsitasks");
      const response = await fetchFn(`${baseUrl}/api/google-calendar/${path}`, {
        ...requestOptions,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
          ...(requestOptions.headers || {}),
        },
      });
      const data = await readJson(response);
      if (!response.ok) {
        const error = new Error(data?.message || data?.error || "Google Calendar недоступен");
        error.status = response.status;
        error.code = data?.error || "";
        throw error;
      }
      return data || {};
    }

    return {
      connect: () => request("connect", { method: "POST" }),
      disconnect: () => request("disconnect", { method: "POST" }),
      status: () => request("status"),
      sync: (payload) => request("sync", { method: "POST", body: JSON.stringify(payload) }),
    };
  }

  function resolveBaseUrl(location) {
    const origin = String(location?.origin || "").replace(/\/+$/, "");
    if (!origin || origin === "null" || location?.protocol === "file:") return HOSTED_BASE_URL;
    return origin;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { message: text }; }
  }

  const api = { HOSTED_BASE_URL, createGoogleCalendarApi, resolveBaseUrl };
  global.RhythmGoogleCalendarApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
