-- YOMY professional onboarding: additive, non-destructive.
-- Existing users are treated as already onboarded. New auth users start at phone.

CREATE TABLE IF NOT EXISTS public.user_onboarding (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  step text NOT NULL DEFAULT 'complete'
    CHECK (step IN ('phone', 'name', 'photo', 'agreement', 'complete')),
  completed boolean NOT NULL DEFAULT true,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  legal_terms_accepted boolean NOT NULL DEFAULT false,
  legal_privacy_accepted boolean NOT NULL DEFAULT false,
  legal_community_accepted boolean NOT NULL DEFAULT false,
  legal_version text,
  legal_accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_onboarding_select_own" ON public.user_onboarding;
CREATE POLICY "user_onboarding_select_own"
  ON public.user_onboarding FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_onboarding_insert_own" ON public.user_onboarding;
CREATE POLICY "user_onboarding_insert_own"
  ON public.user_onboarding FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_onboarding_update_own" ON public.user_onboarding;
CREATE POLICY "user_onboarding_update_own"
  ON public.user_onboarding FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.touch_user_onboarding_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_onboarding_touch_updated_at ON public.user_onboarding;
CREATE TRIGGER user_onboarding_touch_updated_at
BEFORE UPDATE ON public.user_onboarding
FOR EACH ROW EXECUTE FUNCTION public.touch_user_onboarding_updated_at();

-- Backfill all existing profiles as complete so this feature never blocks
-- established users. New users are explicitly created as incomplete below.
INSERT INTO public.user_onboarding (user_id, step, completed, started_at, completed_at)
SELECT p.id, 'complete', true, p.created_at, p.created_at
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- Extend the existing signup trigger rather than replacing its profile behavior.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'username', split_part(COALESCE(new.email, ''), '@', 1)),
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_onboarding (
    user_id, step, completed, first_name, last_name, started_at
  )
  VALUES (
    new.id, 'phone', false, '', '', now()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE INDEX IF NOT EXISTS user_onboarding_step_idx
  ON public.user_onboarding(step, completed);

COMMENT ON TABLE public.user_onboarding IS
'Persistent YOMY first-time onboarding progress and private legal consent state.';
