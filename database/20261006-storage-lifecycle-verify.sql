-- Catalog-only verification, without reading accounts or objects.
with helpers as (
  select proname, oid, prosecdef, proconfig, provolatile, pg_get_functiondef(oid) as definition
  from pg_proc where oid in (
    to_regprocedure('public.parsitasks_account_active()'),
    to_regprocedure('public.parsitasks_lock_storage_account()')
  )
)
select
  count(*) = 2 as helpers_ready,
  coalesce(bool_and(prosecdef and proconfig @> array['search_path=""']), false) as helpers_hardened,
  coalesce(bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')), false) as authenticated_allowed,
  not coalesce(bool_or(has_function_privilege('anon', oid, 'EXECUTE')), true) as anonymous_blocked,
  coalesce(bool_or(proname = 'parsitasks_account_active' and provolatile = 's'), false) as reads_without_locks,
  coalesce(bool_or(proname = 'parsitasks_lock_storage_account' and provolatile = 'v'
    and position('for key share' in lower(definition)) > 0), false) as uploads_lock_account,
  coalesce((select not polpermissive
    and position('parsitasks_account_active' in pg_get_expr(polqual, polrelid)) > 0
    and position('parsitasks_lock_storage_account' in pg_get_expr(polwithcheck, polrelid)) > 0
    from pg_policy where polname = 'board_images_active_account'
      and polrelid = 'storage.objects'::regclass), false) as restrictive_storage_guard,
  coalesce(position('for update' in lower(pg_get_functiondef(to_regprocedure('public.delete_parsitasks_account()')))) > 0, false) as deletion_locks_account
from helpers;
