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
];
