const assert = require("node:assert/strict");
const { createRemoteAuth } = require("../src/auth/remote-auth.js");
const { createRemoteSync } = require("../src/sync/remote-sync.js");

const requiredVariables = [
  "RHYTHM_SUPABASE_URL",
  "RHYTHM_SUPABASE_ANON_KEY",
  "RHYTHM_SUPABASE_EMAIL",
  "RHYTHM_SUPABASE_PASSWORD",
];
const missing = requiredVariables.filter((name) => !String(process.env[name] || "").trim());

if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("See README.md -> Live-проверка Supabase.");
  process.exit(2);
}

const config = {
  anonKey: process.env.RHYTHM_SUPABASE_ANON_KEY.trim(),
  supabaseUrl: process.env.RHYTHM_SUPABASE_URL.trim().replace(/\/+$/, ""),
};
const memoryStorage = {
  getItem() {
    return null;
  },
  removeItem() {},
  setItem() {},
};

async function run() {
  const auth = createRemoteAuth({
    fetch,
    getConfig: () => config,
    storage: memoryStorage,
  });
  const session = await auth.signIn(
    process.env.RHYTHM_SUPABASE_EMAIL,
    process.env.RHYTHM_SUPABASE_PASSWORD,
  );
  assert.ok(session.access_token, "Supabase Auth did not return an access token");
  assert.ok(session.user?.id, "Supabase Auth did not return a user id");

  const sync = createRemoteSync({ fetch });
  const syncConfig = {
    ...config,
    accessToken: session.access_token,
    enabled: true,
    userId: session.user.id,
  };
  const snapshot = await sync.pullState(syncConfig);
  assert.equal(snapshot.ok, true);

  if (process.env.RHYTHM_SYNC_LIVE_WRITE === "1") {
    assert.equal(snapshot.found, true, "Create one cloud save with the test account before the write check");
    const pushed = await sync.pushState(syncConfig, {
      clientUpdatedAt: new Date().toISOString(),
      expectedUpdatedAt: snapshot.updatedAt,
      schemaVersion: snapshot.row.schema_version,
      state: snapshot.state,
      uiState: snapshot.uiState,
    });
    assert.equal(pushed.ok, true);
    await assert.rejects(
      sync.pushState(syncConfig, {
        expectedUpdatedAt: snapshot.updatedAt,
        schemaVersion: snapshot.row.schema_version,
        state: snapshot.state,
        uiState: snapshot.uiState,
      }),
      (error) => error.code === "sync-conflict",
    );
    const verified = await sync.pullState(syncConfig);
    assert.deepEqual(verified.state, snapshot.state);
    console.log("live sync ok - auth, read, write, optimistic conflict and RLS");
    return;
  }

  console.log(`live sync ok - auth, read and RLS are available (saved row: ${snapshot.found ? "yes" : "no"})`);
}

run().catch((error) => {
  console.error(`live sync failed: ${error.message}`);
  if (error.status) console.error(`HTTP status: ${error.status}`);
  process.exitCode = 1;
});
