drop policy if exists stories_select on public.stories;

create policy stories_select
on public.stories
for select to authenticated
using (
  expires_at > now()
  and (
    user_id = (select auth.uid())
    or (
      visibility <> 'private'
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = stories.user_id and b.blocked_id = (select auth.uid()))
           or (b.blocker_id = (select auth.uid()) and b.blocked_id = stories.user_id)
      )
      and exists (
        select 1
        from public.profiles author
        where author.id = stories.user_id
        and (
          (
            stories.visibility = 'public'
            and (
              author.is_private = false
              or exists (
                select 1 from public.follows f
                where f.follower_id = (select auth.uid())
                  and f.following_id = stories.user_id
                  and f.status = 'accepted'
              )
            )
          )
          or (
            stories.visibility = 'friends'
            and exists (
              select 1 from public.follows f1
              where f1.follower_id = (select auth.uid())
                and f1.following_id = stories.user_id
                and f1.status = 'accepted'
            )
            and exists (
              select 1 from public.follows f2
              where f2.follower_id = stories.user_id
                and f2.following_id = (select auth.uid())
                and f2.status = 'accepted'
            )
          )
        )
      )
    )
  )
);
notify pgrst,'reload schema';