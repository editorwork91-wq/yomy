-- Store unverified phone drafts separately so only the server can mark a number verified.
CREATE TABLE IF NOT EXISTS public.user_phone_drafts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_phone_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_phone_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_phone_drafts TO authenticated;

DROP POLICY IF EXISTS user_phone_drafts_select_own ON public.user_phone_drafts;
CREATE POLICY user_phone_drafts_select_own
  ON public.user_phone_drafts FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS user_phone_drafts_insert_own ON public.user_phone_drafts;
CREATE POLICY user_phone_drafts_insert_own
  ON public.user_phone_drafts FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS user_phone_drafts_update_own ON public.user_phone_drafts;
CREATE POLICY user_phone_drafts_update_own
  ON public.user_phone_drafts FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS user_phone_drafts_delete_own ON public.user_phone_drafts;
CREATE POLICY user_phone_drafts_delete_own
  ON public.user_phone_drafts FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- A user may replace their own verified number, while each number can be linked
-- to no more than two user accounts. The advisory lock serializes competing claims.
CREATE OR REPLACE FUNCTION public.claim_verified_phone(p_user_id uuid, p_phone_e164 text, p_nonce text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_nonce public.phone_verification_nonces;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'NOT_YOUR_ACCOUNT' USING ERRCODE = '42501';
  END IF;
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE_NUMBER' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_nonce
  FROM public.phone_verification_nonces
  WHERE phone_e164 = p_phone_e164
    AND nonce = p_nonce
    AND purpose = 'signup'
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF v_nonce.id IS NULL THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_EXPIRED' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_phone_e164, 0));

  SELECT count(*) INTO v_count
  FROM public.account_phone_links
  WHERE phone_e164 = p_phone_e164
    AND user_id <> p_user_id;

  IF v_count >= 2 THEN
    RAISE EXCEPTION 'PHONE_ACCOUNT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.account_phone_links(user_id, phone_e164, verified_at)
  VALUES (p_user_id, p_phone_e164, now())
  ON CONFLICT (user_id) DO UPDATE
    SET phone_e164 = EXCLUDED.phone_e164,
        verified_at = EXCLUDED.verified_at;

  UPDATE public.profiles
  SET phone_e164 = p_phone_e164,
      phone_verified_at = now()
  WHERE id = p_user_id;

  UPDATE public.phone_verification_nonces
  SET consumed_at = now()
  WHERE id = v_nonce.id;

  RETURN true;
END;
$function$;
