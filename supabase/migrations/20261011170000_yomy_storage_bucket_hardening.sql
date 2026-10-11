-- Configure upload limits by YOMY media role. Existing files and bucket visibility are preserved.
-- Public/private modes and RLS policies are not changed by this migration.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('posts', 'posts', true, 104857600, ARRAY['image/*','video/*']),
  ('messages', 'messages', true, 52428800, ARRAY['image/*','video/*','audio/*']),
  ('messages-private', 'messages-private', false, 104857600, ARRAY['image/*','video/*','audio/*','application/*','text/plain']),
  ('profile-avatars', 'profile-avatars', true, 5242880, ARRAY['image/*']),
  ('stories-private', 'stories-private', false, 52428800, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']),
  ('fedos', 'fedos', false, 524288000, ARRAY['video/mp4','video/webm','video/quicktime','video/x-m4v']),
  ('fedo-thumbnails', 'fedo-thumbnails', false, 10485760, ARRAY['image/jpeg','image/png','image/webp']),
  ('chat-stickers', 'chat-stickers', false, 10485760, ARRAY['image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Apply the chosen limits to existing buckets too; ON CONFLICT above only covers missing buckets.
UPDATE storage.buckets SET file_size_limit = 104857600, allowed_mime_types = ARRAY['image/*','video/*']
WHERE id = 'posts';
UPDATE storage.buckets SET file_size_limit = 52428800, allowed_mime_types = ARRAY['image/*','video/*','audio/*']
WHERE id = 'messages';
UPDATE storage.buckets SET file_size_limit = 104857600, allowed_mime_types = ARRAY['image/*','video/*','audio/*','application/*','text/plain']
WHERE id = 'messages-private';
UPDATE storage.buckets SET file_size_limit = 5242880, allowed_mime_types = ARRAY['image/*']
WHERE id = 'profile-avatars';
UPDATE storage.buckets SET file_size_limit = 52428800, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
WHERE id = 'stories-private';
UPDATE storage.buckets SET file_size_limit = 524288000, allowed_mime_types = ARRAY['video/mp4','video/webm','video/quicktime','video/x-m4v']
WHERE id = 'fedos';
UPDATE storage.buckets SET file_size_limit = 10485760, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'fedo-thumbnails';
UPDATE storage.buckets SET file_size_limit = 10485760, allowed_mime_types = ARRAY['image/png','image/webp']
WHERE id = 'chat-stickers';
