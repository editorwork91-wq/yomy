-- YOMY: precise notification destinations.
-- Keep event persistence unchanged; only repair the navigation target.

create or replace function public.record_notification_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_type text;
  v_priority smallint;
  v_link text := '/notifications';
  v_entity uuid;
  v_actor_username text;
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

  v_priority := case
    when new.type = 'message' then 1
    when new.type in ('comment','follow_request','mention','story_reply') then 2
    when new.type in ('like','comment_like','follow','story','post') then 3
    else 2
  end;

  select username into v_actor_username
  from public.profiles
  where id = new.actor_id;

  if new.type = 'message' and v_actor_username is not null then
    v_link := '/messages/' || v_actor_username;
  elsif new.type in ('like','comment','comment_like','post') and new.post_id is not null then
    v_link := '/?post=' || new.post_id::text;
    if new.comment_id is not null then
      v_link := v_link || '&comment=' || new.comment_id::text;
    end if;
  elsif new.type in ('story','story_reply') and new.story_id is not null then
    v_link := '/notifications?story=' || new.story_id::text;
  elsif new.actor_id is not null and v_actor_username is not null then
    v_link := '/profile/' || v_actor_username;
  end if;

  v_entity := coalesce(new.message_id, new.post_id, new.comment_id, new.story_id, new.id);

  perform public.record_yomy_event(
    new.user_id,
    new.actor_id,
    v_type,
    v_priority,
    'notifications',
    new.id,
    v_entity,
    v_link,
    jsonb_build_object(
      'notification_id', new.id,
      'notification_type', new.type,
      'message_id', new.message_id,
      'post_id', new.post_id,
      'comment_id', new.comment_id,
      'story_id', new.story_id,
      'created_at', new.created_at
    )
  );

  return new;
exception when others then
  raise warning 'YOMY notification event recording failed: %', SQLERRM;
  return new;
end;
$$;

revoke all on function public.record_notification_event() from public, anon, authenticated;

-- Repair existing event destinations without creating duplicate events.
update public.notification_events e
set deep_link = case
  when n.type = 'message' and p.username is not null then '/messages/' || p.username
  when n.type in ('like','comment','comment_like','post') and n.post_id is not null then
    '/?post=' || n.post_id::text || case when n.comment_id is not null then '&comment=' || n.comment_id::text else '' end
  when n.type in ('story','story_reply') and n.story_id is not null then '/notifications?story=' || n.story_id::text
  when p.username is not null then '/profile/' || p.username
  else '/notifications'
end
from public.notifications n
left join public.profiles p on p.id = n.actor_id
where e.source_table = 'notifications'
  and e.source_id = n.id;
