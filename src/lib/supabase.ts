import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Never crash the entire React tree because a preview/build environment did not
// inject Vite variables. The app can render a useful diagnostic screen instead.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(
  supabaseUrl || 'https://preview-missing-supabase.invalid',
  supabaseAnonKey || 'preview-missing-key',
  {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  },
)

export type Profile = {
  id: string
  username: string
  full_name: string
  avatar_url: string
  bio: string
  is_private: boolean
  is_verified: boolean
  show_followers_to: 'everyone' | 'followers' | 'nobody'
  show_seen_receipts: boolean
  who_can_message: 'everyone' | 'followers' | 'nobody'
  created_at: string
}

export type PostVisibility = 'public' | 'friends' | 'private'
export type PostStatus = 'draft' | 'uploading' | 'processing' | 'moderation' | 'pending_moderation' | 'ready' | 'published' | 'rejected' | 'archived' | 'deleted'
export type ModerationStatus = 'pending' | 'safe' | 'review' | 'rejected'

export type ModerationResult = {
  safe: boolean
  status: ModerationStatus
  score: number
  categories: Record<string, number>
}

export type Post = {
  id: string
  user_id: string
  media_url: string
  media_type: 'image' | 'video'
  caption: string
  created_at: string
  title: string
  description: string
  visibility: PostVisibility
  is_child_friendly: boolean
  moderation_status: ModerationStatus
  moderation_result: ModerationResult | Record<string, never>
  moderated_at: string | null
  status: PostStatus
  published_at: string | null
  updated_at: string
  profiles?: Profile
  likes?: Like[]
  comments?: Comment[]
  post_tags?: PostTag[]
  _likes_count?: number
  _comments_count?: number
  _liked_by_me?: boolean
  _saved_by_me?: boolean
  _tags?: string[]
  idempotency_key?: string
  media_path?: string
}

export type PostTag = { id: string; post_id: string; tag: string; created_at: string }
export type SavedPost = { id: string; user_id: string; post_id: string; created_at: string }
export type StoryVisibility = 'public' | 'friends' | 'private'
export type Story = { id: string; user_id: string; media_url: string; media_type: 'image' | 'video'; caption: string; expires_at: string; created_at: string; visibility: StoryVisibility; profiles?: Profile; _viewed_by_me?: boolean }
export type Comment = { id: string; post_id: string; user_id: string; content: string; is_pinned: boolean; created_at: string; profiles?: Profile; comment_likes?: { user_id: string }[]; _likes_count?: number; _liked_by_me?: boolean }
export type Like = { id: string; post_id: string; user_id: string; created_at: string }
export type Follow = { id: string; follower_id: string; following_id: string; status: 'accepted' | 'pending'; created_at: string; accepted_at: string | null; declined_at: string | null }
export type MessageReaction = { id: string; message_id: string; user_id: string; emoji: string; created_at: string }
export type Message = { id: string; sender_id: string; receiver_id: string; content: string; media_url: string; media_type: '' | 'image' | 'video' | 'audio'; is_seen: boolean; is_encrypted: boolean; view_once: boolean; view_once_opened: boolean; deleted_at: string | null; deleted_for_everyone: boolean; reply_to_id: string | null; edited_at: string | null; is_request: boolean; request_accepted: boolean; created_at: string; sender?: Profile; receiver?: Profile; reply_to?: Message; message_reactions?: MessageReaction[] }
export type Note = { id: string; user_id: string; content: string; expires_at: string; created_at: string; profiles?: Profile }
export type Notification = { id: string; user_id: string; actor_id: string; type: 'like' | 'comment' | 'follow' | 'follow_request' | 'mention' | 'story_reply' | 'message'; post_id: string | null; comment_id: string | null; message_id: string | null; is_read: boolean; created_at: string; actor?: Profile; post?: Post }
