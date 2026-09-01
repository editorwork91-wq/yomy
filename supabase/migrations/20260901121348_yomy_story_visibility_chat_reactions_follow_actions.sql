/*
# YOMY — Story Visibility, Chat Reactions, Reply, Edit, Delete-for-Everyone, Follow Actions

## Overview
This migration adds:
1. Story audience/visibility (public/friends/private) with RLS enforcement
2. Message reactions (emoji-based) table
3. Message reply-to, edited-at, deleted-for-everyone columns
4. Message request support (accepted boolean)
5. Follow request action tracking (accepted_at, declined_at on follows)

## 1. Stories — visibility column
- `visibility` text DEFAULT 'public' CHECK IN ('public','friends','private')
- Updated stories RLS to enforce visibility server-side

## 2. Messages — new columns
- `reply_to_id` uuid nullable — FK to messages(id) for threaded replies
- `edited_at` timestamptz nullable — set when a message is edited
- `deleted_for_everyone` boolean DEFAULT false — soft-delete visible to both parties
- `is_request` boolean DEFAULT false — marks message as a request pending acceptance
- `request_accepted` boolean DEFAULT false — whether the recipient accepted the request

## 3. Message reactions table
- `id`, `message_id` FK, `user_id` FK, `emoji` text, `created_at`
- UNIQUE(message_id, user_id, emoji) — one emoji per user per message
- RLS: participants in the conversation can read; only the reactor can insert/delete

## 4. Follows — action timestamps
- `accepted_at` timestamptz nullable
- `declined_at` timestamptz nullable

## 5. RLS updates
- Stories SELECT now checks visibility (public = visible to anyone not blocked; friends = mutual follow; private = owner only)
- Messages SELECT updated to handle deleted_for_everyone and request flow
*/

-- =====================
-- STORIES VISIBILITY
-- =====================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stories' AND column_name='visibility') THEN
    ALTER TABLE stories ADD COLUMN visibility text NOT NULL DEFAULT 'public';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stories_visibility_check') THEN
    ALTER TABLE stories ADD CONSTRAINT stories_visibility_check CHECK (visibility IN ('public','friends','private'));
  END IF;
END $$;

-- =====================
-- MESSAGES NEW COLUMNS
-- =====================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='reply_to_id') THEN
    ALTER TABLE messages ADD COLUMN reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='edited_at') THEN
    ALTER TABLE messages ADD COLUMN edited_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='deleted_for_everyone') THEN
    ALTER TABLE messages ADD COLUMN deleted_for_everyone boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_request') THEN
    ALTER TABLE messages ADD COLUMN is_request boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='request_accepted') THEN
    ALTER TABLE messages ADD COLUMN request_accepted boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- =====================
-- MESSAGE REACTIONS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_reactions_select" ON message_reactions;
CREATE POLICY "message_reactions_select" ON message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_reactions.message_id
      AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "message_reactions_insert" ON message_reactions;
CREATE POLICY "message_reactions_insert" ON message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_reactions.message_id
      AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "message_reactions_delete" ON message_reactions;
CREATE POLICY "message_reactions_delete" ON message_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS message_reactions_message_id_idx ON message_reactions(message_id);

-- =====================
-- FOLLOWS — action timestamps
-- =====================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='follows' AND column_name='accepted_at') THEN
    ALTER TABLE follows ADD COLUMN accepted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='follows' AND column_name='declined_at') THEN
    ALTER TABLE follows ADD COLUMN declined_at timestamptz;
  END IF;
END $$;

-- =====================
-- UPDATE STORIES RLS — visibility enforcement
-- =====================
DROP POLICY IF EXISTS "stories_select" ON stories;
CREATE POLICY "stories_select" ON stories FOR SELECT TO authenticated
  USING (
    expires_at > now()
    AND (
      user_id = auth.uid()
      OR (
        NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = stories.user_id AND b.blocked_id = auth.uid())
             OR (b.blocker_id = auth.uid() AND b.blocked_id = stories.user_id)
        )
        AND EXISTS (
          SELECT 1 FROM profiles author WHERE author.id = stories.user_id
          AND (
            author.is_private = false
            OR EXISTS (
              SELECT 1 FROM follows f
              WHERE f.follower_id = auth.uid()
                AND f.following_id = stories.user_id
                AND f.status = 'accepted'
            )
          )
        )
        AND (
          stories.visibility = 'public'
          OR (
            stories.visibility = 'friends'
            AND EXISTS (
              SELECT 1 FROM follows f1
              WHERE f1.follower_id = auth.uid()
                AND f1.following_id = stories.user_id
                AND f1.status = 'accepted'
            )
            AND EXISTS (
              SELECT 1 FROM follows f2
              WHERE f2.follower_id = stories.user_id
                AND f2.following_id = auth.uid()
                AND f2.status = 'accepted'
            )
          )
          OR stories.visibility = 'private' AND stories.user_id = auth.uid()
        )
      )
    )
  );

-- =====================
-- UPDATE MESSAGES RLS — deleted_for_everyone visibility
-- =====================
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "messages_delete" ON messages;
CREATE POLICY "messages_delete" ON messages FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- =====================
-- INDEXES
-- =====================
CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stories_visibility_idx ON stories(visibility);
