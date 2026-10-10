DROP POLICY IF EXISTS saved_posts_update ON public.saved_posts;
CREATE POLICY saved_posts_update ON public.saved_posts FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
NOTIFY pgrst, 'reload schema';
