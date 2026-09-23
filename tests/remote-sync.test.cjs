const assert = require("node:assert/strict");
const { createRemoteSync, stripTrailingSlash } = require("../src/sync/remote-sync.js");

const authConfig = {
  accessToken: "user-jwt",
  anonKey: "anon",
  enabled: true,
  supabaseUrl: "https://demo.supabase.co",
  userId: "user-123",
};

module.exports = [
  {
    name: "updates only the remote revision that was previously read",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ updated_at: "2026-07-13T10:00:01.000Z" }]),
          };
        },
      });

      await sync.pushState(
        authConfig,
        { expectedUpdatedAt: "2026-07-13T10:00:00.000Z", state: { tasks: [] } },
      );

      assert.equal(calls[0].options.method, "PATCH");
      assert.match(calls[0].url, /user_id=eq\.user-123/);
      assert.match(calls[0].url, /updated_at=eq\.2026-07-13T10%3A00%3A00\.000Z/);
      assert.equal(calls[0].options.headers.Prefer, "return=representation");
    },
  },
  {
    name: "reports a conflict when the expected remote revision no longer exists",
    async fn() {
      const sync = createRemoteSync({
        fetch: async () => ({ ok: true, status: 200, text: async () => "[]" }),
      });

      await assert.rejects(
        sync.pushState(
          authConfig,
          { expectedUpdatedAt: "2026-07-13T10:00:00.000Z", state: { tasks: [] } },
        ),
        (error) => error.code === "sync-conflict" && error.status === 409,
      );
    },
  },
  {
    name: "normalizes remote sync configuration",
    fn() {
      assert.equal(stripTrailingSlash("https://demo.supabase.co///"), "https://demo.supabase.co");
      const sync = createRemoteSync({ fetch: async () => ({ ok: true, text: async () => "[]" }) });
      assert.equal(sync.isConfigured(authConfig), true);
      assert.equal(sync.isConfigured({ ...authConfig, accessToken: "" }), false);
    },
  },
  {
    name: "pushes state through Supabase upsert endpoint",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ user_key: "me", state: { tasks: [] } }]),
          };
        },
      });

      const result = await sync.pushState(
        { ...authConfig, supabaseUrl: "https://demo.supabase.co/" },
        { clientUpdatedAt: "2026-07-01T00:00:00.000Z", schemaVersion: 7, state: { tasks: [] }, uiState: { themePreference: "dark" } },
      );

      assert.equal(result.ok, true);
      assert.equal(calls[0].url, "https://demo.supabase.co/rest/v1/rhythm_states?on_conflict=user_id");
      assert.equal(calls[0].options.method, "POST");
      assert.equal(calls[0].options.headers.apikey, "anon");
      assert.equal(calls[0].options.headers.Authorization, "Bearer user-jwt");
      assert.equal(calls[0].options.headers.Prefer, "resolution=merge-duplicates,return=representation");
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        client_updated_at: "2026-07-01T00:00:00.000Z",
        schema_version: 7,
        state: { tasks: [] },
        ui_state: { themePreference: "dark" },
        user_id: "user-123",
        user_key: "auth:user-123",
      });
    },
  },
  {
    name: "pulls state from Supabase by authenticated user",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify([
                {
                  state: { schemaVersion: 7, tasks: [{ id: "task-1" }] },
                  ui_state: { themePreference: "dark" },
                  client_updated_at: "2026-07-01T00:00:00.000Z",
                  updated_at: "2026-07-01T00:00:01.000Z",
                },
              ]),
          };
        },
      });

      const result = await sync.pullState(authConfig);

      assert.equal(result.found, true);
      assert.equal(result.state.tasks[0].id, "task-1");
      assert.match(calls[0].url, /user_id=eq\.user-123/);
      assert.equal(calls[0].options.method, "GET");
    },
  },
  {
    name: "checks Supabase connection without changing state",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ user_key: "me", client_updated_at: "2026-07-01T00:00:00.000Z" }]),
          };
        },
      });

      const result = await sync.checkConnection(authConfig);

      assert.equal(result.ok, true);
      assert.equal(result.found, true);
      assert.match(calls[0].url, /select=user_key,user_id,client_updated_at/);
      assert.equal(calls[0].options.method, "GET");
    },
  },
  {
    name: "uses authenticated identity without a custom key header",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return { ok: true, status: 200, text: async () => "[]" };
        },
      });

      await sync.pushState(
        {
          accessToken: "user-jwt",
          anonKey: "anon",
          enabled: true,
          supabaseUrl: "https://demo.supabase.co",
          userId: "user-123",
        },
        { state: { tasks: [] } },
      );

      assert.match(calls[0].url, /on_conflict=user_id/);
      assert.equal(calls[0].options.headers.Authorization, "Bearer user-jwt");
      assert.equal(calls[0].options.headers["x-rhythm-user-key"], undefined);
      assert.equal(JSON.parse(calls[0].options.body).user_id, "user-123");
    },
  },
  {
    name: "blocks synchronization when the server exposes a large clock difference",
    async fn() {
      const sync = createRemoteSync({
        fetch: async () => ({
          headers: { get: (name) => name === "date" ? "Fri, 17 Jul 2026 10:00:00 GMT" : null },
          ok: true,
          status: 200,
          text: async () => "[]",
        }),
        now: () => Date.parse("2026-07-17T12:00:00.000Z"),
      });

      await assert.rejects(
        sync.pullState(authConfig),
        (error) => error.code === "clock-skew",
      );
    },
  },
  {
    name: "lists cloud snapshots for the authenticated user",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url) => {
          calls.push(url);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ id: 7, created_at: "2026-07-25T10:00:00.000Z" }]),
          };
        },
      });
      const result = await sync.listSnapshots(authConfig, 15);
      assert.equal(result.snapshots[0].id, 7);
      assert.match(calls[0], /rhythm_state_snapshots/);
      assert.match(calls[0], /user_id=eq\.user-123/);
    },
  },
  {
    name: "loads one authenticated cloud snapshot for preview",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url) => {
          calls.push(url);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{
              id: 7,
              state: { tasks: [{ id: "preview" }] },
              summary: { tasks: 1 },
            }]),
          };
        },
      });

      const result = await sync.getSnapshot(authConfig, 7);

      assert.equal(result.snapshot.state.tasks[0].id, "preview");
      assert.match(calls[0], /select=state,schema_version,summary,created_at/);
      assert.match(calls[0], /user_id=eq\.user-123/);
    },
  },
  {
    name: "deletes the authenticated Parsitasks account through the protected RPC",
    async fn() {
      const calls = [];
      const sync = createRemoteSync({
        fetch: async (url, options) => {
          calls.push({ url, options });
          return { ok: true, status: 204, text: async () => "" };
        },
      });
      const result = await sync.deleteAccount(authConfig);
      assert.equal(result.ok, true);
      assert.match(calls[0].url, /rpc\/delete_parsitasks_account$/);
      assert.equal(calls[0].options.method, "POST");
      assert.equal(calls[0].options.headers.Authorization, "Bearer user-jwt");
    },
  },
  {
    name: "restores a selected cloud snapshot over the current remote revision",
    async fn() {
      const calls = [];
      const responses = [
        [{ state: { schemaVersion: 13, tasks: [{ id: "old" }] }, schema_version: 13, created_at: "2026-07-24T10:00:00Z" }],
        [{ state: { tasks: [{ id: "current" }] }, ui_state: {}, updated_at: "2026-07-25T10:00:00Z" }],
        [{ updated_at: "2026-07-25T10:01:00Z" }],
      ];
      const sync = createRemoteSync({
        fetch: async (url, options = {}) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(responses.shift()),
          };
        },
      });
      const result = await sync.restoreSnapshot(authConfig, 42);
      assert.equal(result.snapshot.state.tasks[0].id, "old");
      assert.equal(calls[2].options.method, "PATCH");
      assert.match(calls[2].url, /updated_at=eq\.2026-07-25T10%3A00%3A00Z/);
      assert.equal(JSON.parse(calls[2].options.body).state.tasks[0].id, "old");
    },
  },
];
