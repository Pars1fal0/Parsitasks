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
