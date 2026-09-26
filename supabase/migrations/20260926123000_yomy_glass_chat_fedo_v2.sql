begin;

create table if not exists public.message_hidden_for_users (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_hidden_for_users_user_idx
  on public.message_hidden_for_users(user_id, created_at desc);

alter table public.message_hidden_for_users enable row level security;

drop policy if exists message_hidden_select_own on public.message_hidden_for_users;
create policy message_hidden_select_own
on public.message_hidden_for_users
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists message_hidden_insert_own on public.message_hidden_for_users;
create policy message_hidden_insert_own
on public.message_hidden_for_users
for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.messages m
    where m.id = message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists message_hidden_delete_own on public.message_hidden_for_users;
create policy message_hidden_delete_own
on public.message_hidden_for_users
for delete to authenticated
using (auth.uid() = user_id);

create or replace function public.touch_chat_poll_vote_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_user_sleeping(target_user uuid)
returns boolean
language plpgsql stable security invoker
set search_path = public
as $$
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
  if p.sleep_start = p.sleep_end then return false; end if;
  if p.sleep_start < p.sleep_end then
    return local_clock >= p.sleep_start and local_clock < p.sleep_end;
  end if;
  return local_clock >= p.sleep_start or local_clock < p.sleep_end;
end;
$$;

revoke execute on function public.is_user_sleeping(uuid) from anon;
grant execute on function public.is_user_sleeping(uuid) to authenticated;

create or replace function public.create_chat_poll(
  p_receiver_id uuid,
  p_question text,
  p_options text[],
  p_reply_to_id uuid default null,
  p_client_message_id text default null,
  p_created_at timestamptz default now()
)
returns uuid
language plpgsql volatile security invoker
set search_path = public
as $$
declare
  v_message_id uuid;
  v_poll_id uuid;
  v_options text[];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_receiver_id is null or p_receiver_id = auth.uid() then raise exception 'INVALID_RECEIVER' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_question,''))) not between 1 and 500 then raise exception 'INVALID_POLL_QUESTION' using errcode = '22023'; end if;

  select coalesce(array_agg(trim(value) order by ordinality), '{}')
  into v_options
  from unnest(coalesce(p_options, '{}')) with ordinality as u(value, ordinality)
  where char_length(trim(value)) between 1 and 200;

  if coalesce(array_length(v_options, 1), 0) < 2 or coalesce(array_length(v_options, 1), 0) > 6 then
    raise exception 'INVALID_POLL_OPTIONS' using errcode = '22023';
  end if;

  insert into public.messages (
    sender_id, receiver_id, content, media_url, media_type, media_bucket, media_path,
    message_type, is_encrypted, view_once, view_once_limit, view_once_open_count,
    view_once_opened, client_message_id, reply_to_id, created_at
  )
  values (
    auth.uid(), p_receiver_id, '', '', '', 'messages', null,
    'poll', true, false, 0, 0, false, p_client_message_id, p_reply_to_id,
    coalesce(p_created_at, now())
  )
  returning id into v_message_id;

  insert into public.chat_polls (message_id, question)
  values (v_message_id, trim(p_question))
  returning id into v_poll_id;

  insert into public.chat_poll_options (poll_id, option_index, label)
  select v_poll_id, row_number() over (order by ordinality) - 1, value
  from unnest(v_options) with ordinality as u(value, ordinality);

  return v_message_id;
end;
$$;

revoke all on function public.create_chat_poll(uuid, text, text[], uuid, text, timestamptz) from public;
grant execute on function public.create_chat_poll(uuid, text, text[], uuid, text, timestamptz) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_polls') then
      execute 'alter publication supabase_realtime add table public.chat_polls';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_poll_options') then
      execute 'alter publication supabase_realtime add table public.chat_poll_options';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_poll_votes') then
      execute 'alter publication supabase_realtime add table public.chat_poll_votes';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_hidden_for_users') then
      execute 'alter publication supabase_realtime add table public.message_hidden_for_users';
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;