-- Keep phone-claim RPC server-only. The application calls it through the
-- yomy-account-auth Edge Function using the service role.
REVOKE EXECUTE ON FUNCTION public.claim_verified_phone(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_verified_phone(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_verified_phone(uuid, text, text) TO service_role;