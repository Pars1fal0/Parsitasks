(function (global) {
  const SESSION_KEY = "rhythm-supabase-session-v1";
  const RECOVERY_KEY = "rhythm-password-recovery-v1";

  function createRemoteAuth(options = {}) {
    const fetchFn = options.fetch || global.fetch?.bind(global);
    const storage = options.storage || global.localStorage;
    const tabStorage = options.sessionStorage || global.sessionStorage;
    const getConfig = options.getConfig || (() => ({}));
    let session = loadSession();
    let recoveryMode = loadRecoveryMode();
    let callbackError = "";
    let refreshTimer = null;
    let refreshInFlight = null;
    let sessionVersion = 0;
    const requestTimeoutMs = Math.max(100, Math.min(60_000, Number(options.requestTimeoutMs) || 30_000));

    function loadRecoveryMode() {
      try {
        const marker = JSON.parse(tabStorage?.getItem(RECOVERY_KEY) || "null");
        return Boolean(session && marker?.userId === session.user.id && marker.expiresAt > Date.now());
      } catch { return false; }
    }

    function clearRecovery() {
      recoveryMode = false;
      try { tabStorage?.removeItem(RECOVERY_KEY); } catch {}
    }

    function loadSession() {
      try {
        const value = JSON.parse(storage?.getItem(SESSION_KEY) || "null");
        return value?.access_token && value?.user?.id ? value : null;
      } catch {
        return null;
      }
    }

    function saveSession(nextSession) {
      sessionVersion += 1;
      session = nextSession?.access_token && nextSession?.user?.id ? nextSession : null;
      try {
        if (session) storage?.setItem(SESSION_KEY, JSON.stringify(session));
        else storage?.removeItem(SESSION_KEY);
      } catch {}
      scheduleRefresh();
      options.onSessionChange?.(session);
      return session;
    }

    async function signUp(email, password, authOptions = {}) {
      requireStrongPassword(password);
      return authenticate("signup", { email: cleanEmail(email), password, ...captchaPayload(authOptions) });
    }

    async function signIn(email, password, authOptions = {}) {
      return authenticate("token?grant_type=password", { email: cleanEmail(email), password, ...captchaPayload(authOptions) });
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

    async function isGoogleSignInEnabled() {
      const config = requireConfig();
      try {
        const response = await request(`${config.supabaseUrl}/auth/v1/settings`, {
          headers: { apikey: config.anonKey },
        });
        if (!response.ok) return null;
        const settings = await readResponse(response);
        return typeof settings?.external?.google === "boolean" ? settings.external.google : null;
      } catch {
        return null;
      }
    }

    async function authenticate(path, body) {
      const config = requireConfig();
      const version = sessionVersion;
      const response = await request(`${config.supabaseUrl}/auth/v1/${path}`, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify(body),
      });
      const data = await readResponse(response);
      if (version !== sessionVersion) throw new Error("Состояние входа изменилось. Повтори вход");
      if (!response.ok) throw createAuthError(response, data);
      if (data.access_token) { clearRecovery(); saveSession(data); }
      return data;
    }

    async function refreshSession() {
      if (!session?.refresh_token) return null;
      if (refreshInFlight?.session === session) return refreshInFlight.promise;
      const current = session;
      const promise = performRefresh(current);
      refreshInFlight = { session: current, promise };
      try {
        return await promise;
      } finally {
        if (refreshInFlight?.promise === promise) refreshInFlight = null;
      }
    }

    async function performRefresh(current) {
      const config = requireConfig();
      const response = await request(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      const data = await readResponse(response);
      if (session !== current) return session;
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) saveSession(null);
        throw createAuthError(response, data);
      }
      return saveSession(data);
    }

    async function validateSession() {
      const current = await ensureFreshSession();
      if (!current?.access_token) return null;
      const config = requireConfig();
      const response = await request(`${config.supabaseUrl}/auth/v1/user`, {
        headers: { ...authHeaders(config), Authorization: `Bearer ${current.access_token}` },
      });
      const data = await readResponse(response);
      if (session !== current) return session;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) saveSession(null);
        throw createAuthError(response, data);
      }
      if (!data?.id || String(data.id) !== current.user.id) {
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
      clearRecovery();
      saveSession(null);
      if (!current?.access_token) return;
      let config;
      try {
        config = requireConfig();
      } catch {
        return;
      }
      await request(`${config.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: { ...authHeaders(config), Authorization: `Bearer ${current.access_token}` },
      }).catch(() => {});
    }

    async function resetPassword(email, authOptions = {}) {
      const config = requireConfig();
      const redirectTo = getRecoveryRedirectUrl();
      const url = new URL(`${config.supabaseUrl}/auth/v1/recover`);
      if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
      const response = await request(url.href, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({
          email: cleanEmail(email),
          ...captchaPayload(authOptions),
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
      const version = sessionVersion;
      const response = await request(`${config.supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
          ...authHeaders(config),
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ password }),
      });
      const data = await readResponse(response);
      if (version !== sessionVersion) throw new Error("Состояние входа изменилось. Повтори вход");
      if (!response.ok) throw createAuthError(response, data);
      clearRecovery();
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

    async function request(url, init) {
      const controller = new AbortController();
      let timer;
      try {
        const { response, body } = await Promise.race([
          (async () => {
            const response = await fetchFn(url, { ...init, signal: controller.signal });
            return { response, body: response.text ? await response.text() : JSON.stringify(await response.json()) };
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(Object.assign(new Error("Сервер входа не ответил вовремя. Повтори попытку"), { code: "request-timeout" }));
              controller.abort();
            }, requestTimeoutMs);
          }),
        ]);
        return { ok: response.ok, status: response.status, statusText: response.statusText, text: async () => body };
      } finally {
        clearTimeout(timer);
      }
    }

    restoreCallbackSession();
    scheduleRefresh();
    return {
      ensureFreshSession,
      createOAuthUrl,
      getCallbackError,
      getSession,
      isGoogleSignInEnabled,
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
      const payload = payloadFromAccessToken(params.get("access_token"));
      const user = { id: String(payload?.sub || ""), email: String(payload?.email || "") };
      const now = Math.floor(Date.now() / 1000);
      const duration = Number(params.get("expires_in") || 3600);
      const expiresAt = Number.isFinite(payload?.exp) ? payload.exp : now + duration;
      clearCallbackHash();
      if (!user.id || !Number.isFinite(expiresAt) || expiresAt <= now || !Number.isFinite(duration) || duration <= 0) {
        callbackError = "Ссылка входа недействительна или устарела. Запросите новую ссылку.";
        clearRecovery();
        return;
      }
      recoveryMode = params.get("type") === "recovery";
      saveSession({
        access_token: params.get("access_token"),
        refresh_token: params.get("refresh_token") || "",
        token_type: params.get("token_type") || "bearer",
        expires_at: Math.min(expiresAt, now + Math.min(duration, 86400)),
        user,
      });
      if (recoveryMode) {
        try { tabStorage?.setItem(RECOVERY_KEY, JSON.stringify({ userId: user.id, expiresAt: session.expires_at * 1000 })); } catch {}
      } else clearRecovery();
    }

    function getRecoveryRedirectUrl() {
      const location = global.location;
      if (!location || !/^https?:$/.test(location.protocol)) return "";
      return `${location.origin}/auth`;
    }

    function clearCallbackHash() {
      if (!global.history?.replaceState || !global.location) return;
      global.history.replaceState(null, "", `${global.location.pathname}${global.location.search}`);
    }
  }

  function captchaPayload(options = {}) {
    return options.captchaToken ? { gotrue_meta_security: { captcha_token: String(options.captchaToken) } } : {};
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

  function payloadFromAccessToken(token) {
    try {
      const encoded = String(token || "").split(".")[1] || "";
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(decodeURIComponent(escape(global.atob(normalized))));
      return payload;
    } catch {
      return null;
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
