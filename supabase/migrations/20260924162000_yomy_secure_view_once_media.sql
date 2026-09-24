begin;

-- YOMY secure view-once media + private message storage.
-- Additive/data-preserving: existing rows keep their current values.

alter table public.messages
  add column if not exists view_once_limit smallint not null default 0,
  add column if not exists view_once_open_count smallint not null default 0,
  add column if not exists view_once_opened_at timestamptz;

-- Old view_once rows predate the explicit limit. Preserve their semantics as
-- one-open media instead of leaving them permanently reopenable.
update public.messages
   set view_once_limit = 1
 where view_once = true
   and view_once_limit = 0;

alter table public.messages
  drop constraint if exists messages_view_once_limit_check;
alter table public.messages
  add constraint messages_view_once_limit_check
  check (view_once_limit between 0 and 2);

alter table public.messages
  drop constraint if exists messages_view_once_open_count_check;
alter table public.messages
  add constraint messages_view_once_open_count_check
  check (view_once_open_count between 0 and 2);

update public.messages
   set view_once_open_count = case when view_once_opened then 1 else 0 end
 where view_once = true
   and view_once_open_count = 0;

create index if not exists messages_view_once_receiver_idx
  on public.messages(receiver_id, view_once, view_once_open_count, created_at desc)
  where view_once = true;

-- Atomically consume one permitted open. The client never updates the
-- counter directly, so two devices cannot race the allowance.
create or replace function public.claim_message_view_once(p_message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_message public.messages;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.messages
     set view_once_open_count = view_once_open_count + 1,
         view_once_opened = true,
         view_once_opened_at = coalesce(view_once_opened_at, now())
   where id = p_message_id
     and receiver_id = v_user_id
     and view_once = true
     and view_once_limit > 0
     and view_once_open_count < view_once_limit
   returning * into v_message;

  if v_message.id is null then
    raise exception 'VIEW_ONCE_EXHAUSTED';
  end if;

  return v_message;
end;
$$;

revoke all on function public.claim_message_view_once(uuid) from public, anon;
grant execute on function public.claim_message_view_once(uuid) to authenticated;

-- Private message media bucket. Existing bucket settings are preserved except
-- for forcing private visibility.
insert into storage.buckets (id, name, public)
values ('messages-private', 'messages-private', false)
on conflict (id) do update set public = false;

drop policy if exists messages_private_insert_own on storage.objects;
create policy messages_private_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'messages-private'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

drop policy if exists messages_private_delete_own on storage.objects;
create policy messages_private_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'messages-private'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

-- Intentionally no authenticated SELECT policy. Private media is only
-- exposed through the signed-url edge function after conversation/consumption
-- checks.

-- Dedicated sender API with an explicit 0/1/2 open allowance.
create or replace function public.send_message_v3(
  p_receiver_id uuid,
  p_content text default '',
  p_reply_to_id uuid default null,
  p_media_url text default '',
  p_media_type text default '',
  p_media_bucket text default 'messages-private',
  p_media_path text default null,
  p_view_once boolean default false,
  p_view_once_limit smallint default 0,
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
  v_limit smallint := case when coalesce(p_view_once, false) then greatest(1, least(coalesce(p_view_once_limit, 1), 2)) else 0 end;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_receiver_id is null or p_receiver_id = v_user_id then
    raise exception 'Invalid recipient';
  end if;

  if p_view_once and p_media_type <> 'image' then
    raise exception 'View once is currently supported for images only';
  end if;

  if p_view_once and (p_media_path is null or p_media_path = '') then
    raise exception 'View once media path is required';
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
    sender_id, receiver_id, content, media_url, media_type, media_bucket,
    media_path, is_encrypted, view_once, view_once_limit,
    view_once_open_count, view_once_opened, view_once_opened_at,
    reply_to_id, client_message_id, created_at
  )
  values(
    v_user_id, p_receiver_id, coalesce(p_content, ''), coalesce(p_media_url, ''),
    coalesce(p_media_type, ''), coalesce(p_media_bucket, 'messages-private'),
    p_media_path, true, coalesce(p_view_once, false), v_limit, 0, false, null,
    p_reply_to_id, p_client_message_id, coalesce(p_created_at, now())
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

revoke all on function public.send_message_v3(uuid,text,uuid,text,text,text,text,boolean,smallint,text,timestamptz)
  from public, anon;
grant execute on function public.send_message_v3(uuid,text,uuid,text,text,text,text,boolean,smallint,text,timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
commit;
