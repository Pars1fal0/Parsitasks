const assert = require("node:assert/strict");
const { SESSION_KEY, createRemoteAuth } = require("../app/src/auth/remote-auth.js");
const { createGoogleCalendarApi } = require("../app/src/integrations/google-calendar-api.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function authFixture({ expired = false, pendingPath } = {}) {
  const values = new Map([[SESSION_KEY, JSON.stringify({ access_token: "token-a", refresh_token: "refresh-a", user: { id: "a" }, ...(expired ? { expires_at: 1 } : {}) })]]);
  const pending = deferred(), started = deferred();
  const auth = createRemoteAuth({
    storage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    getConfig: () => ({ anonKey: "synthetic", supabaseUrl: "https://demo.supabase.co" }),
    fetch: async (url) => {
      if (url.endsWith(pendingPath)) { started.resolve(); return pending.promise; }
      return { ok: true, text: async () => JSON.stringify({ access_token: "token-b", user: { id: "b" } }) };
    },
  });
  return { auth, pending, started };
}

module.exports = [
  { name: "an outdated token refresh cannot hand the replacement account to its caller", async fn() {
    const { auth, pending, started } = authFixture({ expired: true, pendingPath: "grant_type=refresh_token" });
    try {
      const refreshing = auth.ensureFreshSession();
      await started.promise;
      await auth.signIn("b@example.test", "synthetic-password");
      pending.resolve({ ok: true, text: async () => JSON.stringify({ access_token: "late-a", user: { id: "a" } }) });
      assert.equal(await refreshing, null);
      assert.equal(auth.getSession().user.id, "b");
    } finally { await auth.signOut(); }
  } },
  { name: "an outdated account validation cannot hand the replacement account to its caller", async fn() {
    const { auth, pending, started } = authFixture({ pendingPath: "/user" });
    try {
      const validating = auth.validateSession();
      await started.promise;
      await auth.signIn("b@example.test", "synthetic-password");
      pending.resolve({ ok: true, text: async () => JSON.stringify({ id: "a" }) });
      assert.equal(await validating, null);
      assert.equal(auth.getSession().user.id, "b");
    } finally { await auth.signOut(); }
  } },
  { name: "calendar requests never send old workspace data after an account switch during refresh", async fn() {
    const { auth, pending, started } = authFixture({ expired: true, pendingPath: "grant_type=refresh_token" });
    let sent = false;
    const api = createGoogleCalendarApi({
      getOwner: () => auth.getSession()?.user.id || "",
      getAccessToken: async () => (await auth.ensureFreshSession())?.access_token || "",
      fetch: async () => { sent = true; throw new Error("Must not send calendar data"); },
    });
    try {
      const rejected = assert.rejects(api.sync({ tasks: [{ id: "private-a" }] }), { code: "account-changed" });
      await started.promise;
      await auth.signIn("b@example.test", "synthetic-password");
      pending.resolve({ ok: true, text: async () => JSON.stringify({ access_token: "late-a", user: { id: "a" } }) });
      await rejected;
      assert.equal(sent, false);
      assert.equal(auth.getSession().user.id, "b");
    } finally { await auth.signOut(); }
  } },
  { name: "every calendar operation guards token acquisition and late response bodies", async fn() {
    for (const method of ["connect", "disconnect", "status", "sync"]) {
      let owner = "a", sent = 0;
      const token = deferred();
      const api = createGoogleCalendarApi({ getOwner: () => owner, getAccessToken: () => token.promise,
        fetch: async () => { sent++; return { ok: true, text: async () => "{}" }; } });
      const rejected = assert.rejects(api[method]({ tasks: [] }), { code: "account-changed" });
      owner = "b"; token.resolve("token-b");
      await rejected; assert.equal(sent, 0);

      owner = "a";
      const body = deferred(), started = deferred();
      const late = createGoogleCalendarApi({ getOwner: () => owner, getAccessToken: () => "token-a",
        fetch: async () => ({ ok: true, text: () => { started.resolve(); return body.promise; } }) });
      const lateRejected = assert.rejects(late[method]({ tasks: [] }), { code: "account-changed" });
      await started.promise; owner = "b"; body.resolve("{}");
      await lateRejected;
    }
  } },
  { name: "normal token refresh for the same account still allows calendar requests", async fn() {
    const { auth, pending, started } = authFixture({ expired: true, pendingPath: "grant_type=refresh_token" });
    let authorization;
    const api = createGoogleCalendarApi({ getOwner: () => auth.getSession()?.user.id || "",
      getAccessToken: async () => (await auth.ensureFreshSession())?.access_token || "",
      fetch: async (_url, init) => { authorization = init.headers.Authorization; return { ok: true, text: async () => "{}" }; } });
    try {
      const request = api.sync({ tasks: [] });
      await started.promise;
      pending.resolve({ ok: true, text: async () => JSON.stringify({ access_token: "new-a", user: { id: "a" } }) });
      await request;
      assert.equal(authorization, "Bearer new-a");
      assert.equal(auth.getSession().user.id, "a");
    } finally { await auth.signOut(); }
  } },
];
