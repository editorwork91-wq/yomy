-- YOMY security/performance hardening
-- Remove unnecessary API execution rights from privileged SECURITY DEFINER helpers,
-- and optimize the high-frequency notification event lookup path.

REVOKE EXECUTE ON FUNCTION public.fire_due_yomy_reminders() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_content() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_call_lifecycle_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_message_lifecycle_event() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS notification_events_actor_id_idx
  ON public.notification_events(actor_id);

DROP POLICY IF EXISTS notification_events_select_own ON public.notification_events;
CREATE POLICY notification_events_select_own
  ON public.notification_events
  FOR SELECT TO authenticated
  USING (recipient_id = (select auth.uid()));
