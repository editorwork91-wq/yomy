INSERT INTO storage.buckets (id, name, public)
VALUES ('messages', 'messages', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Messages authenticated uploads" ON storage.objects;
CREATE POLICY "Messages authenticated uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'messages'
  AND (storage.foldername(name))[1] IN ('images', 'videos', 'audio')
  AND (storage.foldername(name))[2] IS NOT NULL
);

DROP POLICY IF EXISTS "Messages public reads" ON storage.objects;
CREATE POLICY "Messages public reads" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'messages');
