DROP POLICY IF EXISTS notifications_insert ON public.notifications;
NOTIFY pgrst, 'reload schema';
