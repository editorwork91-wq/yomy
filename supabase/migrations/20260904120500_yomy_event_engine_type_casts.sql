create or replace function public.record_message_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_username text; v_link text := '/messages';
begin
  select username into v_username from public.profiles where id = new.sender_id;
  if v_username is not null then v_link := '/messages/' || v_username; end if;
  if new.sender_id is distinct from new.receiver_id and coalesce(new.deleted_for_everyone, false) = false then
    perform public.record_yomy_event(new.receiver_id,new.sender_id,'MESSAGE_CREATED'::text,1::smallint,'messages'::text,new.id,new.id,v_link,jsonb_build_object('message_id',new.id,'sender_id',new.sender_id,'receiver_id',new.receiver_id,'media_type',coalesce(new.media_type,''),'created_at',new.created_at));
  end if;
  return new;
end;
$$;

create or replace function public.record_call_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_username text; v_link text := '/messages';
begin
  select username into v_username from public.profiles where id = new.caller_id;
  if v_username is not null then v_link := '/messages/' || v_username; end if;
  if new.callee_id is distinct from new.caller_id and new.status = 'ringing' then
    perform public.record_yomy_event(new.callee_id,new.caller_id,'CALL_INCOMING'::text,0::smallint,'call_sessions'::text,new.id,new.id,v_link,jsonb_build_object('call_id',new.id,'caller_id',new.caller_id,'callee_id',new.callee_id,'kind',new.kind,'status',new.status,'created_at',new.created_at));
  end if;
  return new;
end;
$$;

create or replace function public.record_notification_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_type text; v_priority smallint; v_link text; v_entity uuid;
begin
  v_type := case new.type
    when 'message' then 'MESSAGE_NOTIFICATION'
    when 'like' then 'LIKE_CREATED'
    when 'comment' then 'COMMENT_CREATED'
    when 'comment_like' then 'COMMENT_LIKE_CREATED'
    when 'follow' then 'FOLLOW_CREATED'
    when 'follow_request' then 'FOLLOW_REQUEST_CREATED'
    when 'mention' then 'MENTION_CREATED'
    when 'story_reply' then 'STORY_REPLY_CREATED'
    when 'story' then 'STORY_CREATED'
    when 'post' then 'POST_ACTIVITY'
    else upper(coalesce(new.type, 'NOTIFICATION'))
  end;
  v_priority := case when new.type = 'message' then 1 when new.type in ('comment','follow_request','mention','story_reply') then 2 when new.type in ('like','comment_like','follow','story','post') then 3 else 2 end;
  v_link := case when new.type = 'message' then '/messages' when new.type in ('story','story_reply') and new.story_id is not null then '/notifications?story=' || new.story_id::text when new.type in ('like','comment','comment_like','post') then '/notifications' else '/notifications' end;
  v_entity := coalesce(new.message_id,new.post_id,new.comment_id,new.story_id,new.id);
  perform public.record_yomy_event(new.user_id,new.actor_id,v_type,v_priority,'notifications'::text,new.id,v_entity,v_link,jsonb_build_object('notification_id',new.id,'notification_type',new.type,'message_id',new.message_id,'post_id',new.post_id,'comment_id',new.comment_id,'story_id',new.story_id,'created_at',new.created_at));
  return new;
exception when others then
  raise warning 'YOMY notification event recording failed: %', SQLERRM;
  return new;
end;
$$;
