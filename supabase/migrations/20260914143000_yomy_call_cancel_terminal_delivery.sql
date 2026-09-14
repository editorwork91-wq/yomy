create or replace function public.record_call_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_username text;
  v_link text := '/messages';
  v_type text;
  v_priority smallint;
  v_payload jsonb;
begin
  if old.status is not distinct from new.status then return new; end if;

  select username into v_username from public.profiles where id = new.caller_id;
  if v_username is not null then v_link := '/messages/' || v_username; end if;

  if new.status = 'active' then v_type := 'CALL_ACCEPTED'; v_priority := 1;
  elsif new.status = 'declined' then v_type := 'CALL_DECLINED'; v_priority := 1;
  elsif new.status = 'missed' then v_type := 'CALL_MISSED'; v_priority := 1;
  elsif new.status = 'failed' then v_type := 'CALL_FAILED'; v_priority := 1;
  elsif new.status = 'ended' then v_type := 'CALL_ENDED'; v_priority := 2;
  else return new;
  end if;

  v_payload := jsonb_build_object(
    'call_id', new.id,
    'caller_id', new.caller_id,
    'callee_id', new.callee_id,
    'kind', new.kind,
    'status', new.status,
    'started_at', new.started_at,
    'answered_at', new.answered_at,
    'ended_at', new.ended_at
  );

  if new.status = 'missed' then
    perform public.record_yomy_event(
      new.callee_id, new.caller_id, v_type, v_priority,
      'call_sessions'::text, new.id, new.id, v_link,
      v_payload || jsonb_build_object('recipient_role','callee','result','missed')
    );
  elsif new.status in ('active','declined','failed') then
    perform public.record_yomy_event(
      new.caller_id, new.callee_id, v_type, v_priority,
      'call_sessions'::text, new.id, new.id, v_link,
      v_payload || jsonb_build_object('recipient_role','caller','result',
        case when new.status = 'active' then 'accepted' when new.status = 'declined' then 'declined' else 'failed' end)
    );
    if new.status = 'failed' then
      perform public.record_yomy_event(
        new.callee_id, new.caller_id, v_type, v_priority,
        'call_sessions'::text, new.id, new.id, v_link,
        v_payload || jsonb_build_object('recipient_role','callee','result','failed')
      );
    end if;
  elsif new.status = 'ended' then
    perform public.record_yomy_event(
      new.caller_id, new.callee_id, v_type, v_priority,
      'call_sessions'::text, new.id, new.id, v_link,
      v_payload || jsonb_build_object('recipient_role','caller','result',
        case when new.answered_at is null then 'cancelled' else 'ended' end)
    );
    if new.answered_at is null then
      perform public.record_yomy_event(
        new.callee_id, new.caller_id, v_type, v_priority,
        'call_sessions'::text, new.id, new.id, v_link,
        v_payload || jsonb_build_object('recipient_role','callee','result','cancelled')
      );
    end if;
  end if;

  return new;
exception when others then
  raise warning 'YOMY call lifecycle result event failed: %', SQLERRM;
  return new;
end;
$$;

notify pgrst, 'reload schema';
