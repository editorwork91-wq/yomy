-- YOMY Production Hardening
-- Server-authoritative publishing, safer messaging updates, notification creation,
-- stricter lifecycle and anti-abuse consistency.

-- ============================================================
-- POSTS: server-authoritative publish/moderation state
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_post(p_post_id uuid)
RETURNS public.posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result public.posts;
BEGIN
  UPDATE public.posts
  SET status = 'published',
      published_at = COALESCE(published_at, now()),
      updated_at = now()
  WHERE id = p_post_id
    AND user_id = (select auth.uid())
    AND moderation_status = 'safe'
    AND status IN ('ready', 'moderation', 'processing', 'pending_moderation', 'draft')
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST_NOT_READY_FOR_PUBLISH';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_post(uuid) TO authenticated;

DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts
FOR INSERT TO authenticated
WITH CHECK (
  (select auth.uid()) = user_id
  AND status IN ('draft', 'uploading', 'processing', 'moderation', 'pending_moderation')
  AND moderation_status = 'pending'
);

DROP POLICY IF EXISTS "posts_update" ON public.posts;
CREATE POLICY "posts_update" ON public.posts
FOR UPDATE TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK (
  (select auth.uid()) = user_id
  AND status IN ('draft', 'uploading', 'processing', 'moderation', 'pending_moderation', 'ready', 'archived', 'deleted')
  AND moderation_status IN ('pending', 'safe', 'review', 'rejected')
);

-- ============================================================
-- NOTIFICATIONS: no arbitrary client-side insertion
-- ============================================================

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_actor_id uuid,
  p_type text,
  p_post_id uuid DEFAULT NULL,
  p_comment_id uuid DEFAULT NULL
)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result public.notifications;
BEGIN
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications(user_id, actor_id, type, post_id, comment_id)
  VALUES (p_user_id, p_actor_id, p_type, p_post_id, p_comment_id)
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, uuid, text, uuid, uuid) TO authenticated;

-- ============================================================
-- MESSAGES: controlled sender mutations
-- ============================================================

DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "messages_update" ON public.messages
FOR UPDATE TO authenticated
USING ((select auth.uid()) = sender_id OR (select auth.uid()) = receiver_id)
WITH CHECK ((select auth.uid()) = sender_id OR (select auth.uid()) = receiver_id);

CREATE OR REPLACE FUNCTION public.protect_message_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- The receiver is allowed to update read/request state only.
  IF (select auth.uid()) = OLD.receiver_id THEN
    IF NEW.sender_id <> OLD.sender_id
       OR NEW.receiver_id <> OLD.receiver_id
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.media_url IS DISTINCT FROM OLD.media_url
       OR NEW.media_type IS DISTINCT FROM OLD.media_type
       OR NEW.is_encrypted IS DISTINCT FROM OLD.is_encrypted
       OR NEW.view_once IS DISTINCT FROM OLD.view_once
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.deleted_for_everyone IS DISTINCT FROM OLD.deleted_for_everyone
       OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
       OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
       OR NEW.is_request IS DISTINCT FROM OLD.is_request
    THEN
      RAISE EXCEPTION 'RECEIVER_CANNOT_MUTATE_MESSAGE_CONTENT';
    END IF;
  END IF;

  -- Participants can never be changed by an update.
  IF NEW.sender_id <> OLD.sender_id OR NEW.receiver_id <> OLD.receiver_id THEN
    RAISE EXCEPTION 'MESSAGE_PARTICIPANTS_ARE_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_protect_fields ON public.messages;
CREATE TRIGGER messages_protect_fields
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.protect_message_fields();

CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_content text)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result public.messages;
BEGIN
  IF length(trim(coalesce(p_content, ''))) = 0 OR length(p_content) > 5000 THEN
    RAISE EXCEPTION 'INVALID_MESSAGE_CONTENT';
  END IF;

  UPDATE public.messages
  SET content = trim(p_content), edited_at = now()
  WHERE id = p_message_id
    AND sender_id = (select auth.uid())
    AND deleted_for_everyone = false
    AND created_at > now() - interval '15 minutes'
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_EDITABLE';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_message_for_everyone(p_message_id uuid)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result public.messages;
BEGIN
  UPDATE public.messages
  SET deleted_for_everyone = true,
      content = '',
      media_url = '',
      media_type = '',
      edited_at = NULL
  WHERE id = p_message_id
    AND sender_id = (select auth.uid())
    AND deleted_for_everyone = false
    AND created_at > now() - interval '15 minutes'
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_DELETABLE';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_message_for_everyone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_message_for_everyone(uuid) TO authenticated;

-- ============================================================
-- STORIES: retain storage path for lifecycle cleanup
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stories' AND column_name = 'media_path'
  ) THEN
    ALTER TABLE public.stories ADD COLUMN media_path text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stories_user_expires_idx
  ON public.stories(user_id, expires_at DESC);

-- ============================================================
-- ANTI-ABUSE / CONSISTENCY CHECKS
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_no_self_follow') THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocks_no_self_block') THEN
    ALTER TABLE public.blocks ADD CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_no_self_message') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_no_self_message CHECK (sender_id <> receiver_id);
  END IF;
END $$;

COMMENT ON FUNCTION public.publish_post(uuid) IS
'Publishes only a safe, owner-owned post after server-side moderation.';
COMMENT ON FUNCTION public.create_notification(uuid, uuid, text, uuid, uuid) IS
'Controlled notification creation helper; arbitrary notification INSERT is disabled.';
COMMENT ON FUNCTION public.edit_message(uuid, text) IS
'Edits sender-owned messages for 15 minutes only.';
COMMENT ON FUNCTION public.delete_message_for_everyone(uuid) IS
'Deletes sender-owned messages for everyone for 15 minutes only.';
