create or replace function public.mark_all_messages_delivered()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare updated_count integer;
begin
  update public.messages
  set delivered_at = coalesce(delivered_at, now())
  where receiver_id = (select auth.uid())
    and delivered_at is null
    and deleted_for_everyone = false;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_all_messages_delivered() from public;
grant execute on function public.mark_all_messages_delivered() to authenticated;

notify pgrst, 'reload schema';
