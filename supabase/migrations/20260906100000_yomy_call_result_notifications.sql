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
  elsif new.status = 'ended' then
    perform public.record_yomy_event(
      new.caller_id, new.callee_id, v_type, v_priority,
      'call_sessions'::text, new.id, new.id, v_link,
      v_payload || jsonb_build_object('recipient_role','caller','result','ended')
    );
  end if;

  return new;
exception when others then
  raise warning 'YOMY call lifecycle result event failed: %', SQLERRM;
  return new;
end;
$$;

create or replace function public.enqueue_yomy_push_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_title text;
  v_body text;
  v_push_type text;
  v_call_label text;
begin
  if new.event_type not in (
    'MESSAGE_CREATED','CALL_INCOMING','CALL_ACCEPTED','CALL_DECLINED','CALL_MISSED','CALL_FAILED',
    'LIKE_CREATED','COMMENT_CREATED','COMMENT_LIKE_CREATED','FOLLOW_CREATED','FOLLOW_REQUEST_CREATED',
    'MENTION_CREATED','STORY_REPLY_CREATED','STORY_CREATED','POST_ACTIVITY','REMINDER_FIRED'
  ) then
    return new;
  end if;

  select coalesce(p.username,'Yomy') into v_title
  from public.profiles p where p.id = new.actor_id;

  v_call_label := case when lower(coalesce(new.payload->>'kind','voice')) = 'video' then 'Video call' else 'Voice call' end;
  v_push_type := case when new.event_type like 'CALL_%' then 'call_result' else new.event_type end;

  if new.event_type = 'MESSAGE_CREATED' then
    v_body := case
      when coalesce(new.payload->>'media_type','') = 'audio' then '🎙️ Voice message'
      when coalesce(new.payload->>'media_type','') = 'video' then '🎬 Video message'
      when coalesce(new.payload->>'media_type','') = 'image' then '📷 Photo'
      else 'New message'
    end;
  elsif new.event_type = 'CALL_INCOMING' then
    v_body := v_call_label;
  elsif new.event_type = 'CALL_ACCEPTED' then
    v_body := v_call_label || ' answered';
  elsif new.event_type = 'CALL_DECLINED' then
    v_body := v_call_label || ' declined';
  elsif new.event_type = 'CALL_MISSED' then
    v_body := 'Missed ' || lower(v_call_label);
  elsif new.event_type = 'CALL_FAILED' then
    v_body := v_call_label || ' failed';
  elsif new.event_type = 'REMINDER_FIRED' then
    v_title := coalesce(nullif(new.payload->>'title',''), 'Yomy reminder');
    v_body := coalesce(new.payload->>'body','Reminder');
  else
    v_body := case coalesce(new.payload->>'notification_type','')
      when 'like' then 'liked your post'
      when 'comment' then 'commented on your post'
      when 'comment_like' then 'liked your comment'
      when 'follow' then 'started following you'
      when 'follow_request' then 'sent you a follow request'
      when 'mention' then 'mentioned you'
      when 'story_reply' then 'replied to your story'
      else 'You have new activity'
    end;
  end if;

  insert into public.yomy_push_queue(event_id,recipient_id,event_type,title,body,deep_link,payload)
  values(
    new.id,
    new.recipient_id,
    new.event_type,
    coalesce(v_title,'Yomy'),
    v_body,
    new.deep_link,
    new.payload || jsonb_build_object('notification_category', v_push_type)
  )
  on conflict (event_id) do nothing;
  return new;
exception when others then
  raise warning 'YOMY push queue enqueue failed: %', SQLERRM;
  return new;
end;
$$;
