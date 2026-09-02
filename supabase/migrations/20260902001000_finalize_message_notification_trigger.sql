-- Yomy: rebuild the message notification trigger after message schema changes.
-- This keeps message delivery resilient while ensuring the trigger sees the current row shape.

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.sender_id IS DISTINCT FROM NEW.receiver_id
     AND COALESCE(NEW.deleted_for_everyone, false) = false THEN
    INSERT INTO public.notifications(user_id, actor_id, type, message_id)
    VALUES (NEW.receiver_id, NEW.sender_id, 'message', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'YOMY message notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_new_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_activity_notification ON public.messages;
CREATE TRIGGER messages_activity_notification
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_message();

NOTIFY pgrst, 'reload schema';
