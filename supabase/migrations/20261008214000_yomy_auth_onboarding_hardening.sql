-- YOMY auth/onboarding hardening: additive and non-destructive.
-- Prevent Google/social sign-ups from failing on username collisions or short email prefixes.
-- Keep existing profiles unchanged; only create missing onboarding state.

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
SET search_path = public, pg_catalog
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

-- Existing accounts are already considered established.
INSERT INTO public.user_onboarding (user_id, step, completed, started_at, completed_at)
SELECT u.id, 'complete', true, coalesce(u.created_at, now()), coalesce(u.created_at, now())
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_onboarding o WHERE o.user_id = u.id
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  requested_username text;
  base_username text;
  candidate_username text;
  full_name_value text;
  avatar_url_value text;
BEGIN
  requested_username := lower(coalesce(
    new.raw_user_meta_data->>'username',
    split_part(coalesce(new.email, ''), '@', 1),
    ''
  ));

  base_username := regexp_replace(requested_username, '[^a-z0-9_.]', '', 'g');
  IF char_length(base_username) < 3 THEN
    base_username := 'yomyuser';
  END IF;

  base_username := left(base_username, 30);
  candidate_username := base_username;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.username = candidate_username) THEN
    candidate_username :=
      left(base_username, 23) || '_' || substr(replace(new.id::text, '-', ''), 1, 6);

    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.username = candidate_username) THEN
      candidate_username :=
        left(base_username, 16) || '_' ||
        substr(md5(new.id::text || coalesce(new.email, '')), 1, 13);
    END IF;
  END IF;

  full_name_value := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    ''
  );

  avatar_url_value := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', ''),
    ''
  );

  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new.id,
    candidate_username,
    full_name_value,
    avatar_url_value
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_onboarding (
    user_id,
    step,
    completed,
    first_name,
    last_name,
    started_at
  )
  VALUES (
    new.id,
    'phone',
    false,
    '',
    '',
    now()
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
