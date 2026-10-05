-- Catalog-only verification; no personal content or authenticated limiter calls.
select
  to_regprocedure('public.consume_parsitasks_request()') is not null as rpc_ready,
  has_function_privilege('authenticated', 'public.consume_parsitasks_request()', 'EXECUTE') as authenticated_allowed,
  not has_function_privilege('anon', 'public.consume_parsitasks_request()', 'EXECUTE') as anonymous_blocked,
  not has_table_privilege('authenticated', 'public.parsitasks_request_limits', 'SELECT,INSERT,UPDATE,DELETE') as direct_access_blocked,
  (select relrowsecurity from pg_class where oid = 'public.parsitasks_request_limits'::regclass) as rls_enabled,
  exists (select 1 from pg_constraint where conname = 'rhythm_state_size_limit'
    and conrelid = 'public.rhythm_states'::regclass) as size_limit_ready,
  position('5 minutes' in pg_get_functiondef('public.snapshot_rhythm_state()'::regprocedure)) > 0 as snapshots_throttled,
  not has_schema_privilege('authenticated', 'parsitasks_ops', 'USAGE') as backup_private,
  (select count(*) from parsitasks_ops.states_before_20261005) as saved_workspaces;
