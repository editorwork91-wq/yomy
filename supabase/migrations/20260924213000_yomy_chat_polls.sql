begin;

create table if not exists public.chat_polls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.chat_polls(id) on delete cascade,
  option_index smallint not null check (option_index between 0 and 11),
  label text not null check (char_length(trim(label)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (poll_id, option_index)
);

create table if not exists public.chat_poll_votes (
  poll_id uuid not null references public.chat_polls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_id uuid not null references public.chat_poll_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index if not exists chat_polls_message_idx on public.chat_polls(message_id);
create index if not exists chat_poll_options_poll_idx on public.chat_poll_options(poll_id, option_index);
create index if not exists chat_poll_votes_option_idx on public.chat_poll_votes(poll_id, option_id);

alter table public.chat_polls enable row level security;
alter table public.chat_poll_options enable row level security;
alter table public.chat_poll_votes enable row level security;

drop policy if exists chat_polls_select_participant on public.chat_polls;
create policy chat_polls_select_participant on public.chat_polls for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = chat_polls.message_id
    and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
));

drop policy if exists chat_polls_insert_sender on public.chat_polls;
create policy chat_polls_insert_sender on public.chat_polls for insert to authenticated
with check (exists (
  select 1 from public.messages m
  where m.id = chat_polls.message_id and m.sender_id = auth.uid()
));

drop policy if exists chat_poll_options_select_participant on public.chat_poll_options;
create policy chat_poll_options_select_participant on public.chat_poll_options for select to authenticated
using (exists (
  select 1
  from public.chat_polls p
  join public.messages m on m.id = p.message_id
  where p.id = chat_poll_options.poll_id
    and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
));

drop policy if exists chat_poll_options_insert_sender on public.chat_poll_options;
create policy chat_poll_options_insert_sender on public.chat_poll_options for insert to authenticated
with check (exists (
  select 1
  from public.chat_polls p
  join public.messages m on m.id = p.message_id
  where p.id = chat_poll_options.poll_id and m.sender_id = auth.uid()
));

drop policy if exists chat_poll_votes_select_participant on public.chat_poll_votes;
create policy chat_poll_votes_select_participant on public.chat_poll_votes for select to authenticated
using (exists (
  select 1
  from public.chat_polls p
  join public.messages m on m.id = p.message_id
  where p.id = chat_poll_votes.poll_id
    and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
));

drop policy if exists chat_poll_votes_insert_self on public.chat_poll_votes;
create policy chat_poll_votes_insert_self on public.chat_poll_votes for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.chat_polls p
    join public.messages m on m.id = p.message_id
    join public.chat_poll_options o on o.id = chat_poll_votes.option_id and o.poll_id = p.id
    where p.id = chat_poll_votes.poll_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists chat_poll_votes_update_self on public.chat_poll_votes;
create policy chat_poll_votes_update_self on public.chat_poll_votes for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.chat_polls p
    join public.messages m on m.id = p.message_id
    join public.chat_poll_options o on o.id = chat_poll_votes.option_id and o.poll_id = p.id
    where p.id = chat_poll_votes.poll_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists chat_poll_votes_delete_self on public.chat_poll_votes;
create policy chat_poll_votes_delete_self on public.chat_poll_votes for delete to authenticated
using (user_id = auth.uid());

drop function if exists public.touch_chat_poll_vote_updated_at();
create or replace function public.touch_chat_poll_vote_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chat_poll_votes_updated_at on public.chat_poll_votes;
create trigger chat_poll_votes_updated_at
before update on public.chat_poll_votes
for each row execute function public.touch_chat_poll_vote_updated_at();

notify pgrst, 'reload schema';
commit;