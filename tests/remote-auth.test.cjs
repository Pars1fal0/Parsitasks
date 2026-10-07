const assert = require("node:assert/strict");
const { SESSION_KEY, createRemoteAuth } = require("../app/src/auth/remote-auth.js");

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

module.exports = [
  { name: "signup, password login and recovery pass CAPTCHA tokens to Supabase without logging or persisting them", async fn() {
    const bodies = [];
    const storage = createStorage();
    const auth = createRemoteAuth({ getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }), storage,
      fetch: async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, text: async () => "{}" }; } });
    await auth.signUp("test@example.com", "password12", { captchaToken: "captcha-1" });
    await auth.signIn("test@example.com", "password12", { captchaToken: "captcha-2" });
    await auth.resetPassword("test@example.com", { captchaToken: "captcha-3" });
    assert.deepEqual(bodies.map((body) => body.gotrue_meta_security.captcha_token), ["captcha-1", "captcha-2", "captcha-3"]);
    assert.doesNotMatch(JSON.stringify([...storage.values]), /captcha-/);
  } },
  {
    name: "rejects weak new account passwords before contacting Supabase",
    async fn() {
      let called = false;
      const auth = createRemoteAuth({
        fetch: async () => { called = true; },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage: createStorage(),
      });

      await assert.rejects(() => auth.signUp("me@example.com", "short"), /8 символов/);
      assert.equal(called, false);
    },
  },
  {
    name: "stores an authenticated session separately after sign in",
    async fn() {
      const storage = createStorage();
      const calls = [];
      const auth = createRemoteAuth({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            text: async () => JSON.stringify({ access_token: "jwt", refresh_token: "refresh", user: { id: "u1", email: "me@example.com" } }),
          };
        },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co/" }),
        storage,
      });

      await auth.signIn(" ME@example.com ", "secret12");

      assert.match(calls[0].url, /auth\/v1\/token\?grant_type=password$/);
      assert.equal(JSON.parse(calls[0].options.body).email, "me@example.com");
      assert.equal(auth.getSession().user.id, "u1");
      assert.equal(JSON.parse(storage.values.get(SESSION_KEY)).access_token, "jwt");
    },
  },
  {
    name: "builds a Google OAuth URL with an explicit safe callback",
    fn() {
      const auth = createRemoteAuth({
        fetch: async () => { throw new Error("OAuth URL creation must not call fetch"); },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co/" }),
        storage: createStorage(),
      });

      const url = new URL(auth.createOAuthUrl("google", "https://parsitasks.ru/auth"));
      assert.equal(url.origin, "https://demo.supabase.co");
      assert.equal(url.pathname, "/auth/v1/authorize");
      assert.equal(url.searchParams.get("provider"), "google");
      assert.equal(url.searchParams.get("redirect_to"), "https://parsitasks.ru/auth");
      assert.throws(() => auth.createOAuthUrl("github", "https://parsitasks.ru/auth"), /не поддерживается/);
      assert.throws(() => auth.createOAuthUrl("google", "javascript:alert(1)"), /Некорректный адрес/);
    },
  },
  {
    name: "detects a disabled Google provider without blocking on settings errors",
    async fn() {
      const auth = createRemoteAuth({
        fetch: async (url, options) => {
          assert.match(url, /auth\/v1\/settings$/);
          assert.equal(options.headers.apikey, "anon");
          return { ok: true, json: async () => ({ external: { google: false } }) };
        },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage: createStorage(),
      });
      assert.equal(await auth.isGoogleSignInEnabled(), false);
      const offline = createRemoteAuth({
        fetch: async () => { throw new Error("offline"); },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage: createStorage(),
      });
      assert.equal(await offline.isGoogleSignInEnabled(), null);
    },
  },
  {
    name: "restores a Supabase session after the Google OAuth callback",
    async fn() {
      const previousLocation = global.location;
      const previousHistory = global.history;
      const payload = Buffer.from(JSON.stringify({ sub: "google-user", email: "me@gmail.com" })).toString("base64url");
      const token = `header.${payload}.signature`;
      const historyCalls = [];
      global.location = {
        hash: `#access_token=${token}&refresh_token=refresh&expires_in=3600`,
        pathname: "/auth",
        protocol: "https:",
        search: "",
      };
      global.history = { replaceState: (...args) => historyCalls.push(args) };
      try {
        const auth = createRemoteAuth({
          fetch: async () => ({ ok: true, text: async () => "" }),
          getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
          storage: createStorage(),
        });

        assert.equal(auth.isRecoveryMode(), false);
        assert.equal(auth.getSession().user.id, "google-user");
        assert.equal(auth.getSession().user.email, "me@gmail.com");
        assert.equal(historyCalls.length, 1);
        assert.equal(historyCalls[0][2], "/auth");
        await auth.signOut();
      } finally {
        if (previousLocation === undefined) delete global.location;
        else global.location = previousLocation;
        if (previousHistory === undefined) delete global.history;
        else global.history = previousHistory;
      }
    },
  },
  {
    name: "clears the local session on sign out",
    async fn() {
      const storage = createStorage();
      storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "jwt", user: { id: "u1" } }));
      const auth = createRemoteAuth({
        fetch: async () => ({ ok: true, text: async () => "" }),
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage,
      });

      await auth.signOut();
      assert.equal(auth.getSession(), null);
      assert.equal(storage.getItem(SESSION_KEY), null);
    },
  },
  {
    name: "validates a stored session with Supabase before opening the app",
    async fn() {
      const storage = createStorage();
      storage.setItem(SESSION_KEY, JSON.stringify({
        access_token: "jwt",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "old@example.com" },
      }));
      const calls = [];
      const auth = createRemoteAuth({
        fetch: async (url, options) => {
          calls.push({ options, url });
          return { ok: true, status: 200, text: async () => JSON.stringify({ id: "u1", email: "new@example.com" }) };
        },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage,
      });

      const session = await auth.validateSession();

      assert.match(calls[0].url, /auth\/v1\/user$/);
      assert.equal(calls[0].options.headers.Authorization, "Bearer jwt");
      assert.equal(session.user.email, "new@example.com");
    },
  },
  {
    name: "drops an invalid stored session after server validation",
    async fn() {
      const storage = createStorage();
      storage.setItem(SESSION_KEY, JSON.stringify({
        access_token: "expired",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1" },
      }));
      const auth = createRemoteAuth({
        fetch: async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "{}" }),
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage,
      });

      await assert.rejects(() => auth.validateSession(), /Unauthorized/);
      assert.equal(auth.getSession(), null);
      assert.equal(storage.getItem(SESSION_KEY), null);
    },
  },
  {
    name: "still signs out locally after project settings are removed",
    async fn() {
      const storage = createStorage();
      storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "jwt", user: { id: "u1" } }));
      const auth = createRemoteAuth({
        fetch: async () => {
          throw new Error("must not request a missing project");
        },
        getConfig: () => ({}),
        storage,
      });

      await auth.signOut();

      assert.equal(storage.getItem(SESSION_KEY), null);
    },
  },
  {
    name: "requests a password recovery email without storing credentials",
    async fn() {
      const calls = [];
      const auth = createRemoteAuth({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return { ok: true, text: async () => "{}" };
        },
        getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        storage: createStorage(),
      });

      await auth.resetPassword(" ME@example.com ");
      assert.match(calls[0].url, /auth\/v1\/recover$/);
      assert.equal(JSON.parse(calls[0].options.body).email, "me@example.com");
    },
  },
  {
    name: "accepts a recovery session and updates the password",
    async fn() {
      const previousLocation = global.location;
      const previousHistory = global.history;
      const payload = Buffer.from(JSON.stringify({ sub: "u1", email: "me@example.com" })).toString("base64url");
      const token = `header.${payload}.signature`;
      const calls = [];
      global.location = {
        hash: `#access_token=${token}&refresh_token=refresh&type=recovery&expires_in=3600`,
        origin: "https://parsitasks.ru",
        pathname: "/",
        protocol: "https:",
        search: "",
      };
      global.history = { replaceState: (...args) => calls.push({ history: args }) };
      try {
        const auth = createRemoteAuth({
          fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, text: async () => "{}" };
          },
          getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
          storage: createStorage(),
        });

        assert.equal(auth.isRecoveryMode(), true);
        assert.equal(auth.getSession().user.id, "u1");
        assert.equal(calls.filter((call) => call.history).length, 1);
        await auth.updatePassword("new-secret");
        assert.equal(auth.isRecoveryMode(), false);
        assert.match(calls.find((call) => call.url)?.url || "", /auth\/v1\/user$/);
        assert.equal(JSON.parse(calls.find((call) => call.url)?.options.body).password, "new-secret");
        await auth.signOut();
      } finally {
        if (previousLocation === undefined) delete global.location;
        else global.location = previousLocation;
        if (previousHistory === undefined) delete global.history;
        else global.history = previousHistory;
      }
    },
  },
  {
    name: "recovery marker survives reload without leaving tokens in the URL and is removed after success",
    async fn() {
      const location = global.location; const history = global.history;
      const storage = createStorage(); const sessionStorage = createStorage();
      const payload = Buffer.from(JSON.stringify({ sub: "recovery-user", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      const options = { storage, sessionStorage, getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }), fetch: async () => ({ ok: true, text: async () => "{}" }) };
      try {
        global.location = { hash: `#access_token=header.${payload}.signature&type=recovery`, pathname: "/auth", search: "", protocol: "https:" };
        global.history = { replaceState() { global.location.hash = ""; } };
        const first = createRemoteAuth(options);
        assert.equal(first.isRecoveryMode(), true); assert.equal(global.location.hash, "");
        const reloaded = createRemoteAuth(options); assert.equal(reloaded.isRecoveryMode(), true);
        await reloaded.updatePassword("synthetic-password");
        assert.equal(createRemoteAuth(options).isRecoveryMode(), false);
      } finally { global.location = location; global.history = history; }
    },
  },
  {
    name: "expired and malformed callback tokens cannot replace a previously valid session",
    fn() {
      const location = global.location; const history = global.history;
      try {
        global.history = { replaceState() {} };
        const payload = Buffer.from(JSON.stringify({ sub: "expired", exp: Math.floor(Date.now() / 1000) - 1 })).toString("base64url");
        for (const token of [`header.${payload}.signature`, "broken"]) {
          const storage = createStorage(); storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "existing", user: { id: "current" } }));
          global.location = { hash: `#access_token=${token}&type=recovery`, pathname: "/auth", search: "" };
          const auth = createRemoteAuth({ storage, fetch: async () => { throw new Error("must not fetch"); } });
          assert.equal(auth.getSession().user.id, "current"); assert.equal(auth.isRecoveryMode(), false);
          assert.match(auth.getCallbackError(), /устарела/);
        }
      } finally { global.location = location; global.history = history; }
    },
  },
  {
    name: "recovery email redirects use the dedicated auth route in the provider query",
    async fn() {
      const location = global.location; const calls = [];
      try {
        global.location = { origin: "https://parsitasks.ru", pathname: "/app", protocol: "https:", hash: "" };
        const auth = createRemoteAuth({ storage: createStorage(), getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
          fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => "{}" }; } });
        await auth.resetPassword("me@example.test");
        assert.equal(new URL(calls[0].url).searchParams.get("redirect_to"), "https://parsitasks.ru/auth");
        assert.deepEqual(JSON.parse(calls[0].init.body), { email: "me@example.test" });
      } finally { global.location = location; }
    },
  },
  {
    name: "password update cannot announce success after the account signs out while waiting",
    async fn() {
      const storage = createStorage(); storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "synthetic", user: { id: "u1" } }));
      let finish;
      const auth = createRemoteAuth({ storage, getConfig: () => ({ anonKey: "anon", supabaseUrl: "https://demo.supabase.co" }),
        fetch: async (url) => url.endsWith("/user") ? new Promise((resolve) => { finish = resolve; }) : { ok: true, text: async () => "{}" } });
      const pending = auth.updatePassword("synthetic-password");
      await auth.signOut(); finish({ ok: true, text: async () => "{}" });
      await assert.rejects(pending, /Состояние входа изменилось/); assert.equal(auth.getSession(), null);
    },
  },
];
