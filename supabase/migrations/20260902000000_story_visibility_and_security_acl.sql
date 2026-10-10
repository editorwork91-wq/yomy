-- Yomy: align story visibility with the frontend and harden exposed function ACLs.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.stories
  DROP CONSTRAINT IF EXISTS stories_visibility_check;

ALTER TABLE public.stories
  ADD CONSTRAINT stories_visibility_check
  CHECK (visibility IN ('public', 'friends', 'private'));

ALTER FUNCTION public.can_view_post(uuid, uuid) SET search_path = public;
REVOKE ALL ON FUNCTION public.can_view_post(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_post(uuid, uuid) TO authenticated;

ALTER FUNCTION public.update_updated_at() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
