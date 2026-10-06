-- Catalog-only inspection. Does not read workspaces or call destructive RPCs.
with functions as (
  select proname, prosecdef, proconfig, oid, pg_get_functiondef(oid) as definition
    from pg_proc where oid in (
      to_regprocedure('public.restore_parsitasks_snapshot(bigint,timestamptz)'),
      to_regprocedure('public.delete_parsitasks_account()')
    )
)
select
  count(*) = 2 as both_functions_ready,
  coalesce(bool_and(prosecdef), false) as security_definer,
  coalesce(bool_and(proconfig @> array['search_path=""']), false) as fixed_search_path,
  coalesce(bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')), false) as authenticated_allowed,
  not coalesce(bool_or(has_function_privilege('anon', oid, 'EXECUTE')), true) as anonymous_blocked,
  coalesce(bool_or(proname = 'restore_parsitasks_snapshot' and position('for update' in lower(definition)) > 0
    and position('expected_updated_at' in definition) > 0
    and position('insert into public.rhythm_state_snapshots' in lower(definition)) > 0), false) as atomic_checkpoint_ready,
  coalesce(bool_or(proname = 'delete_parsitasks_account' and position('board_files_remaining' in definition) > 0
    and position('delete from storage.objects' in lower(definition)) = 0), false) as storage_cleanup_guard_ready
from functions;
