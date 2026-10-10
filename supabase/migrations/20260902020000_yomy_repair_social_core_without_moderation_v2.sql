CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (length(emoji) between 1 and 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_message_user_emoji_key UNIQUE (message_id, user_id, emoji)
);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id AND (m.sender_id = (select auth.uid()) OR m.receiver_id = (select auth.uid()))));
DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id AND (m.sender_id = (select auth.uid()) OR m.receiver_id = (select auth.uid()))));
DROP POLICY IF EXISTS message_reactions_delete ON public.message_reactions;
CREATE POLICY message_reactions_delete ON public.message_reactions FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
CREATE INDEX IF NOT EXISTS message_reactions_message_id_idx ON public.message_reactions(message_id);

CREATE UNIQUE INDEX IF NOT EXISTS saved_posts_user_id_post_id_key ON public.saved_posts(user_id, post_id);
DROP POLICY IF EXISTS saved_posts_select ON public.saved_posts;
CREATE POLICY saved_posts_select ON public.saved_posts FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS saved_posts_insert ON public.saved_posts;
CREATE POLICY saved_posts_insert ON public.saved_posts FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS saved_posts_delete ON public.saved_posts;
CREATE POLICY saved_posts_delete ON public.saved_posts FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.accept_follow_request(p_follower_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.follows SET status='accepted', accepted_at=COALESCE(accepted_at,now()), declined_at=NULL
  WHERE follower_id=p_follower_id AND following_id=(select auth.uid()) AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow request not found or already handled'; END IF;
  DELETE FROM public.notifications WHERE user_id=(select auth.uid()) AND actor_id=p_follower_id AND type='follow_request';
  INSERT INTO public.notifications(user_id,actor_id,type) VALUES(p_follower_id,(select auth.uid()),'follow') ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_follow_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_follow_request(uuid) TO authenticated;

UPDATE public.posts
SET status='published',
    moderation_status='safe',
    published_at=COALESCE(published_at,created_at,now()),
    moderated_at=COALESCE(moderated_at,now()),
    updated_at=now()
WHERE status IN ('draft','uploading','processing','moderation','pending_moderation','ready');

NOTIFY pgrst, 'reload schema';
