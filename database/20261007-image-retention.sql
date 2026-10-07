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
