-- Prevent clients from forging their own phone-verification state via profiles.update().
CREATE OR REPLACE FUNCTION public.prevent_client_phone_verification_forgery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.phone_e164 IS NOT NULL OR NEW.phone_verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'PHONE_VERIFICATION_SERVER_ONLY'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164
       OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at THEN
      RAISE EXCEPTION 'PHONE_VERIFICATION_SERVER_ONLY'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_phone_verification_insert_guard ON public.profiles;
CREATE TRIGGER profiles_phone_verification_insert_guard
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_phone_verification_forgery();

DROP TRIGGER IF EXISTS profiles_phone_verification_update_guard ON public.profiles;
CREATE TRIGGER profiles_phone_verification_update_guard
BEFORE UPDATE OF phone_e164, phone_verified_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_phone_verification_forgery();
