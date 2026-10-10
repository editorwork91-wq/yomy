begin;

create table if not exists public.chat_stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My sticker',
  bucket text not null default 'chat-stickers',
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.chat_stickers enable row level security;

drop policy if exists chat_stickers_select_own on public.chat_stickers;
create policy chat_stickers_select_own on public.chat_stickers for select to authenticated using (auth.uid() = user_id);

drop policy if exists chat_stickers_insert_own on public.chat_stickers;
create policy chat_stickers_insert_own on public.chat_stickers for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists chat_stickers_delete_own on public.chat_stickers;
create policy chat_stickers_delete_own on public.chat_stickers for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('chat-stickers','chat-stickers',false)
on conflict (id) do update set public=false;

drop policy if exists chat_stickers_storage_insert on storage.objects;
create policy chat_stickers_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'chat-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists chat_stickers_storage_select on storage.objects;
create policy chat_stickers_storage_select on storage.objects for select to authenticated
using (bucket_id = 'chat-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists chat_stickers_storage_delete on storage.objects;
create policy chat_stickers_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'chat-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
commit;
