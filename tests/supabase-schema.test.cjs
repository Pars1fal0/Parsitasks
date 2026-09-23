const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = [
  {
    name: "protects encrypted Google Calendar connections with per-user RLS",
    fn() {
      const source = fs.readFileSync(path.resolve(__dirname, "../database/supabase-schema.sql"), "utf8");
      assert.match(source, /create table if not exists public\.google_calendar_connections/);
      assert.match(source, /encrypted_refresh_token text not null/);
      assert.match(source, /alter table public\.google_calendar_connections enable row level security/);
      assert.match(source, /google_calendar_connections_select_own[\s\S]*auth\.uid\(\)[\s\S]*user_id/);
      assert.match(source, /revoke all on table public\.google_calendar_connections from anon/);
    },
  },
  {
    name: "allows state access only through authenticated RLS policies",
    fn() {
      const sql = fs.readFileSync(path.join(__dirname, "..", "database", "supabase-schema.sql"), "utf8");
      assert.match(sql, /to authenticated/);
      assert.match(sql, /auth\.uid\(\).*user_id/s);
      assert.match(sql, /user_key = 'auth:' \|\| \(select auth\.uid\(\)\)::text/);
      assert.doesNotMatch(sql, /to anon/);
      assert.doesNotMatch(sql, /x-rhythm-user-key/);
      assert.match(sql, /revoke all on table public\.rhythm_states from anon/);
      assert.match(sql, /grant select, insert, update, delete on table public\.rhythm_states to authenticated/);
      assert.match(sql, /grant select, delete on table public\.rhythm_state_snapshots to authenticated/);
      assert.match(sql, /set search_path = ''/);
      assert.match(sql, /revoke all on function public\.delete_parsitasks_account\(\) from public, anon, authenticated/);
      assert.match(sql, /create table if not exists public\.rhythm_state_snapshots/);
      assert.match(sql, /summary jsonb not null default '\{\}'::jsonb/);
      assert.match(sql, /jsonb_build_object\(/);
      assert.match(sql, /create trigger rhythm_states_snapshot/);
      assert.match(sql, /delete_parsitasks_account/);
      assert.match(sql, /insert into storage\.buckets/);
      assert.match(sql, /'board-images'/);
      assert.match(sql, /board_images_select_own/);
      assert.match(sql, /storage\.foldername\(name\).*auth\.uid\(\)/s);
      assert.match(sql, /'boardItems'.*old\.state -> 'boardItems'/s);
    },
  },
];
