-- YOMY View-once media hardening
-- Additive; preserves existing rows and supports legacy boolean view_once messages.

begin;

alter table public.messages
  drop constraint if exists messages_view_once_limit_check;
alter table public.messages
  add constraint messages_view_once_limit_check
  check (view_once_limit between 0 and 2);

alter table public.messages
  drop constraint if exists messages_view_once_count_check;
alter table public.messages
  add constraint messages_view_once_count_check
  check (view_once_open_count between 0 and 2);

create or replace function public.can_view_once_media(
  p_message_id uuid
)
returns table(
  allowed boolean,
  open_count smallint,
  view_limit smallint
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.messages m
     set view_once_open_count = (m.view_once_open_count + 1)::smallint,
         view_once_opened = true,
         view_once_opened_at = coalesce(m.view_once_opened_at, now())
   where m.id = p_message_id
     and m.receiver_id = auth.uid()
     and m.deleted_for_everyone = false
     and m.media_path is not null
     and (case when m.view_once_limit between 1 and 2 then m.view_once_limit else 1 end) > m.view_once_open_count
  returning true, m.view_once_open_count,
            (case when m.view_once_limit between 1 and 2 then m.view_once_limit else 1 end)::smallint;

  if not found then
    return query
      select false,
             coalesce(m.view_once_open_count, 0)::smallint,
             (case when m.view_once_limit between 1 and 2 then m.view_once_limit else 1 end)::smallint
        from public.messages m
       where m.id = p_message_id
         and m.receiver_id = auth.uid();
  end if;
end;
$$;

revoke all on function public.can_view_once_media(uuid) from public, anon;
grant execute on function public.can_view_once_media(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;