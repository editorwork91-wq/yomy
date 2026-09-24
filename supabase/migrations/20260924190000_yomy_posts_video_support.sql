begin;

-- Restore the schema's original image + video post capability.
-- Additive/safe: existing rows are untouched.
alter table public.posts
  drop constraint if exists posts_image_only_media_type_check;

alter table public.posts
  drop constraint if exists posts_supported_media_type_check;

alter table public.posts
  add constraint posts_supported_media_type_check
  check (media_type is null or media_type in ('image', 'video'));

notify pgrst, 'reload schema';

commit;
