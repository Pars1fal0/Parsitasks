begin;

create or replace function public.parsitasks_account_active()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.users where id = (select auth.uid())) $$;
revoke all on function public.parsitasks_account_active() from public, anon, authenticated;
grant execute on function public.parsitasks_account_active() to authenticated;

-- Only mutation checks take a lock; read-only listing and downloads stay read-only.
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

drop policy if exists "board_images_active_account" on storage.objects;
create policy "board_images_active_account"
on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'board-images' or (select public.parsitasks_account_active()))
with check (bucket_id <> 'board-images' or (select public.parsitasks_lock_storage_account()));

create or replace function public.delete_parsitasks_account()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
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

notify pgrst, 'reload schema';
commit;
