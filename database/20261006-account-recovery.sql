begin;

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

-- Storage API must remove binaries before the account and its metadata disappear.
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
