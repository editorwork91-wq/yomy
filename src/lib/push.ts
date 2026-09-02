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
  }, { onConflict: 'user_id,endpoint' })
  if (error) console.error('push subscription save failed:', error.message)
  return !error
}

export async function sendPushEvent(input: {
  type: 'message' | 'call' | 'notification'
  targetUserId: string
  title: string
  body: string
  data: Record<string, string>
}): Promise<void> {
  const { error } = await supabase.functions.invoke('send-push', { body: input })
  if (error) console.warn('push delivery request failed:', error.message)
}
