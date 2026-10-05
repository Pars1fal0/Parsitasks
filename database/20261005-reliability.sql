begin;

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

-- Existing oversized rows remain readable; new writes are bounded.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rhythm_state_size_limit' and conrelid = 'public.rhythm_states'::regclass) then
    alter table public.rhythm_states add constraint rhythm_state_size_limit
      check (octet_length(state::text) <= 8388608 and octet_length(ui_state::text) <= 524288) not valid;
  end if;
end;
$$;

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
    values (old.user_id, old.state, old.schema_version,
      jsonb_build_object(
        'tasks', jsonb_array_length(coalesce(old.state -> 'tasks', '[]'::jsonb)),
        'habits', jsonb_array_length(coalesce(old.state -> 'habits', '[]'::jsonb)),
        'goals', jsonb_array_length(coalesce(old.state -> 'goals', '[]'::jsonb)),
        'boardItems', jsonb_array_length(coalesce(old.state -> 'boardItems', '[]'::jsonb)),
        'journalEntries', jsonb_array_length(coalesce(old.state -> 'journalEntries', '[]'::jsonb))
      ), now());
  end if;
  -- Retain at most 30 versions and 16 MiB of snapshot JSON per account.
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
revoke all on function public.snapshot_rhythm_state() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

