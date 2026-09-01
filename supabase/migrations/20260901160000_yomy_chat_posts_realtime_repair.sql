-- YOMY: repair migration for broken publishing + chat realtime
-- This migration is intentionally additive and safe to run after prior migrations.

-- ============================================================
-- POSTS: align the lifecycle with the frontend moderation state
-- ============================================================

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_status_check;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_status_check
  CHECK (
    status IN (
      'draft',
      'uploading',
      'processing',
      'moderation',
      'pending_moderation',
      'ready',
      'published',
      'rejected',
      'archived',
      'deleted'
    )
  );

-- ============================================================
-- REALTIME: make all user-visible activity streamable
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.likes;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.comment_likes;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    BEGIN
      ALTER TABLE public.messages REPLICA IDENTITY FULL;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    BEGIN
      ALTER TABLE public.notifications REPLICA IDENTITY FULL;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
END $$;

-- ============================================================
-- SERVER NOTIFICATIONS: never let a notification failure break
-- the user's primary action (sending/liking/commenting).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_activity_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'messages' THEN
      IF NEW.sender_id IS DISTINCT FROM NEW.receiver_id
         AND COALESCE(NEW.deleted_for_everyone, false) = false THEN
        INSERT INTO public.notifications(user_id, actor_id, type, message_id)
        VALUES (NEW.receiver_id, NEW.sender_id, 'message', NEW.id);
      END IF;
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'likes' THEN
      INSERT INTO public.notifications(user_id, actor_id, type, post_id)
      SELECT p.user_id, NEW.user_id, 'like', NEW.post_id
      FROM public.posts p
      WHERE p.id = NEW.post_id
        AND p.user_id <> NEW.user_id;
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'comments' THEN
      INSERT INTO public.notifications(user_id, actor_id, type, post_id, comment_id)
      SELECT p.user_id, NEW.user_id, 'comment', NEW.post_id, NEW.id
      FROM public.posts p
      WHERE p.id = NEW.post_id
        AND p.user_id <> NEW.user_id;
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'comment_likes' THEN
      INSERT INTO public.notifications(user_id, actor_id, type, post_id, comment_id)
      SELECT c.user_id, NEW.user_id, 'comment', c.post_id, NEW.comment_id
      FROM public.comments c
      WHERE c.id = NEW.comment_id
        AND c.user_id <> NEW.user_id;
      RETURN NEW;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN others THEN
    -- Activity notifications are secondary. Never roll back the
    -- primary user action because notification delivery failed.
    RAISE WARNING 'YOMY activity notification failed: %', SQLERRM;
    RETURN NEW;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.create_activity_notification() FROM PUBLIC;

-- ============================================================
-- MESSAGE SAFETY: receiver may mark seen, sender controls content.
-- Keep direct UI updates compatible with existing RLS.
-- ============================================================

DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "messages_update" ON public.messages
FOR UPDATE TO authenticated
USING ((select auth.uid()) = sender_id OR (select auth.uid()) = receiver_id)
WITH CHECK ((select auth.uid()) = sender_id OR (select auth.uid()) = receiver_id);

-- ============================================================
-- Helper: mark a conversation's messages as seen without exposing
-- arbitrary content updates through the client.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_messages_seen(p_other_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.messages
  SET is_seen = true
  WHERE receiver_id = (select auth.uid())
    AND sender_id = p_other_user_id
    AND is_seen = false
    AND deleted_at IS NULL
    AND deleted_for_everyone = false;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_seen(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_messages_seen(uuid) TO authenticated;
