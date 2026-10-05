const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

(async () => {
  const db = new PGlite();
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  try {
    // A disposable PostgreSQL instance: no remote URL, credentials or user records.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      insert into auth.users values ('${a}'), ('${b}');
      create table public.rhythm_states (user_id uuid primary key references auth.users, state jsonb not null,
        ui_state jsonb not null default '{}', schema_version integer not null default 1);
      create table public.rhythm_state_snapshots (id bigserial primary key, user_id uuid references auth.users,
        state jsonb not null, schema_version integer not null, summary jsonb, created_at timestamptz not null default now());
      create function public.snapshot_rhythm_state() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger snapshot_state before update on public.rhythm_states for each row execute function public.snapshot_rhythm_state();
      insert into public.rhythm_states values ('${a}', '{"tasks":[]}', '{}', 1);
    `);
    const backup = fs.readFileSync(path.resolve(__dirname, "../database/20261005-reliability-backup.sql"), "utf8");
    await db.exec(backup); await db.exec(backup);
    assert.equal((await db.query("select count(*)::int as count from parsitasks_ops.states_before_20261005")).rows[0].count, 1);
    const sql = fs.readFileSync(path.resolve(__dirname, "../database/20261005-reliability.sql"), "utf8");
    await db.exec(sql); await db.exec(sql);
    const verification = fs.readFileSync(path.resolve(__dirname, "../database/20261005-reliability-verify.sql"), "utf8");
    const verified = (await db.query(verification)).rows[0];
    assert.equal(verified.saved_workspaces, 1);
    assert.ok(Object.entries(verified).filter(([key]) => key !== "saved_workspaces").every(([, value]) => value === true));
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from parsitasks_ops.states_before_20261005"), /permission denied/);
    await assert.rejects(db.query("select public.consume_parsitasks_request()"), /permission denied/);
    await assert.rejects(db.query("select * from public.parsitasks_request_limits"), /permission denied/);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${a}', false); set role authenticated;`);
    await assert.rejects(db.query("select * from public.parsitasks_request_limits"), /permission denied/);
    const limit = await db.query("select public.consume_parsitasks_request() as result from generate_series(1, 121)");
    assert.equal(limit.rows.filter((row) => row.result.allowed).length, 120);
    assert.equal(limit.rows[120].result.allowed, false);
    assert.ok(limit.rows[120].result.retryAfter >= 1 && limit.rows[120].result.retryAfter <= 60);
    await db.exec(`select set_config('request.jwt.claim.sub', '${b}', false);`);
    assert.equal((await db.query("select public.consume_parsitasks_request() as result")).rows[0].result.allowed, true);
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role authenticated;");
    await assert.rejects(db.query("select public.consume_parsitasks_request()"), /Authentication required/);
    await db.exec(`reset role;
      update public.rhythm_states set state = '{"tasks":[{"id":"1"}]}' where user_id = '${a}';
      update public.rhythm_states set state = '{"tasks":[{"id":"2"}]}' where user_id = '${a}';
    `);
    assert.equal((await db.query("select count(*)::int as count from public.rhythm_state_snapshots")).rows[0].count, 1);
    await assert.rejects(db.query(`update public.rhythm_states set state = jsonb_build_object('large', repeat('a', 8388608)) where user_id = '${a}'`), /rhythm_state_size_limit/);
    await db.exec(`insert into public.rhythm_state_snapshots (user_id, state, schema_version, created_at)
      select '${a}', jsonb_build_object('large', repeat('a', 4000000)), 1, now() - n * interval '10 minutes'
      from generate_series(1, 6) n;
      update public.rhythm_states set state = '{"tasks":[{"id":"3"}]}' where user_id = '${a}';`);
    const retained = (await db.query("select count(*)::int as count, sum(octet_length(state::text))::int as bytes from public.rhythm_state_snapshots")).rows[0];
    assert.ok(retained.count <= 30 && retained.bytes <= 16777216);
    await db.exec(`insert into public.rhythm_state_snapshots (user_id, state, schema_version, created_at)
      select '${a}', '{}', 1, now() - (n + 100) * interval '10 minutes' from generate_series(1, 35) n;
      update public.rhythm_states set state = '{"tasks":[{"id":"4"}]}' where user_id = '${a}';`);
    assert.equal((await db.query("select count(*)::int as count from public.rhythm_state_snapshots")).rows[0].count, 30);
    console.log("SQL migration passed: idempotence, grants, synthetic account isolation, 120/min quota, state size, snapshot throttle and retention. No live accounts used.");
  } finally { await db.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
