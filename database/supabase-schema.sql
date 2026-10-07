create table if not exists public.rhythm_states (
  user_key text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  state jsonb not null,
  ui_state jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_rhythm_states_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rhythm_states_updated_at on public.rhythm_states;
create trigger rhythm_states_updated_at
before update on public.rhythm_states
for each row
execute function public.set_rhythm_states_updated_at();

create index if not exists rhythm_states_client_updated_at_idx
on public.rhythm_states (client_updated_at desc);

create or replace function public.guard_parsitasks_schema_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  document_version integer;
  previous_version integer;
begin
  if new.schema_version < 1 then
    raise exception 'Invalid workspace schema' using errcode = '22023';
  end if;
  if new.state ? 'schemaVersion' then
    if jsonb_typeof(new.state -> 'schemaVersion') <> 'number'
      or (new.state ->> 'schemaVersion') !~ '^[0-9]{1,8}$' then
      raise exception 'Invalid workspace schema' using errcode = '22023';
    end if;
    document_version := (new.state ->> 'schemaVersion')::integer;
    if document_version <> new.schema_version then
      raise exception 'Workspace schema versions disagree' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then
    previous_version := old.schema_version;
    if (old.state ->> 'schemaVersion') ~ '^[0-9]{1,8}$' then
      previous_version := greatest(previous_version, (old.state ->> 'schemaVersion')::integer);
    end if;
    if new.schema_version < previous_version then
      raise exception 'parsitasks_client_outdated: update the application before saving'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_parsitasks_schema_write() from public, anon, authenticated;
drop trigger if exists parsitasks_schema_write_guard on public.rhythm_states;
create trigger parsitasks_schema_write_guard
before insert or update on public.rhythm_states
for each row execute function public.guard_parsitasks_schema_write();

alter table public.rhythm_states
add column if not exists user_id uuid references auth.users (id) on delete cascade;

drop index if exists public.rhythm_states_user_id_idx;
create unique index rhythm_states_user_id_idx
on public.rhythm_states (user_id);

alter table public.rhythm_states enable row level security;

drop policy if exists "rhythm_states_select_own_key" on public.rhythm_states;
drop policy if exists "rhythm_states_insert_own_key" on public.rhythm_states;

drop policy if exists "rhythm_states_select_authenticated" on public.rhythm_states;
create policy "rhythm_states_select_authenticated"
on public.rhythm_states
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "rhythm_states_insert_authenticated" on public.rhythm_states;
create policy "rhythm_states_insert_authenticated"
on public.rhythm_states
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and user_key = 'auth:' || (select auth.uid())::text
);

drop policy if exists "rhythm_states_update_authenticated" on public.rhythm_states;
create policy "rhythm_states_update_authenticated"
on public.rhythm_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and user_key = 'auth:' || (select auth.uid())::text
);

drop policy if exists "rhythm_states_update_own_key" on public.rhythm_states;

drop policy if exists "rhythm_states_delete_authenticated" on public.rhythm_states;
create policy "rhythm_states_delete_authenticated"
on public.rhythm_states
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.rhythm_states from anon;
revoke all on table public.rhythm_states from authenticated;
grant select, insert, update, delete on table public.rhythm_states to authenticated;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted_refresh_token text not null,
  calendar_id text not null default 'primary',
  direction text not null default 'export' check (direction in ('export', 'two-way')),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);

drop trigger if exists google_calendar_connections_updated_at on public.google_calendar_connections;
create trigger google_calendar_connections_updated_at
before update on public.google_calendar_connections
for each row
execute function public.set_rhythm_states_updated_at();

alter table public.google_calendar_connections enable row level security;

drop policy if exists "google_calendar_connections_select_own" on public.google_calendar_connections;
create policy "google_calendar_connections_select_own"
on public.google_calendar_connections
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "google_calendar_connections_insert_own" on public.google_calendar_connections;
create policy "google_calendar_connections_insert_own"
on public.google_calendar_connections
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "google_calendar_connections_update_own" on public.google_calendar_connections;
create policy "google_calendar_connections_update_own"
on public.google_calendar_connections
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "google_calendar_connections_delete_own" on public.google_calendar_connections;
create policy "google_calendar_connections_delete_own"
on public.google_calendar_connections
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.google_calendar_connections from anon;
revoke all on table public.google_calendar_connections from authenticated;
grant select, insert, update, delete on table public.google_calendar_connections to authenticated;

create table if not exists public.google_drive_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted_refresh_token text not null,
  folder_id text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.google_drive_connections enable row level security;

drop policy if exists "google_drive_connections_select_own" on public.google_drive_connections;
create policy "google_drive_connections_select_own" on public.google_drive_connections
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "google_drive_connections_insert_own" on public.google_drive_connections;
create policy "google_drive_connections_insert_own" on public.google_drive_connections
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "google_drive_connections_update_own" on public.google_drive_connections;
create policy "google_drive_connections_update_own" on public.google_drive_connections
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "google_drive_connections_delete_own" on public.google_drive_connections;
create policy "google_drive_connections_delete_own" on public.google_drive_connections
for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.google_drive_connections from anon;
revoke all on table public.google_drive_connections from authenticated;
grant select, insert, update, delete on table public.google_drive_connections to authenticated;

create table if not exists public.rhythm_state_snapshots (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null,
  schema_version integer not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.rhythm_state_snapshots
add column if not exists summary jsonb not null default '{}'::jsonb;

create index if not exists rhythm_state_snapshots_user_created_idx
on public.rhythm_state_snapshots (user_id, created_at desc);

alter table public.rhythm_state_snapshots enable row level security;

drop policy if exists "rhythm_state_snapshots_select_authenticated" on public.rhythm_state_snapshots;
create policy "rhythm_state_snapshots_select_authenticated"
on public.rhythm_state_snapshots
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "rhythm_state_snapshots_delete_authenticated" on public.rhythm_state_snapshots;
create policy "rhythm_state_snapshots_delete_authenticated"
on public.rhythm_state_snapshots
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.rhythm_state_snapshots from anon;
revoke all on table public.rhythm_state_snapshots from authenticated;
grant select, delete on table public.rhythm_state_snapshots to authenticated;
revoke all on sequence public.rhythm_state_snapshots_id_seq from anon, authenticated;

create or replace function public.snapshot_rhythm_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is distinct from new.state and not exists (
    select 1 from public.rhythm_state_snapshots
    where user_id = old.user_id and created_at > now() - interval '5 minutes'
  ) then
    insert into public.rhythm_state_snapshots (user_id, state, schema_version, summary, created_at)
    values (
      old.user_id,
      old.state,
      old.schema_version,
      jsonb_build_object(
        'tasks', jsonb_array_length(coalesce(old.state -> 'tasks', '[]'::jsonb)),
        'habits', jsonb_array_length(coalesce(old.state -> 'habits', '[]'::jsonb)),
        'goals', jsonb_array_length(coalesce(old.state -> 'goals', '[]'::jsonb)),
        'boardItems', jsonb_array_length(coalesce(old.state -> 'boardItems', '[]'::jsonb)),
        'journalEntries', jsonb_array_length(coalesce(old.state -> 'journalEntries', '[]'::jsonb)),
        'nutritionMeals', jsonb_array_length(coalesce(old.state -> 'nutritionMeals', '[]'::jsonb))
      ),
      now()
    );

  end if;
  delete from public.rhythm_state_snapshots where id in (
    select id from (
      select id, row_number() over (order by created_at desc, id desc) as position,
        sum(octet_length(state::text)) over (order by created_at desc, id desc) as retained_bytes
      from public.rhythm_state_snapshots where user_id = old.user_id
    ) retained where position > 30 or retained_bytes > 16777216
  );
  return new;
end;
$$;

drop trigger if exists rhythm_states_snapshot on public.rhythm_states;
create trigger rhythm_states_snapshot
after update on public.rhythm_states
for each row
execute function public.snapshot_rhythm_state();

revoke all on function public.set_rhythm_states_updated_at() from public, anon, authenticated;
revoke all on function public.snapshot_rhythm_state() from public, anon, authenticated;

create or replace function public.delete_parsitasks_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  -- Upload policies hold KEY SHARE on this row; wait before checking remaining files.
  perform id from auth.users where id = current_user_id for update;
  if not found then return; end if;
  if exists (
    select 1 from storage.objects where bucket_id = 'board-images'
      and (storage.foldername(name))[1] = current_user_id::text
  ) then
    raise exception 'board_files_remaining' using errcode = '55000';
  end if;
  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_parsitasks_account() from public, anon, authenticated;
grant execute on function public.delete_parsitasks_account() to authenticated;

create or replace function public.parsitasks_account_active()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.users where id = (select auth.uid())) $$;
revoke all on function public.parsitasks_account_active() from public, anon, authenticated;
grant execute on function public.parsitasks_account_active() to authenticated;

create or replace function public.parsitasks_lock_storage_account()
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform id from auth.users where id = (select auth.uid()) for key share;
  return found;
end;
$$;
revoke all on function public.parsitasks_lock_storage_account() from public, anon, authenticated;
grant execute on function public.parsitasks_lock_storage_account() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-images',
  'board-images',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "board_images_select_own" on storage.objects;
-- A still-valid token from a deleted account must not access or recreate board files.
drop policy if exists "board_images_active_account" on storage.objects;
create policy "board_images_active_account"
on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'board-images' or (select public.parsitasks_account_active()))
with check (bucket_id <> 'board-images' or (select public.parsitasks_lock_storage_account()));

create policy "board_images_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'board-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "board_images_insert_own" on storage.objects;
create policy "board_images_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'board-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "board_images_update_own" on storage.objects;
create policy "board_images_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'board-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'board-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "board_images_delete_own" on storage.objects;
create policy "board_images_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'board-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Atomic per-account limits shared by all Worker instances.
create table if not exists public.parsitasks_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 121)
);
alter table public.parsitasks_request_limits enable row level security;
revoke all on table public.parsitasks_request_limits from public, anon, authenticated;

create or replace function public.consume_parsitasks_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  request_time timestamptz := clock_timestamp();
  current_window timestamptz := date_trunc('minute', request_time);
  used integer;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.parsitasks_request_limits (user_id, window_start, request_count)
  values (owner_id, current_window, 1)
  on conflict (user_id) do update
  set window_start = greatest(parsitasks_request_limits.window_start, excluded.window_start),
      request_count = case
        when parsitasks_request_limits.window_start >= excluded.window_start
        then least(parsitasks_request_limits.request_count + 1, 121) else 1 end
  returning request_count into used;
  return jsonb_build_object('allowed', used <= 120, 'retryAfter',
    greatest(1, ceil(extract(epoch from current_window + interval '1 minute' - request_time))::integer));
end;
$$;
revoke all on function public.consume_parsitasks_request() from public, anon, authenticated;
grant execute on function public.consume_parsitasks_request() to authenticated;

create or replace function public.restore_parsitasks_snapshot(snapshot_id bigint, expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_row public.rhythm_states%rowtype;
  selected_snapshot public.rhythm_state_snapshots%rowtype;
  checkpoint_summary jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if expected_updated_at is null then raise exception 'Expected revision required' using errcode = '22023'; end if;
  select * into current_row from public.rhythm_states where user_id = owner_id for update;
  if not found then raise exception 'Workspace missing' using errcode = 'P0002'; end if;
  if current_row.updated_at is distinct from expected_updated_at then
    raise exception 'Remote state changed while restoring' using errcode = '40001';
  end if;
  select * into selected_snapshot from public.rhythm_state_snapshots
    where id = snapshot_id and user_id = owner_id;
  if not found then raise exception 'Snapshot unavailable' using errcode = 'P0002'; end if;
  if octet_length(current_row.state::text) > 8388608 then
    raise exception 'Export oversized workspace before restoring' using errcode = '54000';
  end if;

  if current_row.state is distinct from selected_snapshot.state then
    select coalesce(jsonb_object_agg(key, jsonb_array_length(value)), '{}'::jsonb)
      into checkpoint_summary from jsonb_each(current_row.state)
      where key in ('tasks', 'habits', 'goals', 'boardItems', 'journalEntries', 'nutritionMeals')
        and jsonb_typeof(value) = 'array';
    -- Explicit restores always retain the previous workspace, even within the automatic five-minute window.
    insert into public.rhythm_state_snapshots (user_id, state, schema_version, summary)
      values (owner_id, current_row.state, current_row.schema_version, checkpoint_summary);
  end if;
  update public.rhythm_states set state = selected_snapshot.state,
    schema_version = selected_snapshot.schema_version, client_updated_at = clock_timestamp()
    where user_id = owner_id returning * into current_row;
  return jsonb_build_object('snapshot', to_jsonb(selected_snapshot), 'row', to_jsonb(current_row));
end;
$$;
revoke all on function public.restore_parsitasks_snapshot(bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.restore_parsitasks_snapshot(bigint, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- Existing oversized rows remain readable; new writes are bounded.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rhythm_state_size_limit' and conrelid = 'public.rhythm_states'::regclass) then
    alter table public.rhythm_states add constraint rhythm_state_size_limit
      check (octet_length(state::text) <= 8388608 and octet_length(ui_state::text) <= 524288) not valid;
  end if;
end;
$$;

begin;

-- Claims remain as tombstones so a long-offline client cannot restore a deleted file reference.
create table if not exists public.parsitasks_image_gc (
  user_id uuid not null references auth.users(id) on delete cascade,
  path text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.parsitasks_image_gc enable row level security;
revoke all on public.parsitasks_image_gc from public, anon, authenticated;

create or replace function public.claim_parsitasks_unused_images()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  paths jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  perform id from auth.users where id = owner_id for key share;
  if not found then raise exception 'Account unavailable' using errcode = '28000'; end if;
  perform user_id from public.rhythm_states where user_id = owner_id for update;
  if not found then return '[]'::jsonb; end if;
  with candidates as (
    select o.name from storage.objects o
    where o.bucket_id = 'board-images'
      and (storage.foldername(o.name))[1] = owner_id::text
      and o.created_at < now() - interval '30 days'
      and not exists (
        select 1 from public.rhythm_states s,
          lateral jsonb_array_elements(case when jsonb_typeof(s.state -> 'boardItems') = 'array'
            then s.state -> 'boardItems' else '[]'::jsonb end) item
        where s.user_id = owner_id and item ->> 'remotePath' = o.name
      )
      and not exists (
        select 1 from public.rhythm_state_snapshots s,
          lateral jsonb_array_elements(case when jsonb_typeof(s.state -> 'boardItems') = 'array'
            then s.state -> 'boardItems' else '[]'::jsonb end) item
        where s.user_id = owner_id and item ->> 'remotePath' = o.name
      )
    order by o.name limit 100
  ), claims as (
    insert into public.parsitasks_image_gc(user_id, path)
      select owner_id, name from candidates
      on conflict (path) do update set user_id = excluded.user_id
      returning path
  ) select coalesce(jsonb_agg(path order by path), '[]'::jsonb) into paths from claims;
  return paths;
end;
$$;
revoke all on function public.claim_parsitasks_unused_images() from public, anon, authenticated;
grant execute on function public.claim_parsitasks_unused_images() to authenticated;

create or replace function public.guard_parsitasks_image_references()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(new.state -> 'boardItems') = 'array'
      then new.state -> 'boardItems' else '[]'::jsonb end) item
    join public.parsitasks_image_gc gc on gc.path = item ->> 'remotePath'
  ) then
    raise exception 'parsitasks_image_expired: upload this image again' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_parsitasks_image_references() from public, anon, authenticated;
drop trigger if exists parsitasks_image_reference_guard on public.rhythm_states;
create trigger parsitasks_image_reference_guard before insert or update on public.rhythm_states
for each row execute function public.guard_parsitasks_image_references();

create or replace function public.parsitasks_image_writable(object_path text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null or (storage.foldername(object_path))[1] <> owner_id::text then return false; end if;
  -- Serialize uploads and collection against the same workspace row.
  perform user_id from public.rhythm_states where user_id = owner_id for update;
  return not exists (select 1 from public.parsitasks_image_gc where path = object_path);
end;
$$;
revoke all on function public.parsitasks_image_writable(text) from public, anon, authenticated;
grant execute on function public.parsitasks_image_writable(text) to authenticated;
drop policy if exists "board_images_gc_insert" on storage.objects;
create policy "board_images_gc_insert" on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'board-images' or public.parsitasks_image_writable(name));
drop policy if exists "board_images_gc_update" on storage.objects;
create policy "board_images_gc_update" on storage.objects as restrictive for update to authenticated
using (true) with check (bucket_id <> 'board-images' or public.parsitasks_image_writable(name));

commit;
notify pgrst, 'reload schema';

begin;
-- Public deployment readiness only: no users, rows, file paths or provider secrets.
create or replace function public.parsitasks_release_capabilities()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'migration', '2026-10-07',
    'schemaWriteGuard', exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.rhythm_states'::regclass
        and tgname = 'parsitasks_schema_write_guard' and tgenabled = 'O'
        and tgfoid = pg_catalog.to_regprocedure('public.guard_parsitasks_schema_write()')
    ),
    'imageRetention', exists (
      select 1 from pg_catalog.pg_trigger where tgrelid = 'public.rhythm_states'::regclass
        and tgname = 'parsitasks_image_reference_guard' and tgenabled = 'O'
        and tgfoid = pg_catalog.to_regprocedure('public.guard_parsitasks_image_references()')
    ) and pg_catalog.to_regprocedure('public.claim_parsitasks_unused_images()') is not null
      and (select count(*) = 2 from pg_catalog.pg_policy where polrelid = 'storage.objects'::regclass
        and polname in ('board_images_gc_insert', 'board_images_gc_update') and not polpermissive),
    'storageAccountGuard', exists (
      select 1 from pg_catalog.pg_policy where polrelid = 'storage.objects'::regclass
        and polname = 'board_images_active_account' and not polpermissive
    ) and pg_catalog.to_regprocedure('public.parsitasks_lock_storage_account()') is not null,
    'restoreSafety', pg_catalog.to_regprocedure('public.restore_parsitasks_snapshot(bigint,timestamp with time zone)') is not null
  );
$$;
revoke all on function public.parsitasks_release_capabilities() from public, anon, authenticated;
grant execute on function public.parsitasks_release_capabilities() to anon, authenticated;
commit;
notify pgrst, 'reload schema';
