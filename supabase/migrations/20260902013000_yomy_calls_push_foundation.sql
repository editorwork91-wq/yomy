CREATE TABLE IF NOT EXISTS public.call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('voice','video')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','declined','missed','failed')),
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (caller_id <> callee_id)
);

CREATE INDEX IF NOT EXISTS call_sessions_caller_created_idx ON public.call_sessions(caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_sessions_callee_created_idx ON public.call_sessions(callee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_sessions_open_idx ON public.call_sessions(callee_id, status) WHERE status = 'ringing';

CREATE TABLE IF NOT EXISTS public.call_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type IN ('offer','answer','ice-candidate','renegotiate','hangup')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS call_signals_call_created_idx ON public.call_signals(call_id, created_at);
CREATE INDEX IF NOT EXISTS call_signals_recipient_created_idx ON public.call_signals(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions(user_id);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_sessions_select_participants ON public.call_sessions;
CREATE POLICY call_sessions_select_participants ON public.call_sessions
FOR SELECT TO authenticated USING ((select auth.uid()) IN (caller_id, callee_id));

DROP POLICY IF EXISTS call_sessions_insert_caller ON public.call_sessions;
CREATE POLICY call_sessions_insert_caller ON public.call_sessions
FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = caller_id AND caller_id <> callee_id);

DROP POLICY IF EXISTS call_sessions_update_participants ON public.call_sessions;
CREATE POLICY call_sessions_update_participants ON public.call_sessions
FOR UPDATE TO authenticated USING ((select auth.uid()) IN (caller_id, callee_id)) WITH CHECK ((select auth.uid()) IN (caller_id, callee_id));

DROP POLICY IF EXISTS call_signals_select_participants ON public.call_signals;
CREATE POLICY call_signals_select_participants ON public.call_signals
FOR SELECT TO authenticated USING (
  (select auth.uid()) IN (sender_id, recipient_id)
  AND EXISTS (SELECT 1 FROM public.call_sessions c WHERE c.id = call_id AND (select auth.uid()) IN (c.caller_id, c.callee_id))
);

DROP POLICY IF EXISTS call_signals_insert_sender ON public.call_signals;
CREATE POLICY call_signals_insert_sender ON public.call_signals
FOR INSERT TO authenticated WITH CHECK (
  (select auth.uid()) = sender_id
  AND EXISTS (
    SELECT 1 FROM public.call_sessions c
    WHERE c.id = call_id
      AND ((c.caller_id = sender_id AND c.callee_id = recipient_id) OR (c.callee_id = sender_id AND c.caller_id = recipient_id))
  )
);

DROP POLICY IF EXISTS push_subscriptions_owner ON public.push_subscriptions;
CREATE POLICY push_subscriptions_owner ON public.push_subscriptions
FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS push_subscriptions_insert_owner ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_owner ON public.push_subscriptions
FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS push_subscriptions_update_owner ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_owner ON public.push_subscriptions
FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS push_subscriptions_delete_owner ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_owner ON public.push_subscriptions
FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_push_subscriptions_updated_at') THEN
    CREATE TRIGGER set_push_subscriptions_updated_at BEFORE UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

ALTER TABLE public.call_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.call_signals REPLICA IDENTITY FULL;
ALTER TABLE public.push_subscriptions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

NOTIFY pgrst, 'reload schema';
