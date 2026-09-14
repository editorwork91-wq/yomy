alter table public.profiles add column if not exists last_seen_at timestamptz;
create index if not exists profiles_last_seen_at_idx on public.profiles(last_seen_at desc);

create or replace function public.set_presence_heartbeat()
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $$
declare v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles
  set last_seen_at = v_now
  where id = (select auth.uid());
  return v_now;
end;
$$;
revoke all on function public.set_presence_heartbeat() from public, anon;
grant execute on function public.set_presence_heartbeat() to authenticated;

create or replace function public.record_call_chat_log()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_duration integer := 0;
  v_content text;
  v_kind text := case when lower(coalesce(new.kind, 'voice')) = 'video' then 'video' else 'voice' end;
  v_result text;
begin
  if old.status is not distinct from new.status then return new; end if;
  if new.status not in ('ended','declined','missed','failed') then return new; end if;

  if new.answered_at is not null and new.ended_at is not null then
    v_duration := greatest(0, floor(extract(epoch from (new.ended_at - new.answered_at)))::integer);
  end if;

  v_result := case
    when new.status = 'ended' and new.answered_at is not null then 'completed'
    when new.status = 'ended' then 'cancelled'
    when new.status = 'declined' then 'declined'
    when new.status = 'missed' then 'missed'
    else 'failed'
  end;
  v_content := 'YOMY_CALL_LOG|' || v_kind || '|' || v_result || '|' || v_duration::text;

  if not exists (
    select 1 from public.messages m
    where m.sender_id = new.caller_id
      and m.receiver_id = new.callee_id
      and coalesce(m.media_type, '') = 'call'
      and m.content like 'YOMY_CALL_LOG|%'
      and m.created_at >= coalesce(new.created_at, now())
  ) then
    insert into public.messages(
      sender_id, receiver_id, content, media_url, media_type,
      is_seen, is_encrypted, view_once, view_once_opened,
      deleted_for_everyone, is_request, request_accepted, reply_to_id
    ) values (
      new.caller_id, new.callee_id, v_content, '', 'call',
      false, false, false, false,
      false, false, false, null
    );
  end if;

  return new;
exception when others then
  raise warning 'YOMY call chat log failed: %', SQLERRM;
  return new;
end;
$$;

notify pgrst, 'reload schema';
