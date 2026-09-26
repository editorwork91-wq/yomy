revoke execute on function public.create_chat_poll(uuid, text, text[], uuid, text, timestamptz) from anon;
grant execute on function public.create_chat_poll(uuid, text, text[], uuid, text, timestamptz) to authenticated;
