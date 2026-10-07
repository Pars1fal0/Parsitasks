const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

(async () => {
  const db = new PGlite();
  const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
  const as = async (role, user = "") => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
  const count = async (table) => (await db.query(`select count(*)::int as count from ${table}`)).rows[0].count;
  try {
    // Storage metadata and auth identities are synthetic; no Supabase network or real files are involved.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      grant usage on schema auth, storage, public to anon, authenticated;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id text primary key, bucket_id text references storage.buckets, name text not null, created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      grant select, insert, update, delete on storage.objects to authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as
        $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;
      insert into auth.users values ('${a}'), ('${b}');`);
    const schema = fs.readFileSync(path.resolve(__dirname, "../database/supabase-schema.sql"), "utf8");
    const migration = fs.readFileSync(path.resolve(__dirname, "../database/20261006-account-recovery.sql"), "utf8");
    await db.exec(schema); await db.exec(schema);
    await db.exec(migration); await db.exec(migration);
    const storageMigration = fs.readFileSync(path.resolve(__dirname, "../database/20261006-storage-lifecycle.sql"), "utf8");
    await db.exec(storageMigration); await db.exec(storageMigration);
    const compatibility = fs.readFileSync(path.resolve(__dirname, "../database/20261007-write-compatibility.sql"), "utf8");
    await db.exec(compatibility); await db.exec(compatibility);
    const retention = fs.readFileSync(path.resolve(__dirname, "../database/20261007-image-retention.sql"), "utf8");
    await db.exec(retention); await db.exec(retention);
    const capabilities = fs.readFileSync(path.resolve(__dirname, "../database/20261007-release-capabilities.sql"), "utf8");
    await db.exec(capabilities); await db.exec(capabilities);
    const storageVerification = fs.readFileSync(path.resolve(__dirname, "../database/20261006-storage-lifecycle-verify.sql"), "utf8");
    for (const [check, passed] of Object.entries((await db.query(storageVerification)).rows[0])) assert.equal(passed, true, `Storage lifecycle catalog check: ${check}`);
    const verification = fs.readFileSync(path.resolve(__dirname, "../database/20261006-account-recovery-verify.sql"), "utf8");
    const catalog = (await db.query(verification)).rows[0];
    for (const [check, passed] of Object.entries(catalog)) assert.equal(passed, true, `migration catalog check: ${check}`);
    for (const user of [a, b]) {
      await as("authenticated", user);
      await db.query("insert into rhythm_states (user_key, user_id, state, ui_state) values ($1, $2, $3, $4)", [`auth:${user}`, user, { tasks: [{ id: "initial" }] }, { theme: "violet" }]);
      await db.query("insert into google_drive_connections (user_id, encrypted_refresh_token) values ($1, 'synthetic-drive-token')", [user]);
      await db.query("insert into google_calendar_connections (user_id, encrypted_refresh_token) values ($1, 'synthetic-calendar-token')", [user]);
      await db.query("insert into storage.objects (id, bucket_id, name) values ($1, 'board-images', $2)", [user, `${user}/image.png`]);
      await db.query("update rhythm_states set state = $1 where user_id = $2", [{ tasks: [{ id: "latest" }] }, user]);
      await db.query("select consume_parsitasks_request()");
    }
    await as("anon");
    assert.deepEqual((await db.query("select parsitasks_release_capabilities() as readiness")).rows[0].readiness,
      { migration: "2026-10-07", schemaWriteGuard: true, imageRetention: true, storageAccountGuard: true, restoreSafety: true });
    for (const table of ["rhythm_states", "rhythm_state_snapshots", "google_drive_connections", "google_calendar_connections", "parsitasks_request_limits", "storage.objects"]) {
      await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    }
    await assert.rejects(db.query("select delete_parsitasks_account()"), /permission denied/);
    await assert.rejects(db.query("select restore_parsitasks_snapshot(1, now())"), /permission denied/);
    await assert.rejects(db.query("select parsitasks_account_active()"), /permission denied/);
    await assert.rejects(db.query("select parsitasks_lock_storage_account()"), /permission denied/);

    await as("authenticated", a);
    await db.query("update rhythm_states set state = $1, schema_version = 26", [{ schemaVersion: 26, tasks: [{ id: "latest" }] }]);
    await assert.rejects(db.query("update rhythm_states set state = $1, schema_version = 20", [{ schemaVersion: 20, tasks: [] }]), /parsitasks_client_outdated/);
    await assert.rejects(db.query("update rhythm_states set state = $1", [{ schemaVersion: 20, tasks: [] }]), /versions disagree/);
    await assert.rejects(db.query("update rhythm_states set state = $1", [{ schemaVersion: "26", tasks: [] }]), /Invalid workspace schema/);
    assert.equal((await db.query("select schema_version from rhythm_states")).rows[0].schema_version, 26);
    await db.query("insert into storage.objects(id, bucket_id, name, created_at) values ('expired', 'board-images', $1, now() - interval '31 days')", [`${a}/expired.png`]);
    await db.query("insert into storage.objects(id, bucket_id, name, created_at) values ('protected', 'board-images', $1, now() - interval '31 days')", [`${a}/protected.png`]);
    await db.query("update rhythm_states set state = $1", [{ schemaVersion: 26, tasks: [{ id: "latest" }], boardItems: [{ remotePath: `${a}/protected.png` }] }]);
    assert.deepEqual((await db.query("select claim_parsitasks_unused_images() as paths")).rows[0].paths, [`${a}/expired.png`]);
    await assert.rejects(db.query("update rhythm_states set state = $1", [{ schemaVersion: 26, boardItems: [{ remotePath: `${a}/expired.png` }] }]), /parsitasks_image_expired/);
    await assert.rejects(db.query("insert into storage.objects(id, bucket_id, name) values ('resurrected', 'board-images', $1)", [`${a}/expired.png`]), /row-level security/);
    await db.query("delete from storage.objects where id = 'expired'");
    await as("postgres");
    await db.query("insert into rhythm_state_snapshots(user_id, state, schema_version) values ($1, $2, 26)", [a, { schemaVersion: 26, boardItems: [{ remotePath: `${a}/protected.png` }] }]);
    await as("authenticated", a);
    await db.query("update rhythm_states set state = $1", [{ schemaVersion: 26, tasks: [{ id: "latest" }] }]);
    assert.deepEqual((await db.query("select claim_parsitasks_unused_images() as paths")).rows[0].paths, [], "retained snapshots protect images even after board deletion");
    await as("postgres");
    await db.query("delete from rhythm_state_snapshots where state ? 'boardItems' and user_id = $1", [a]);
    await as("authenticated", a);
    assert.deepEqual((await db.query("select claim_parsitasks_unused_images() as paths")).rows[0].paths, [`${a}/protected.png`]);
    await db.query("delete from storage.objects where id = 'protected'");
    assert.equal((await db.query("select parsitasks_account_active() as active")).rows[0].active, true);
    await db.exec("begin read only");
    assert.equal(await count("storage.objects"), 1, "listing remains possible in read-only transactions");
    await db.exec("commit");
    for (const table of ["rhythm_states", "rhythm_state_snapshots", "google_drive_connections", "google_calendar_connections", "storage.objects"]) assert.equal(await count(table), 1, `${table} exposes only the current account`);
    await assert.rejects(db.query("select * from parsitasks_request_limits"), /permission denied/);
    assert.equal((await db.query("select user_id from rhythm_states")).rows[0].user_id, a);
    assert.equal((await db.query("select * from rhythm_states where user_id = $1", [b])).rows.length, 0);
    assert.equal((await db.query("update rhythm_states set state = '{}' where user_id = $1 returning *", [b])).rows.length, 0);
    assert.equal((await db.query("delete from rhythm_state_snapshots where user_id = $1 returning *", [b])).rows.length, 0);
    await assert.rejects(db.query("update rhythm_states set user_id = $1 where user_id = $2", [b, a]), /row-level security|duplicate key/);
    await assert.rejects(db.query("update rhythm_states set user_key = 'foreign-key' where user_id = $1", [a]), /row-level security/);
    for (const table of ["google_drive_connections", "google_calendar_connections"]) {
      assert.equal((await db.query(`update ${table} set encrypted_refresh_token = 'attack' where user_id = $1 returning *`, [b])).rows.length, 0);
      assert.equal((await db.query(`delete from ${table} where user_id = $1 returning *`, [b])).rows.length, 0);
    }
    await assert.rejects(db.query("insert into storage.objects (id, bucket_id, name) values ('foreign', 'board-images', $1)", [`${b}/attack.png`]), /row-level security/);
    await assert.rejects(db.query("update storage.objects set name = $1 where id = $2", [`${b}/moved.png`, a]), /row-level security/);
    assert.equal((await db.query("delete from storage.objects where id = $1 returning *", [b])).rows.length, 0);
    await assert.rejects(db.query("insert into rhythm_state_snapshots (user_id, state, schema_version) values ($1, '{}', 1)", [a]), /permission denied/);
    await assert.rejects(db.query("select snapshot_rhythm_state()"), /permission denied/);

    const initial = (await db.query("select id from rhythm_state_snapshots")).rows[0].id;
    let row = (await db.query("select * from rhythm_states")).rows[0];
    const restored = (await db.query("select restore_parsitasks_snapshot($1, $2) as result", [initial, row.updated_at])).rows[0].result;
    assert.equal(restored.row.state.tasks[0].id, "initial");
    assert.deepEqual(restored.row.ui_state, { theme: "violet" }, "restoring workspace data preserves current preferences");
    assert.equal(await count("rhythm_state_snapshots"), 2, "restore checkpoints the current state despite the automatic throttle");
    const latest = (await db.query("select id from rhythm_state_snapshots where state->'tasks'->0->>'id' = 'latest'")).rows[0].id;
    row = (await db.query("select * from rhythm_states")).rows[0];
    await db.query("select restore_parsitasks_snapshot($1, $2)", [latest, row.updated_at]);
    assert.equal(await count("rhythm_state_snapshots"), 3, "a second immediate restore also preserves its predecessor");
    await assert.rejects(db.query("select restore_parsitasks_snapshot($1, $2)", [initial, row.updated_at]), /Remote state changed/);
    assert.equal((await db.query("select state from rhythm_states")).rows[0].state.tasks[0].id, "latest");
    const beforeFailedRestore = await count("rhythm_state_snapshots");
    row = (await db.query("select * from rhythm_states")).rows[0];
    await assert.rejects(db.query("select restore_parsitasks_snapshot(999999, $1)", [row.updated_at]), /Snapshot unavailable/);
    assert.equal(await count("rhythm_state_snapshots"), beforeFailedRestore);
    await as("authenticated", b);
    const bRow = (await db.query("select * from rhythm_states")).rows[0];
    await assert.rejects(db.query("select restore_parsitasks_snapshot($1, $2)", [initial, bRow.updated_at]), /Snapshot unavailable/);

    await as("authenticated", a);
    await assert.rejects(db.query("select delete_parsitasks_account()"), /board_files_remaining/);
    assert.equal(await count("rhythm_states"), 1, "account remains until Storage API cleanup completes");
    // Only this local metadata fixture simulates the Storage API deletion already covered by client tests.
    await db.query("delete from storage.objects where id = $1", [a]);
    await db.query("select delete_parsitasks_account()");
    for (const table of ["rhythm_states", "rhythm_state_snapshots", "google_drive_connections", "google_calendar_connections", "storage.objects"]) assert.equal(await count(table), 0);
    assert.equal((await db.query("select parsitasks_account_active() as active")).rows[0].active, false, "a stale token does not imply a live account");
    assert.equal((await db.query("select parsitasks_lock_storage_account() as active")).rows[0].active, false);
    await assert.rejects(db.query("insert into storage.objects (id, bucket_id, name) values ('stale-upload', 'board-images', $1)", [`${a}/stale.png`]), /row-level security/);
    await db.query("select delete_parsitasks_account()");
    await as("postgres");
    await db.query("insert into storage.objects (id, bucket_id, name) values ('orphan', 'board-images', $1)", [`${a}/orphan.png`]);
    await db.exec("create policy synthetic_permissive on storage.objects for all to authenticated using (true) with check (true)");
    await as("authenticated", a);
    assert.equal(await count("storage.objects"), 0, "the restrictive guard blocks a stale token even alongside another permissive policy");
    assert.equal((await db.query("update storage.objects set name = $1 where id = 'orphan' returning *", [`${a}/changed.png`])).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects where id = 'orphan' returning *")).rows.length, 0);
    await assert.rejects(db.query("insert into storage.objects (id, bucket_id, name) values ('stale-bypass', 'board-images', $1)", [`${a}/bypass.png`]), /row-level security/);
    await as("postgres");
    await db.exec("drop policy synthetic_permissive on storage.objects; delete from storage.objects where id = 'orphan'");
    await as("postgres");
    assert.equal(await count("auth.users"), 1);
    for (const table of ["rhythm_states", "rhythm_state_snapshots", "google_drive_connections", "google_calendar_connections", "parsitasks_request_limits", "storage.objects"]) assert.equal(await count(table), 1, `account B survives deletion of A: ${table}`);
    console.log("Full schema isolation passed: synthetic accounts, RLS, OAuth rows, Storage paths/stale tokens, atomic restore/checkpoints/conflicts and guarded account deletion. Production was not accessed.");
  } finally { await db.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
