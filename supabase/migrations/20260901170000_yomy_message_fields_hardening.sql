-- Yomy: align message schema with Chat.tsx and harden notification execution.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_everyone boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_request boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS request_accepted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx ON public.messages(reply_to_id);
CREATE INDEX IF NOT EXISTS messages_deleted_for_everyone_idx ON public.messages(deleted_for_everyone) WHERE deleted_for_everyone = false;
CREATE INDEX IF NOT EXISTS messages_receiver_sender_created_idx ON public.messages(receiver_id, sender_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_no_self_message') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_no_self_message CHECK (sender_id <> receiver_id);
  END IF;
END $$;

DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated
USING ((select auth.uid()) = sender_id OR (select auth.uid()) = receiver_id)
WITH CHECK ((select auth.uid()) = sender_id OR (select auth.uid()) = receiver_id);

CREATE OR REPLACE FUNCTION public.create_activity_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'messages' THEN
      IF NEW.sender_id IS DISTINCT FROM NEW.receiver_id AND COALESCE(NEW.deleted_for_everyone, false) = false THEN
        INSERT INTO public.notifications(user_id, actor_id, type, message_id)
        VALUES (NEW.receiver_id, NEW.sender_id, 'message', NEW.id);
      END IF;
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'likes' THEN
      INSERT INTO public.notifications(user_id, actor_id, type, post_id)
      SELECT p.user_id, NEW.user_id, 'like', NEW.post_id
      FROM public.posts p WHERE p.id = NEW.post_id AND p.user_id <> NEW.user_id;
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'comments' THEN
      INSERT INTO public.notifications(user_id, actor_id, type, post_id, comment_id)
      SELECT p.user_id, NEW.user_id, 'comment', NEW.post_id, NEW.id
      FROM public.posts p WHERE p.id = NEW.post_id AND p.user_id <> NEW.user_id;
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'comment_likes' THEN
      INSERT INTO public.notifications(user_id, actor_id, type, post_id, comment_id)
      SELECT c.user_id, NEW.user_id, 'comment', c.post_id, NEW.comment_id
      FROM public.comments c WHERE c.id = NEW.comment_id AND c.user_id <> NEW.user_id;
      RETURN NEW;
    END IF;
    RETURN NEW;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'YOMY activity notification failed: %', SQLERRM;
    RETURN NEW;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.create_activity_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_messages_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_seen(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.publish_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_post(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_follow_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_follow_request(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_follow_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_follow_request(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.create_activity_notification() SET search_path = '';
ALTER FUNCTION public.mark_messages_seen(uuid) SET search_path = '';
ALTER FUNCTION public.publish_post(uuid) SET search_path = '';
ALTER FUNCTION public.accept_follow_request(uuid) SET search_path = '';
ALTER FUNCTION public.reject_follow_request(uuid) SET search_path = '';
ALTER FUNCTION public.rls_auto_enable() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = public;

CREATE INDEX IF NOT EXISTS blocks_blocked_id_idx ON public.blocks(blocked_id);
CREATE INDEX IF NOT EXISTS comment_likes_user_id_idx ON public.comment_likes(user_id);
CREATE INDEX IF NOT EXISTS comments_user_id_idx ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS muted_chats_muted_user_id_idx ON public.muted_chats(muted_user_id);
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS notifications_actor_id_idx ON public.notifications(actor_id);
CREATE INDEX IF NOT EXISTS notifications_comment_id_idx ON public.notifications(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_post_id_idx ON public.notifications(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS story_views_viewer_id_idx ON public.story_views(viewer_id);

NOTIFY pgrst, 'reload schema';
