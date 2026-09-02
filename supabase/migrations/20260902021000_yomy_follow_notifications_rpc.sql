CREATE OR REPLACE FUNCTION public.follow_user(p_target_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_private boolean; next_status text;
BEGIN
  IF (select auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_target_id = (select auth.uid()) THEN RAISE EXCEPTION 'Cannot follow yourself'; END IF;
  SELECT is_private INTO target_private FROM public.profiles WHERE id=p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  next_status := CASE WHEN target_private THEN 'pending' ELSE 'accepted' END;
  INSERT INTO public.follows(follower_id,following_id,status,accepted_at)
  VALUES((select auth.uid()),p_target_id,next_status,CASE WHEN next_status='accepted' THEN now() ELSE NULL END)
  ON CONFLICT (follower_id,following_id) DO UPDATE SET status=EXCLUDED.status, accepted_at=EXCLUDED.accepted_at, declined_at=NULL;
  IF next_status='pending' THEN
    INSERT INTO public.notifications(user_id,actor_id,type)
    SELECT p_target_id,(select auth.uid()),'follow_request'
    WHERE NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id=p_target_id AND actor_id=(select auth.uid()) AND type='follow_request');
  ELSE
    INSERT INTO public.notifications(user_id,actor_id,type)
    SELECT p_target_id,(select auth.uid()),'follow'
    WHERE NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id=p_target_id AND actor_id=(select auth.uid()) AND type='follow' AND created_at > now()-interval '5 minutes');
  END IF;
  RETURN next_status;
END;
$$;
REVOKE ALL ON FUNCTION public.follow_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.follow_user(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
