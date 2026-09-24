begin;

create table if not exists public.chat_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  other_user_id uuid not null references auth.users(id) on delete cascade,
  archived boolean not null default false,
  muted boolean not null default false,
  wallpaper text not null default 'default',
  bubble_theme text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, other_user_id),
  constraint chat_preferences_no_self check (user_id <> other_user_id),
  constraint chat_preferences_wallpaper_check check (wallpaper in ('default','romance','hearts','petals','midnight','paper')),
  constraint chat_preferences_bubble_check check (bubble_theme in ('default','ocean','mint','violet','rose','amber'))
);

create index if not exists chat_preferences_user_archived_idx
  on public.chat_preferences(user_id, archived, updated_at desc);
alter table public.chat_preferences enable row level security;

drop policy if exists chat_preferences_select_own on public.chat_preferences;
create policy chat_preferences_select_own on public.chat_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists chat_preferences_insert_own on public.chat_preferences;
create policy chat_preferences_insert_own on public.chat_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id and user_id <> other_user_id);
drop policy if exists chat_preferences_update_own on public.chat_preferences;
create policy chat_preferences_update_own on public.chat_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and user_id <> other_user_id);
drop policy if exists chat_preferences_delete_own on public.chat_preferences;
create policy chat_preferences_delete_own on public.chat_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);
drop trigger if exists chat_preferences_updated_at on public.chat_preferences;
create trigger chat_preferences_updated_at before update on public.chat_preferences
  for each row execute function public.update_updated_at();

alter table public.messages add column if not exists client_message_id text;
create unique index if not exists messages_sender_client_message_id_uidx
  on public.messages(sender_id, client_message_id)
  where client_message_id is not null;

create table if not exists public.fedo_video_objects (
  id uuid primary key references public.fedos(id) on delete cascade,
  fedo_id uuid not null references public.fedos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'fedos',
  object_path text not null unique,
  original_filename text not null default 'fedo.mp4',
  content_type text not null,
  file_size_bytes bigint not null default 0,
  duration_ms bigint not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  storage_node text not null default 'yomy-main',
  status text not null default 'uploading' check (status in ('uploading','processing','ready','failed','deleted','archived')),
  processing_status text not null default 'ready' check (processing_status in ('queued','processing','ready','failed')),
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fedo_video_objects_user_idx on public.fedo_video_objects(user_id, created_at desc);

create table if not exists public.fedo_thumbnail_objects (
  id uuid primary key default gen_random_uuid(),
  fedo_id uuid not null references public.fedos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'fedo-thumbnails',
  object_path text not null unique,
  content_type text not null default 'image/jpeg',
  file_size_bytes bigint not null default 0,
  storage_node text not null default 'yomy-main',
  status text not null default 'ready' check (status in ('uploading','ready','failed','deleted','archived')),
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fedo_thumbnail_objects_fedo_idx on public.fedo_thumbnail_objects(fedo_id);

alter table public.fedo_video_objects enable row level security;
alter table public.fedo_thumbnail_objects enable row level security;

drop policy if exists fedo_video_objects_no_client_access on public.fedo_video_objects;
create policy fedo_video_objects_no_client_access on public.fedo_video_objects for all to anon, authenticated
  using (false) with check (false);
drop policy if exists fedo_thumbnail_objects_no_client_access on public.fedo_thumbnail_objects;
create policy fedo_thumbnail_objects_no_client_access on public.fedo_thumbnail_objects for all to anon, authenticated
  using (false) with check (false);

drop trigger if exists fedo_video_objects_updated_at on public.fedo_video_objects;
create trigger fedo_video_objects_updated_at before update on public.fedo_video_objects
  for each row execute function public.update_updated_at();
drop trigger if exists fedo_thumbnail_objects_updated_at on public.fedo_thumbnail_objects;
create trigger fedo_thumbnail_objects_updated_at before update on public.fedo_thumbnail_objects
  for each row execute function public.update_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.posts'::regclass
      and conname='posts_image_only_media_type_check'
  ) then
    alter table public.posts add constraint posts_image_only_media_type_check
      check (media_type is null or media_type='image');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;