alter table public.call_signals drop constraint if exists call_signals_signal_type_check;
alter table public.call_signals add constraint call_signals_signal_type_check
  check (signal_type in ('offer','answer','ice-candidate','renegotiate','hangup','ringing_ack','decline'));

create table if not exists public.chat_shared_settings (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  wallpaper text not null default 'default',
  background_image_url text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint chat_shared_settings_order check (user_low < user_high),
  constraint chat_shared_settings_no_self check (user_low <> user_high),
  constraint chat_shared_settings_wallpaper_check check (wallpaper in ('default','romance','hearts','petals','midnight','paper'))
);

alter table public.chat_shared_settings enable row level security;

drop policy if exists chat_shared_settings_select_participant on public.chat_shared_settings;
create policy chat_shared_settings_select_participant
on public.chat_shared_settings for select to authenticated
using ((select auth.uid()) in (user_low, user_high));

drop policy if exists chat_shared_settings_insert_participant on public.chat_shared_settings;
create policy chat_shared_settings_insert_participant
on public.chat_shared_settings for insert to authenticated
with check ((select auth.uid()) in (user_low, user_high));

drop policy if exists chat_shared_settings_update_participant on public.chat_shared_settings;
create policy chat_shared_settings_update_participant
on public.chat_shared_settings for update to authenticated
using ((select auth.uid()) in (user_low, user_high))
with check ((select auth.uid()) in (user_low, user_high));

drop policy if exists chat_shared_settings_delete_participant on public.chat_shared_settings;
create policy chat_shared_settings_delete_participant
on public.chat_shared_settings for delete to authenticated
using ((select auth.uid()) in (user_low, user_high));

drop trigger if exists chat_shared_settings_updated_at on public.chat_shared_settings;
create trigger chat_shared_settings_updated_at
before update on public.chat_shared_settings
for each row execute function public.update_updated_at();

alter table public.chat_shared_settings replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.chat_shared_settings;
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';