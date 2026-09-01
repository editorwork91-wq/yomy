-- YOMY: realtime inbox previews + server notification events
-- Safe to run after the existing production hardening migrations.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'mention', 'story_reply', 'message'));

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_message_id_idx
  ON public.notifications(message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON public.messages(sender_id, receiver_id, created_at DESC);

-- The client must not manufacture notification records. Database events do it.
CREATE OR REPLACE FUNCTION public.create_activity_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
END;
$$;

REVOKE ALL ON FUNCTION public.create_activity_notification() FROM PUBLIC;

DROP TRIGGER IF EXISTS likes_activity_notification ON public.likes;
CREATE TRIGGER likes_activity_notification
AFTER INSERT ON public.likes
FOR EACH ROW EXECUTE FUNCTION public.create_activity_notification();

DROP TRIGGER IF EXISTS comments_activity_notification ON public.comments;
CREATE TRIGGER comments_activity_notification
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.create_activity_notification();

DROP TRIGGER IF EXISTS comment_likes_activity_notification ON public.comment_likes;
CREATE TRIGGER comment_likes_activity_notification
AFTER INSERT ON public.comment_likes
FOR EACH ROW EXECUTE FUNCTION public.create_activity_notification();

DROP TRIGGER IF EXISTS messages_activity_notification ON public.messages;
CREATE TRIGGER messages_activity_notification
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.create_activity_notification();

COMMENT ON COLUMN public.notifications.message_id IS
'Links a realtime inbox notification to the message that created it.';
