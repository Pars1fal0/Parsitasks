const HOSTED_BASE_URL = "https://parsitasks.ru";

function createGoogleCalendarApi(options = {}) {
  const fetchFn = options.fetch || globalThis.fetch?.bind(globalThis);
  const getAccessToken = options.getAccessToken || (() => "");
  const getOwner = options.getOwner || (() => undefined);
  const baseUrl = resolveBaseUrl(options.location || globalThis.location);

  async function request(path, requestOptions = {}) {
    if (!fetchFn) throw new Error("Сеть недоступна");
    const owner = getOwner();
    const assertOwner = () => {
      if (getOwner() !== owner) throw Object.assign(new Error("Аккаунт изменился. Запрос Google Calendar отменён."), { code: "account-changed" });
    };
    const accessToken = await getAccessToken();
    assertOwner();
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
    assertOwner();
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

export { HOSTED_BASE_URL, createGoogleCalendarApi, resolveBaseUrl };
export default api;
