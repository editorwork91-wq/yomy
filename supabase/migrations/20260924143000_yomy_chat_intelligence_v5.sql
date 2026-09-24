-- YOMY Chat Intelligence + Offline Sync v5
-- Additive migration: preserves all existing data and APIs.

begin;

-- Romantic wallpaper option used by the shared chat decorator.
alter table public.chat_preferences
  drop constraint if exists chat_preferences_wallpaper_check;
alter table public.chat_preferences
  add constraint chat_preferences_wallpaper_check
  check (wallpaper = any (array[
    'default','romance','hearts','petals','midnight','paper','roses'
  ]));

alter table public.chat_shared_settings
  drop constraint if exists chat_shared_settings_wallpaper_check;
alter table public.chat_shared_settings
  add constraint chat_shared_settings_wallpaper_check
  check (wallpaper = any (array[
    'default','romance','hearts','petals','midnight','paper','roses'
  ]));

-- Preserve the authored time for messages that were composed offline.
create or replace function public.send_message_v2(
  p_receiver_id uuid,
  p_content text default '',
  p_reply_to_id uuid default null,
  p_media_url text default '',
  p_media_type text default '',
  p_media_bucket text default 'messages-private',
  p_media_path text default null,
  p_view_once boolean default false,
  p_client_message_id text default null,
  p_created_at timestamptz default null
)
returns public.messages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_message public.messages;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_receiver_id is null or p_receiver_id = v_user_id then
    raise exception 'Invalid recipient';
  end if;

  if p_client_message_id is not null then
    select *
      into v_message
      from public.messages
     where sender_id = v_user_id
       and client_message_id = p_client_message_id
     limit 1;

    if found then
      return v_message;
    end if;
  end if;

  if p_reply_to_id is not null then
    if not exists (
      select 1
        from public.messages m
       where m.id = p_reply_to_id
         and (
           (m.sender_id = v_user_id and m.receiver_id = p_receiver_id)
           or
           (m.sender_id = p_receiver_id and m.receiver_id = v_user_id)
         )
    ) then
      raise exception 'Reply target is outside this conversation';
    end if;
  end if;

  insert into public.messages(
    sender_id,
    receiver_id,
    content,
    media_url,
    media_type,
    media_bucket,
    media_path,
    is_encrypted,
    view_once,
    reply_to_id,
    client_message_id,
    created_at
  )
  values(
    v_user_id,
    p_receiver_id,
    coalesce(p_content, ''),
    coalesce(p_media_url, ''),
    coalesce(p_media_type, ''),
    coalesce(p_media_bucket, 'messages-private'),
    p_media_path,
    true,
    coalesce(p_view_once, false),
    p_reply_to_id,
    p_client_message_id,
    coalesce(p_created_at, now())
  )
  on conflict (sender_id, client_message_id)
    where client_message_id is not null
    do nothing
  returning * into v_message;

  if v_message.id is null and p_client_message_id is not null then
    select *
      into v_message
      from public.messages
     where sender_id = v_user_id
       and client_message_id = p_client_message_id
     limit 1;
  end if;

  if v_message.id is null then
    raise exception 'Message was not persisted';
  end if;

  return v_message;
end;
$$;

revoke all on function public.send_message_v2(uuid,text,uuid,text,text,text,text,boolean,text,timestamptz)
  from public, anon;
grant execute on function public.send_message_v2(uuid,text,uuid,text,text,text,text,boolean,text,timestamptz)
  to authenticated;

-- Hot-path conversation indexes. They are additive and data-preserving.
create index if not exists messages_receiver_created_at_idx
  on public.messages(receiver_id, created_at desc);

create index if not exists messages_sender_created_at_idx
  on public.messages(sender_id, created_at desc);

notify pgrst, 'reload schema';

commit;
