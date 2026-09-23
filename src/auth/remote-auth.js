(function (global) {
  const SESSION_KEY = "rhythm-supabase-session-v1";

  function createRemoteAuth(options = {}) {
    const fetchFn = options.fetch || global.fetch?.bind(global);
    const storage = options.storage || global.localStorage;
    const getConfig = options.getConfig || (() => ({}));
    let session = loadSession();
    let recoveryMode = false;
    let callbackError = "";
    let refreshTimer = null;

    function loadSession() {
      try {
        const value = JSON.parse(storage?.getItem(SESSION_KEY) || "null");
        return value?.access_token && value?.user?.id ? value : null;
      } catch {
        return null;
      }
    }

    function saveSession(nextSession) {
      session = nextSession?.access_token && nextSession?.user?.id ? nextSession : null;
      try {
        if (session) storage?.setItem(SESSION_KEY, JSON.stringify(session));
        else storage?.removeItem(SESSION_KEY);
      } catch {}
      scheduleRefresh();
      options.onSessionChange?.(session);
      return session;
    }

    async function signUp(email, password) {
      requireStrongPassword(password);
      return authenticate("signup", { email: cleanEmail(email), password });
    }

    async function signIn(email, password) {
      return authenticate("token?grant_type=password", { email: cleanEmail(email), password });
    }

    function createOAuthUrl(provider, redirectTo) {
      const config = requireConfig();
      const normalizedProvider = String(provider || "").trim().toLowerCase();
      if (normalizedProvider !== "google") throw new Error("Этот способ входа не поддерживается");
      const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
      url.searchParams.set("provider", normalizedProvider);
      if (redirectTo) url.searchParams.set("redirect_to", validateOAuthRedirect(redirectTo));
      return url.href;
    }

    async function authenticate(path, body) {
      const config = requireConfig();
      const response = await fetchFn(`${config.supabaseUrl}/auth/v1/${path}`, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify(body),
      });
      const data = await readResponse(response);
      if (!response.ok) throw createAuthError(response, data);
      if (data.access_token) saveSession(data);
      return data;
    }

    async function refreshSession() {
      if (!session?.refresh_token) return null;
      const config = requireConfig();
      const response = await fetchFn(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const data = await readResponse(response);
      if (!response.ok) {
        saveSession(null);
        throw createAuthError(response, data);
      }
      return saveSession(data);
    }

    async function validateSession() {
      const current = await ensureFreshSession();
      if (!current?.access_token) return null;
      const config = requireConfig();
      const response = await fetchFn(`${config.supabaseUrl}/auth/v1/user`, {
        headers: { ...authHeaders(config), Authorization: `Bearer ${current.access_token}` },
      });
      const data = await readResponse(response);
      if (!response.ok) {
        if ([401, 403].includes(response.status)) saveSession(null);
        throw createAuthError(response, data);
      }
      if (!data?.id) {
        saveSession(null);
        throw new Error("Сессия аккаунта недействительна");
      }
      return saveSession({
        ...current,
        user: { ...current.user, id: String(data.id), email: String(data.email || current.user?.email || "") },
      });
    }

    async function signOut() {
      const current = session;
      saveSession(null);
      if (!current?.access_token) return;
      let config;
      try {
        config = requireConfig();
      } catch {
        return;
      }
      await fetchFn(`${config.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: { ...authHeaders(config), Authorization: `Bearer ${current.access_token}` },
      }).catch(() => {});
    }

    async function resetPassword(email) {
      const config = requireConfig();
      const redirectTo = getRecoveryRedirectUrl();
      const response = await fetchFn(`${config.supabaseUrl}/auth/v1/recover`, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({
          email: cleanEmail(email),
          ...(redirectTo ? { redirect_to: redirectTo } : {}),
        }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw createAuthError(response, data);
      return data;
    }

    async function updatePassword(password) {
      requireStrongPassword(password);
      if (!session?.access_token) throw new Error("Ссылка восстановления недействительна или устарела");
      const config = requireConfig();
      const response = await fetchFn(`${config.supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
          ...authHeaders(config),
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ password }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw createAuthError(response, data);
      recoveryMode = false;
      clearCallbackHash();
      return data;
    }

    function scheduleRefresh() {
      if (refreshTimer) global.clearTimeout(refreshTimer);
      refreshTimer = null;
      if (!session?.expires_at || !session?.refresh_token) return;
      const delay = Math.max(10_000, session.expires_at * 1000 - Date.now() - 60_000);
      refreshTimer = global.setTimeout(() => refreshSession().catch(() => {}), delay);
    }

    function getSession() {
      return session;
    }

    function isRecoveryMode() {
      return recoveryMode;
    }

    function getCallbackError() {
      return callbackError;
    }

    async function ensureFreshSession() {
      if (!session?.expires_at || session.expires_at * 1000 > Date.now() + 60_000) return session;
      return refreshSession();
    }

    function requireConfig() {
      if (!fetchFn) throw new Error("Fetch API is not available");
      const raw = getConfig();
      const config = {
        anonKey: String(raw.anonKey || "").trim(),
        supabaseUrl: String(raw.supabaseUrl || "").trim().replace(/\/+$/, ""),
      };
      if (!config.supabaseUrl || !config.anonKey) throw new Error("Сначала заполни URL и публичный ключ Supabase");
      if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(config.supabaseUrl)) {
        throw new Error("Некорректный адрес проекта Supabase");
      }
      return config;
    }

    restoreCallbackSession();
    scheduleRefresh();
    return {
      ensureFreshSession,
      createOAuthUrl,
      getCallbackError,
      getSession,
      isRecoveryMode,
      refreshSession,
      resetPassword,
      signIn,
      signOut,
      signUp,
      updatePassword,
      validateSession,
    };

    function restoreCallbackSession() {
      const params = new URLSearchParams(String(global.location?.hash || "").replace(/^#/, ""));
      callbackError = String(params.get("error_description") || params.get("error") || "").replace(/\+/g, " ");
      if (callbackError) {
        clearCallbackHash();
        return;
      }
      if (!params.get("access_token")) return;
      const user = userFromAccessToken(params.get("access_token"));
      if (!user.id) return;
      recoveryMode = params.get("type") === "recovery";
      saveSession({
        access_token: params.get("access_token"),
        refresh_token: params.get("refresh_token") || "",
        token_type: params.get("token_type") || "bearer",
        expires_at: Math.floor(Date.now() / 1000) + Math.max(60, Number(params.get("expires_in") || 3600)),
        user,
      });
      if (!recoveryMode) clearCallbackHash();
    }

    function getRecoveryRedirectUrl() {
      const location = global.location;
      if (!location || !/^https?:$/.test(location.protocol)) return "";
      return `${location.origin}${location.pathname}`;
    }

    function clearCallbackHash() {
      if (!global.history?.replaceState || !global.location) return;
      global.history.replaceState(null, "", `${global.location.pathname}${global.location.search}`);
    }
  }

  function authHeaders(config) {
    return { apikey: config.anonKey, "Content-Type": "application/json" };
  }

  function cleanEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function requireStrongPassword(value) {
    if (String(value || "").length < 8) {
      throw new Error("Пароль должен содержать не меньше 8 символов");
    }
  }

  function validateOAuthRedirect(value) {
    let url;
    try {
      url = new URL(String(value || ""));
    } catch {
      throw new Error("Некорректный адрес возврата после входа");
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error("Некорректный адрес возврата после входа");
    return url.href;
  }

  function userFromAccessToken(token) {
    try {
      const encoded = String(token || "").split(".")[1] || "";
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(decodeURIComponent(escape(global.atob(normalized))));
      return { id: String(payload.sub || ""), email: String(payload.email || "") };
    } catch {
      return { id: "", email: "" };
    }
  }

  async function readResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text }; }
  }

  function createAuthError(response, data) {
    const error = new Error(data?.msg || data?.message || response.statusText || "Ошибка авторизации");
    error.status = response.status;
    return error;
  }

  const api = { SESSION_KEY, createRemoteAuth };
  global.RhythmRemoteAuth = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
