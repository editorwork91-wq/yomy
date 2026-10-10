-- YOMY Messaging + Call Experience Reliability
-- Additive migration: no user data is dropped or rewritten.

begin;

-- 1) A failed notification side-effect must NEVER make message delivery fail.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.message_type, '') = 'call' then
    return new;
  end if;

  if new.sender_id is distinct from new.receiver_id
     and coalesce(new.deleted_for_everyone, false) = false then
    begin
      insert into public.notifications(user_id, actor_id, type, message_id)
      values (new.receiver_id, new.sender_id, 'message', new.id);
    exception when others then
      raise warning 'YOMY message notification side-effect failed: %', SQLERRM;
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_new_message() from public, anon, authenticated;

-- 2) Realtime reactions were implemented in the UI but were not in the
--    realtime publication. Add them so both participants see reactions instantly.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.message_reactions;
    exception when duplicate_object then
      null;
    end;

    begin
      alter table public.message_reactions replica identity full;
    exception when others then
      null;
    end;
  end if;
end $$;

-- 3) Idempotent server-side message write.
--    The client provides a stable client_message_id; retries return the
--    existing message instead of creating duplicates.
create unique index if not exists messages_sender_client_message_id_uidx
  on public.messages(sender_id, client_message_id)
  where client_message_id is not null;

create or replace function public.send_message(
  p_receiver_id uuid,
  p_content text default '',
  p_reply_to_id uuid default null,
  p_media_url text default '',
  p_media_type text default '',
  p_media_bucket text default 'messages',
  p_media_path text default null,
  p_view_once boolean default false,
  p_client_message_id text default null
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
    client_message_id
  )
  values(
    v_user_id,
    p_receiver_id,
    coalesce(p_content, ''),
    coalesce(p_media_url, ''),
    coalesce(p_media_type, ''),
    coalesce(p_media_bucket, 'messages'),
    p_media_path,
    true,
    coalesce(p_view_once, false),
    p_reply_to_id,
    p_client_message_id
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

revoke all on function public.send_message(uuid,text,uuid,text,text,text,text,boolean,text)
  from public, anon;
grant execute on function public.send_message(uuid,text,uuid,text,text,text,text,boolean,text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
