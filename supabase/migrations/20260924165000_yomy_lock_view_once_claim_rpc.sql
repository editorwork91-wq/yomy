begin;

-- The client never needs to call the privileged claim RPC directly.
-- The authenticated receiver reaches it through message-media-url, which
-- runs with service-role credentials after authenticating the user.
revoke execute on function public.claim_message_view_once(uuid) from authenticated, anon, public;
grant execute on function public.claim_message_view_once(uuid) to service_role;

commit;
