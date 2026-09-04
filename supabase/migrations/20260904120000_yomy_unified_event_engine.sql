create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  priority smallint not null default 2 check (priority between 0 and 3),
  source_table text not null check (source_table in ('messages','notifications','call_sessions')),
  source_id uuid not null,
  entity_id uuid,
  deep_link text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_events_source_unique
  on public.notification_events(source_table, source_id, recipient_id, event_type);
create index if not exists notification_events_recipient_created_idx
  on public.notification_events(recipient_id, created_at desc);
create index if not exists notification_events_recipient_priority_idx
  on public.notification_events(recipient_id, priority, created_at desc);

alter table public.notification_events enable row level security;
drop policy if exists notification_events_select_own on public.notification_events;
create policy notification_events_select_own on public.notification_events for select to authenticated using (recipient_id = auth.uid());
drop policy if exists notification_events_insert_none on public.notification_events;
create policy notification_events_insert_none on public.notification_events for insert to authenticated with check (false);
drop policy if exists notification_events_update_none on public.notification_events;
create policy notification_events_update_none on public.notification_events for update to authenticated using (false) with check (false);
drop policy if exists notification_events_delete_none on public.notification_events;
create policy notification_events_delete_none on public.notification_events for delete to authenticated using (false);

create or replace function public.record_yomy_event(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_priority smallint,
  p_source_table text,
  p_source_id uuid,
  p_entity_id uuid,
  p_deep_link text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare v_id uuid;
begin
  insert into public.notification_events(recipient_id, actor_id, event_type, priority, source_table, source_id, entity_id, deep_link, payload)
  values (p_recipient_id, p_actor_id, p_event_type, p_priority, p_source_table, p_source_id, p_entity_id, p_deep_link, coalesce(p_payload, '{}'::jsonb))
  on conflict (source_table, source_id, recipient_id, event_type)
  do update set actor_id = excluded.actor_id, priority = excluded.priority, entity_id = excluded.entity_id, deep_link = excluded.deep_link, payload = excluded.payload
  returning id into v_id;
  return v_id;
exception when others then
  raise warning 'YOMY event recording failed: %', SQLERRM;
  return null;
end;
$$;
revoke all on function public.record_yomy_event(uuid,uuid,text,smallint,text,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_yomy_event(uuid,uuid,text,smallint,text,uuid,uuid,text,jsonb) to service_role;

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
    perform public.record_yomy_event(new.receiver_id,new.sender_id,'MESSAGE_CREATED',1,'messages',new.id,new.id,v_link,jsonb_build_object('message_id',new.id,'sender_id',new.sender_id,'receiver_id',new.receiver_id,'media_type',coalesce(new.media_type,''),'created_at',new.created_at));
  end if;
  return new;
end;
$$;

drop trigger if exists messages_unified_event on public.messages;
create trigger messages_unified_event after insert on public.messages for each row execute function public.record_message_event();

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
    perform public.record_yomy_event(new.callee_id,new.caller_id,'CALL_INCOMING',0,'call_sessions',new.id,new.id,v_link,jsonb_build_object('call_id',new.id,'caller_id',new.caller_id,'callee_id',new.callee_id,'kind',new.kind,'status',new.status,'created_at',new.created_at));
  end if;
  return new;
end;
$$;

drop trigger if exists call_sessions_unified_event on public.call_sessions;
create trigger call_sessions_unified_event after insert on public.call_sessions for each row execute function public.record_call_event();

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
  perform public.record_yomy_event(new.user_id,new.actor_id,v_type,v_priority,'notifications',new.id,v_entity,v_link,jsonb_build_object('notification_id',new.id,'notification_type',new.type,'message_id',new.message_id,'post_id',new.post_id,'comment_id',new.comment_id,'story_id',new.story_id,'created_at',new.created_at));
  return new;
exception when others then
  raise warning 'YOMY notification event recording failed: %', SQLERRM;
  return new;
end;
$$;

drop trigger if exists notifications_unified_event on public.notifications;
create trigger notifications_unified_event after insert on public.notifications for each row execute function public.record_notification_event();

revoke all on function public.record_message_event() from public, anon, authenticated;
revoke all on function public.record_call_event() from public, anon, authenticated;
revoke all on function public.record_notification_event() from public, anon, authenticated;

alter publication supabase_realtime add table public.notification_events;
alter table public.notification_events replica identity full;
