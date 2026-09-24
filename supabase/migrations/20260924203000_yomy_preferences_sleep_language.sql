begin;

alter table public.profiles add column if not exists language text not null default 'en';
alter table public.profiles add column if not exists font_scale numeric not null default 1;
alter table public.profiles add column if not exists sleep_mode_enabled boolean not null default false;
alter table public.profiles add column if not exists sleep_start time not null default '22:00';
alter table public.profiles add column if not exists sleep_end time not null default '05:00';
alter table public.profiles add column if not exists timezone_name text not null default 'UTC';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='profiles_language_check') then
    alter table public.profiles add constraint profiles_language_check check (language in ('en','ar','de','fr','es'));
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_font_scale_check') then
    alter table public.profiles add constraint profiles_font_scale_check check (font_scale >= 0.85 and font_scale <= 1.25);
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_sleep_start_check') then
    alter table public.profiles add constraint profiles_sleep_start_check check (sleep_start is not null and sleep_end is not null);
  end if;
end $$;

create or replace function public.is_user_sleeping(target_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  p public.profiles;
  local_clock time;
begin
  select * into p from public.profiles where id = target_user;
  if p.id is null or not coalesce(p.sleep_mode_enabled, false) then return false; end if;

  begin
    local_clock := (now() at time zone coalesce(nullif(p.timezone_name,''),'UTC'))::time;
  exception when others then
    local_clock := (now() at time zone 'UTC')::time;
  end;

  if p.sleep_start = p.sleep_end then
    return false;
  end if;

  if p.sleep_start < p.sleep_end then
    return local_clock >= p.sleep_start and local_clock < p.sleep_end;
  end if;

  return local_clock >= p.sleep_start or local_clock < p.sleep_end;
end;
$function$;

revoke all on function public.is_user_sleeping(uuid) from public;
grant execute on function public.is_user_sleeping(uuid) to authenticated;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and receiver_id is not null
    and receiver_id <> sender_id
    and not public.is_user_sleeping(receiver_id)
  );

drop policy if exists call_sessions_insert_caller on public.call_sessions;
create policy call_sessions_insert_caller on public.call_sessions for insert to authenticated
  with check (
    (select auth.uid()) = caller_id
    and caller_id <> callee_id
    and not public.is_user_sleeping(callee_id)
  );

notify pgrst, 'reload schema';
commit;
