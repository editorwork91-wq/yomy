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

export type PushDeliveryResult = {
  ok: boolean
  error?: string
  data?: Record<string, unknown>
}

async function functionErrorMessage(error: unknown) {
  const candidate = error as { message?: unknown; context?: unknown } | null
  const context = candidate?.context

  if (typeof Response !== 'undefined' && context instanceof Response) {
    try {
      const payload = await context.clone().json() as Record<string, unknown>
      const serverError = payload.error ?? payload.message ?? payload.code
      if (serverError) return String(serverError)
    } catch {
      // Fall through to the SDK error message.
    }
  }

  return typeof candidate?.message === 'string'
    ? candidate.message
    : 'Notification service request failed'
}

export async function sendPushEvent(input: {
  type: PushType
  targetUserId?: string
  title: string
  body: string
  data: Record<string, string>
}): Promise<PushDeliveryResult> {
  try {
    const callKind = input.data.call_kind || input.data.kind || 'voice'
    const safeData = input.type === 'call' && input.data.call_id
      ? {
          ...input.data,
          event_type: 'CALL_INCOMING',
          call_id: input.data.call_id,
          call_kind: callKind,
          push_title: input.title,
          push_body: input.body,
          url: `/messages?call=${encodeURIComponent(input.data.call_id)}`,
        }
      : input.data

    const { data, error } = await supabase.functions.invoke('send-push', {
      body: { ...input, data: safeData },
    })

    if (error) {
      const message = await functionErrorMessage(error)
      console.warn('push delivery request failed:', message)
      return { ok: false, error: message }
    }

    if (data && typeof data === 'object') {
      const result = data as Record<string, unknown>
      const nativeFailed = Number(result.nativeFailed ?? 0)
      const nativeSent = Number(result.nativeSent ?? 0)
      const nativeReason = result.nativeReason ? String(result.nativeReason) : ''

      if (nativeFailed > 0 || nativeSent === 0) {
        console.warn('Yomy native push result:', {
          type: input.type,
          nativeConfigured: result.nativeConfigured,
          nativeAttempted: result.nativeAttempted,
          nativeSent,
          nativeFailed,
          nativeReason: nativeReason || null,
          recipients: result.recipients ?? null,
        })

        if (nativeFailed > 0 && nativeSent === 0) {
          return {
            ok: false,
            error: nativeReason || 'Native push delivery failed',
            data: result,
          }
        }
      }

      return { ok: true, data: result }
    }

    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Notification service unavailable'
    console.warn('push delivery request unavailable:', message)
    return { ok: false, error: message }
  }
}

export async function sendLatestActivityPush(input: {
  targetUserId: string
  actorId: string
  type?: 'like' | 'comment' | 'follow' | 'follow_request' | 'comment_like' | 'story_reply'
  postId?: string
  commentId?: string
}): Promise<PushDeliveryResult> {
  const query = supabase.from('notifications')
    .select('id,type')
    .eq('user_id', input.targetUserId)
    .eq('actor_id', input.actorId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (input.postId) query.eq('post_id', input.postId)
  if (input.commentId) query.eq('comment_id', input.commentId)
  if (input.type) query.eq('type', input.type)

  const { data, error } = await query
  if (error) return { ok: false, error: `NOTIFICATION_LOOKUP_FAILED:${error.message}` }

  const notification = data?.[0]
  if (!notification) return { ok: false, error: 'NOTIFICATION_NOT_FOUND' }

  return sendPushEvent({
    type: 'notification',
    targetUserId: input.targetUserId,
    title: 'Yomy',
    body: input.type === 'like' ? 'liked your post'
      : input.type === 'comment' ? 'commented on your post'
      : input.type === 'follow_request' ? 'sent you a follow request'
      : input.type === 'follow' ? 'started following you'
      : input.type === 'comment_like' ? 'liked your comment'
      : 'new activity',
    data: { notification_id: notification.id },
  })
}
