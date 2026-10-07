begin;

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

commit;
notify pgrst, 'reload schema';
