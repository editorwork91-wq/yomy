-- =====================
-- IDEMPOTENCY KEY + POST LIFECYCLE FIXES
-- =====================

-- Add idempotency_key to posts for preventing duplicate publishes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='idempotency_key') THEN
    ALTER TABLE posts ADD COLUMN idempotency_key text;
  END IF;
END $$;

-- Unique index on idempotency_key (partial — only non-null keys)
CREATE UNIQUE INDEX IF NOT EXISTS posts_idempotency_key_idx
  ON posts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Add media_path column to store storage path for cleanup
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='media_path') THEN
    ALTER TABLE posts ADD COLUMN media_path text;
  END IF;
END $$;

-- Extend status CHECK to include 'pending_moderation'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='posts_status_check') THEN
    ALTER TABLE posts DROP CONSTRAINT posts_status_check;
  END IF;
  ALTER TABLE posts ADD CONSTRAINT posts_status_check
    CHECK (status IN ('draft','uploading','processing','moderation','ready','published','rejected','archived','deleted','pending_moderation'));
END $$;

-- Update can_view_post: owner can see their own posts regardless of moderation status
-- (so they can see rejected/pending posts in their own profile)
CREATE OR REPLACE FUNCTION public.can_view_post(viewer_id uuid, post_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM posts p
    JOIN profiles author ON author.id = p.user_id
    WHERE p.id = post_id
      AND (
        -- Owner can always see their own posts (any status)
        (p.user_id = viewer_id)
        OR (
          -- Others: only published + safe posts
          p.status = 'published'
          AND p.moderation_status = 'safe'
          -- No block in either direction
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b.blocker_id = p.user_id AND b.blocked_id = viewer_id)
               OR (b.blocker_id = viewer_id AND b.blocked_id = p.user_id)
          )
          AND (
            -- Post visibility = public AND account is public
            (p.visibility = 'public' AND author.is_private = false)
            OR (
              p.visibility = 'public'
              AND author.is_private = true
              AND EXISTS (
                SELECT 1 FROM follows f
                WHERE f.follower_id = viewer_id
                  AND f.following_id = p.user_id
                  AND f.status = 'accepted'
              )
            )
            OR (
              p.visibility = 'friends'
              AND EXISTS (
                SELECT 1 FROM follows f1
                WHERE f1.follower_id = viewer_id
                  AND f1.following_id = p.user_id
                  AND f1.status = 'accepted'
              )
              AND EXISTS (
                SELECT 1 FROM follows f2
                WHERE f2.follower_id = p.user_id
                  AND f2.following_id = viewer_id
                  AND f2.status = 'accepted'
              )
            )
          )
        )
      )
  );
$$;
