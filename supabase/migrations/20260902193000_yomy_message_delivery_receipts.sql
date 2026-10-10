alter table public.messages add column if not exists delivered_at timestamptz;

create or replace function public.mark_message_delivered(p_message_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.messages
  set delivered_at = coalesce(delivered_at, now())
  where id = p_message_id
    and receiver_id = (select auth.uid())
    and deleted_for_everyone = false;
end;
$$;

revoke all on function public.mark_message_delivered(uuid) from public;
grant execute on function public.mark_message_delivered(uuid) to authenticated;

create or replace function public.mark_messages_delivered(p_other_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.messages
  set delivered_at = coalesce(delivered_at, now())
  where receiver_id = (select auth.uid())
    and sender_id = p_other_user_id
    and delivered_at is null
    and deleted_for_everyone = false;
end;
$$;

revoke all on function public.mark_messages_delivered(uuid) from public;
grant execute on function public.mark_messages_delivered(uuid) to authenticated;

notify pgrst, 'reload schema';
