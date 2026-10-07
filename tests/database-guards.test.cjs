const assert = require("node:assert/strict");
const { checkDatabaseGuards } = require("../scripts/check-database-guards.cjs");
module.exports = [
  { name: "production preflight requires all database guards without accessing account data", async fn() {
    const ready = { migration: "2026-10-07", schemaWriteGuard: true, imageRetention: true, storageAccountGuard: true, restoreSafety: true };
    const probe = (result, status = 200) => checkDatabaseGuards({ baseUrl: "https://example.test", fetchImpl: async (url, init) => {
      if (new URL(url).origin === "https://example.test") return new Response(JSON.stringify({ supabaseUrl: "https://example.supabase.co", anonKey: "sb_publishable_public" }));
      assert.equal(new URL(url).pathname, "/rest/v1/rpc/parsitasks_release_capabilities");
      assert.equal(init.headers.Authorization, undefined); assert.equal(init.body, "{}");
      return new Response(JSON.stringify(result), { status });
    } });
    assert.deepEqual(await probe(ready), { ready: true, migration: "2026-10-07" });
    for (const name of ["schemaWriteGuard", "imageRetention", "storageAccountGuard", "restoreSafety"]) await assert.rejects(probe({ ...ready, [name]: false }), /publication refused/);
    await assert.rejects(probe({}, 404), /apply and verify/);
    await assert.rejects(probe({ ...ready, migration: "old" }), /publication refused/);
  } },
];
