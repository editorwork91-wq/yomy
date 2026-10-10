begin;

-- Restore the Fedo media contract: private objects + signed playback only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fedo-thumbnails',
  'fedo-thumbnails',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set public = false,
    file_size_limit = coalesce(file_size_limit, 524288000),
    allowed_mime_types = coalesce(
      allowed_mime_types,
      array['video/mp4','video/webm','video/quicktime','video/x-m4v']
    )
where id = 'fedos';

drop policy if exists fedo_comments_read on public.fedo_comments;
drop policy if exists fedo_comments_write on public.fedo_comments;

create policy fedo_comments_read
on public.fedo_comments
for select
to public
using (
  exists (
    select 1
    from public.fedos f
    where f.id = fedo_comments.fedo_id
      and f.status = 'published'
      and (
        f.visibility = 'public'
        or f.user_id = (select auth.uid())
        or (
          f.visibility = 'followers'
          and exists (
            select 1 from public.follows fo
            where fo.follower_id = (select auth.uid())
              and fo.following_id = f.user_id
              and fo.status = 'accepted'
          )
        )
      )
  )
);

create policy fedo_comments_write
on public.fedo_comments
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.fedos f
    where f.id = fedo_comments.fedo_id
      and f.status = 'published'
      and (
        f.visibility = 'public'
        or f.user_id = (select auth.uid())
        or (
          f.visibility = 'followers'
          and exists (
            select 1 from public.follows fo
            where fo.follower_id = (select auth.uid())
              and fo.following_id = f.user_id
              and fo.status = 'accepted'
          )
        )
      )
  )
);

create policy fedo_comments_delete_own
on public.fedo_comments
for delete
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists fedo_likes_read on public.fedo_likes;
drop policy if exists fedo_likes_write on public.fedo_likes;

create policy fedo_likes_read
on public.fedo_likes
for select
to public
using (
  exists (
    select 1
    from public.fedos f
    where f.id = fedo_likes.fedo_id
      and f.status = 'published'
      and (
        f.visibility = 'public'
        or f.user_id = (select auth.uid())
        or (
          f.visibility = 'followers'
          and exists (
            select 1 from public.follows fo
            where fo.follower_id = (select auth.uid())
              and fo.following_id = f.user_id
              and fo.status = 'accepted'
          )
        )
      )
  )
);

create policy fedo_likes_insert
on public.fedo_likes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.fedos f
    where f.id = fedo_likes.fedo_id
      and f.status = 'published'
  )
);

create policy fedo_likes_delete
on public.fedo_likes
for delete
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists fedo_saves_own on public.fedo_saves;

create policy fedo_saves_insert
on public.fedo_saves
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy fedo_saves_delete
on public.fedo_saves
for delete
to authenticated
using (user_id = (select auth.uid()));

create policy fedo_saves_select
on public.fedo_saves
for select
to authenticated
using (user_id = (select auth.uid()));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.posts'::regclass
      and conname = 'posts_image_only_media_type_check'
  ) then
    alter table public.posts
      add constraint posts_image_only_media_type_check
      check (media_type is null or media_type = 'image');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
