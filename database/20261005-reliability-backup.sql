begin;

-- Private, idempotent pre-migration copies. These are not exposed by PostgREST.
create schema if not exists parsitasks_ops;
revoke all on schema parsitasks_ops from public, anon, authenticated, service_role;

create table if not exists parsitasks_ops.states_before_20261005
  (like public.rhythm_states including all);
alter table parsitasks_ops.states_before_20261005 enable row level security;
revoke all on table parsitasks_ops.states_before_20261005 from public, anon, authenticated, service_role;
insert into parsitasks_ops.states_before_20261005 select * from public.rhythm_states
  on conflict do nothing;

create table if not exists parsitasks_ops.snapshots_before_20261005
  (like public.rhythm_state_snapshots including all);
alter table parsitasks_ops.snapshots_before_20261005 enable row level security;
revoke all on table parsitasks_ops.snapshots_before_20261005 from public, anon, authenticated, service_role;
insert into parsitasks_ops.snapshots_before_20261005 select * from public.rhythm_state_snapshots
  on conflict do nothing;

create table if not exists parsitasks_ops.definitions_before_20261005 (
  name text primary key,
  definition text not null,
  captured_at timestamptz not null default now()
);
alter table parsitasks_ops.definitions_before_20261005 enable row level security;
revoke all on table parsitasks_ops.definitions_before_20261005 from public, anon, authenticated, service_role;
insert into parsitasks_ops.definitions_before_20261005 (name, definition)
values ('public.snapshot_rhythm_state()', pg_get_functiondef('public.snapshot_rhythm_state()'::regprocedure))
on conflict do nothing;

commit;

select
  (select count(*) from parsitasks_ops.states_before_20261005) as saved_workspaces,
  (select count(*) from parsitasks_ops.snapshots_before_20261005) as saved_snapshots,
  (select count(*) from parsitasks_ops.definitions_before_20261005) as saved_definitions;
