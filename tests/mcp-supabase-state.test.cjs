const assert = require("node:assert/strict");

function response(status, value) {
  return new Response(value === null ? "" : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

module.exports = [
  {
    name: "MCP Supabase store reapplies a mutation after an optimistic concurrency conflict",
    async fn() {
      const { createSupabaseStateStore } = await import("../mcp/supabase-state.mjs");
      const states = [
        { state: { schemaVersion: 12, tasks: [{ id: "a" }] }, updated_at: "2026-07-19T10:00:00Z" },
        { state: { schemaVersion: 12, tasks: [{ id: "a" }, { id: "device-change" }] }, updated_at: "2026-07-19T10:00:01Z" },
      ];
      let reads = 0;
      let patches = 0;
      const fetch = async (_url, options = {}) => {
        if (!options.method || options.method === "GET") return response(200, [states[reads++]]);
        patches += 1;
        if (patches === 1) return response(200, []);
        const body = JSON.parse(options.body);
        assert.deepEqual(body.state.tasks.map((task) => task.id), ["a", "device-change", "mcp-change"]);
        assert.equal(body.schema_version, 12);
        return response(200, [{ updated_at: "2026-07-19T10:00:02Z" }]);
      };
      const store = createSupabaseStateStore({
        fetch,
        supabaseUrl: "https://example.supabase.co",
        anonKey: "anon",
        accessToken: "access",
        userId: "user-1",
      });
      let mutations = 0;
      const result = await store.mutate((state) => {
        mutations += 1;
        return {
          changed: true,
          state: { ...state, tasks: [...state.tasks, { id: "mcp-change" }] },
        };
      });

      assert.equal(result.saved, true);
      assert.equal(mutations, 2);
      assert.equal(reads, 2);
      assert.equal(patches, 2);
    },
  },
  {
    name: "MCP Supabase store writes schema 26 when the document has no version",
    async fn() {
      const { createSupabaseStateStore } = await import("../mcp/supabase-state.mjs");
      const { SCHEMA_VERSION } = require("../app/src/core/document-state.js");
      assert.equal(SCHEMA_VERSION, 26);
      let schemaVersion = null;
      const fetch = async (_url, options = {}) => {
        if (!options.method || options.method === "GET") {
          return response(200, [{ state: { tasks: [{ id: "a" }] }, updated_at: "2026-07-19T10:00:00Z" }]);
        }
        schemaVersion = JSON.parse(options.body).schema_version;
        return response(200, [{ updated_at: "2026-07-19T10:00:01Z" }]);
      };
      const store = createSupabaseStateStore({
        fetch,
        supabaseUrl: "https://example.supabase.co",
        anonKey: "anon",
        accessToken: "access",
        userId: "user-1",
      });
      const result = await store.mutate((state) => ({ changed: true, state }));

      assert.equal(result.saved, true);
      assert.equal(schemaVersion, 26);
    },
  },
  {
    name: "MCP authentication rejects missing tokens and validates bearer tokens with Supabase",
    async fn() {
      const { authenticateSupabaseRequest } = await import("../mcp/supabase-state.mjs");
      const missing = await authenticateSupabaseRequest(new Request("https://parsitasks.ru/mcp"), {
        fetch: async () => {
          throw new Error("must not fetch");
        },
        supabaseUrl: "https://example.supabase.co",
        anonKey: "anon",
      });
      const valid = await authenticateSupabaseRequest(new Request("https://parsitasks.ru/mcp", {
        headers: { Authorization: "Bearer valid-token" },
      }), {
        fetch: async (_url, options) => {
          assert.equal(options.headers.Authorization, "Bearer valid-token");
          return response(200, { id: "user-1", email: "user@example.com" });
        },
        supabaseUrl: "https://example.supabase.co",
        anonKey: "anon",
      });

      assert.equal(missing, null);
      assert.equal(valid.user.id, "user-1");
    },
  },
];
