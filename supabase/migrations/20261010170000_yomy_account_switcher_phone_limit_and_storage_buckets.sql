-- Ensure YOMY's core storage buckets exist without changing existing production bucket settings.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('posts', 'posts', true, NULL, NULL),
  ('messages', 'messages', true, NULL, NULL),
  ('messages-private', 'messages-private', false, NULL, NULL),
  ('profile-avatars', 'profile-avatars', true, 5242880, ARRAY['image/jpeg','image/png','image/webp']),
  ('stories-private', 'stories-private', false, 52428800, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']),
  ('fedos', 'fedos', false, 524288000, ARRAY['video/mp4','video/webm','video/quicktime','video/x-m4v']),
  ('fedo-thumbnails', 'fedo-thumbnails', false, 10485760, ARRAY['image/jpeg','image/png','image/webp']),
  ('chat-stickers', 'chat-stickers', false, 10485760, ARRAY['image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- A second server-side guard for the existing two-accounts-per-phone rule.
CREATE OR REPLACE FUNCTION public.enforce_two_verified_accounts_per_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE linked_count integer;
BEGIN
  IF NEW.phone_e164 IS NULL OR btrim(NEW.phone_e164) = '' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.phone_e164, 0));
  SELECT count(*) INTO linked_count
    FROM public.account_phone_links
   WHERE phone_e164 = NEW.phone_e164 AND user_id <> NEW.user_id;
  IF linked_count >= 2 THEN
    RAISE EXCEPTION 'PHONE_ACCOUNT_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS account_phone_links_enforce_two_per_phone ON public.account_phone_links;
CREATE TRIGGER account_phone_links_enforce_two_per_phone
BEFORE INSERT OR UPDATE OF phone_e164 ON public.account_phone_links
FOR EACH ROW EXECUTE FUNCTION public.enforce_two_verified_accounts_per_phone();

REVOKE ALL ON FUNCTION public.enforce_two_verified_accounts_per_phone() FROM PUBLIC, anon, authenticated;
