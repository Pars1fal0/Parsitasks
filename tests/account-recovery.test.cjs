const assert = require("node:assert/strict");
const { createRemoteSync } = require("../app/src/sync/remote-sync.js");
const config = { enabled: true, supabaseUrl: "https://example.supabase.co", userId: "test-user", anonKey: "public", accessToken: "test-token" };
const response = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });

module.exports = [
  { name: "account deletion enumerates nested storage and removes binaries before deleting the user", async fn() {
    const calls = [];
    const sync = createRemoteSync({ fetch: async (url, init) => {
      const payload = JSON.parse(init.body); calls.push({ url, init, payload });
      if (url.includes("/list/")) return response(payload.prefix === "test-user" ? [{ id: "file-1", name: "one.png" }, { id: null, name: "nested" }] : [{ id: "file-2", name: "two.png" }]);
      return response(null);
    } });
    await sync.deleteAccount(config);
    assert.deepEqual(calls[2].payload.prefixes, ["test-user/one.png", "test-user/nested/two.png"]);
    assert.equal(calls[2].init.method, "DELETE");
    assert.match(calls[3].url, /rpc\/delete_parsitasks_account$/);
    assert.ok(calls.every((call) => call.init.headers.Authorization === "Bearer test-token"));
  } },
  { name: "account cleanup finishes all pagination before removing any files", async fn() {
    const calls = [];
    const sync = createRemoteSync({ fetch: async (url, init) => {
      const payload = JSON.parse(init.body); calls.push({ url, init, payload });
      if (url.includes("/list/")) return response(payload.offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, name: `${i}.png` })) : [{ id: "last", name: "last.png" }]);
      return response(null);
    } });
    await sync.deleteAccount(config);
    assert.equal(calls[1].payload.offset, 100);
    assert.equal(calls[2].payload.prefixes.length, 100);
    assert.deepEqual(calls[3].payload.prefixes, ["test-user/last.png"]);
    assert.match(calls[4].url, /delete_parsitasks_account$/);
  } },
  { name: "account cleanup stops before account deletion on storage errors or unsafe paths", async fn() {
    for (const data of [{ error: "unavailable" }, [{ id: "file", name: "../foreign.png" }], [{ id: "file", name: ".." }], [{ name: "file.png" }]]) {
      const calls = [];
      const sync = createRemoteSync({ fetch: async (url) => { calls.push(url); return response(data, Array.isArray(data) ? 200 : 503); } });
      await assert.rejects(sync.deleteAccount(config));
      assert.equal(calls.length, 1);
      assert.ok(!calls.some((url) => url.includes("/rpc/")));
    }
    const calls = [];
    const sync = createRemoteSync({ fetch: async (url) => {
      calls.push(url); return url.includes("/list/") ? response([{ id: "id", name: "file.png" }]) : response({ error: "delete failed" }, 503);
    } });
    await assert.rejects(sync.deleteAccount(config));
    assert.equal(calls.length, 2);
    assert.ok(!calls.some((url) => url.includes("/rpc/")));
  } },
  { name: "restoring conflicts never falls back to an unprotected workspace overwrite", async fn() {
    for (const code of ["40001", "PGRST202"]) {
      const calls = [];
      const sync = createRemoteSync({ fetch: async (url, init) => {
        calls.push({ url, init });
        return calls.length < 3 ? response([{ state: {}, updated_at: "2026-10-06T12:00:00Z" }]) : response({ code, message: "RPC failed" }, 409);
      } });
      await assert.rejects(sync.restoreSnapshot(config, 1), (error) => code !== "40001" || error.code === "sync-conflict");
      assert.equal(calls.length, 3);
      assert.ok(calls.every((call) => call.init.method !== "PATCH"));
    }
  } },
  { name: "newer workspace schemas cannot be read, restored or uploaded by an outdated client", async fn() {
    for (const row of [{ state: {}, schema_version: 999 }, { state: { schemaVersion: 999 } }]) {
      for (const operation of ["pullState", "getSnapshot", "restoreSnapshot"]) {
        const calls = [];
        const sync = createRemoteSync({ fetch: async (url, init = {}) => { calls.push(init); return response([{ ...row, updated_at: "2026-10-06T12:00:00Z" }]); } });
        await assert.rejects(sync[operation](config, "42"), (error) => error.code === "client-outdated");
        assert.equal(calls.length, 1);
        assert.ok(calls.every((call) => !call.method || call.method === "GET"));
      }
      let called = false;
      const sync = createRemoteSync({ fetch: async () => { called = true; return response([]); } });
      await assert.rejects(sync.pushState(config, { state: row.state, schemaVersion: row.schema_version }), (error) => error.code === "client-outdated");
      assert.equal(called, false);
    }
  } },
];
