import { supabase } from '@/lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function base64UrlToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

export async function registerPushSubscription(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (!('Notification' in window)) return false
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return false
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
  }
  const json = subscription.toJSON()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 512),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,endpoint' })
  if (error) console.error('push subscription save failed:', error.message)
  return !error
}

export type PushType = 'message' | 'call' | 'notification' | 'post' | 'story'

export async function sendPushEvent(input: {
  type: PushType
  targetUserId?: string
  title: string
  body: string
  data: Record<string, string>
}): Promise<void> {
  const { error } = await supabase.functions.invoke('send-push', { body: input })
  if (error) console.warn('push delivery request failed:', error.message)
}

export async function sendLatestActivityPush(input: {
  targetUserId: string
  actorId: string
  type?: 'like' | 'comment' | 'follow' | 'follow_request' | 'comment_like' | 'story_reply'
  postId?: string
  commentId?: string
}): Promise<void> {
  const query = supabase.from('notifications').select('id,type').eq('user_id', input.targetUserId).eq('actor_id', input.actorId).order('created_at', { ascending: false }).limit(10)
  if (input.postId) query.eq('post_id', input.postId)
  if (input.commentId) query.eq('comment_id', input.commentId)
  if (input.type) query.eq('type', input.type)
  const { data } = await query
  const notification = data?.[0]
  if (!notification) return
  await sendPushEvent({
    type: 'notification',
    targetUserId: input.targetUserId,
    title: 'Yomy',
    body: input.type === 'like' ? 'liked your post' : input.type === 'comment' ? 'commented on your post' : input.type === 'follow_request' ? 'sent you a follow request' : input.type === 'follow' ? 'started following you' : input.type === 'comment_like' ? 'liked your comment' : 'new activity',
    data: { notification_id: notification.id },
  })
}
