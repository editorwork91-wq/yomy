import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const firebaseServiceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')

const admin = createClient(supabaseUrl, serviceRoleKey)

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function toStringRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]))
}

async function resolveTargets(type: string, targetId: string | null, data: Record<string, unknown>, actorId: string) {
  if (targetId) return [targetId]

  if (type === 'post' && data.post_id) {
    const { data: post } = await admin.from('posts').select('id,user_id,status,visibility').eq('id', String(data.post_id)).maybeSingle()
    if (!post || post.user_id !== actorId || post.status !== 'published') return []
    const { data: followers } = await admin.from('follows').select('follower_id').eq('following_id', actorId).eq('status', 'accepted')
    return (followers || []).map(row => row.follower_id).filter((id: string) => id !== actorId)
  }

  if (type === 'story' && data.story_id) {
    const { data: story } = await admin.from('stories').select('id,user_id,expires_at,visibility').eq('id', String(data.story_id)).maybeSingle()
    if (!story || story.user_id !== actorId || new Date(story.expires_at).getTime() <= Date.now()) return []
    const { data: followers } = await admin.from('follows').select('follower_id').eq('following_id', actorId).eq('status', 'accepted')
    return (followers || []).map(row => row.follower_id).filter((id: string) => id !== actorId)
  }

  return []
}

async function sendNative(tokens: string[], title: string, body: string, data: Record<string, string>, type: string) {
  if (!firebaseServiceAccount || tokens.length === 0) return 0
  try {
    const service = JSON.parse(firebaseServiceAccount) as { project_id: string; client_email: string; private_key: string }
    const { getApps, initializeApp, cert } = await import('npm:firebase-admin@13.4.0/app')
    const { getMessaging } = await import('npm:firebase-admin@13.4.0/messaging')
    const app = getApps().find(current => current.name === 'yomy-push') || initializeApp({ credential: cert(service) }, 'yomy-push')
    const messaging = getMessaging(app)
    let sent = 0
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500)
      const result = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data,
        android: { priority: 'high', notification: { channelId: type === 'call' ? 'yomy_calls' : 'yomy_default', sound: 'default' } },
        apns: { payload: { aps: { sound: 'default', 'content-available': 1 } } },
      })
      sent += result.successCount
      for (let j = 0; j < result.responses.length; j++) {
        const response = result.responses[j]
        if (!response.success && response.error) {
          const code = response.error.code
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            await admin.from('native_push_tokens').delete().eq('token', batch[j])
          }
        }
      }
    }
    return sent
  } catch (error) {
    console.warn('native push delivery unavailable:', error)
    return 0
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = await req.json().catch(() => null)
  if (!body?.type || !body?.title || !body?.body) return json(400, { error: 'Invalid payload' })

  const type = String(body.type)
  const targetId = body.targetUserId ? String(body.targetUserId) : null
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {}
  const targets = await resolveTargets(type, targetId, data, user.id)
  if (targets.length === 0) return json(403, { error: 'No authorized notification targets' })

  if (type === 'notification') {
    if (!data.notification_id || !targetId) return json(400, { error: 'notification_id and targetUserId are required' })
    const { data: notification } = await admin.from('notifications').select('id,actor_id,user_id').eq('id', String(data.notification_id)).maybeSingle()
    if (!notification || notification.actor_id !== user.id || notification.user_id !== targetId) return json(403, { error: 'Not authorized to send this push' })
  } else if (type === 'message') {
    const { data: message } = await admin.from('messages').select('id,sender_id,receiver_id,deleted_for_everyone').eq('id', String(data.message_id || '')).maybeSingle()
    if (!message || message.sender_id !== user.id || message.receiver_id !== targetId || message.deleted_for_everyone) return json(403, { error: 'Not authorized to send this push' })
  } else if (type === 'call') {
    const { data: call } = await admin.from('call_sessions').select('id,caller_id,callee_id,status').eq('id', String(data.call_id || '')).maybeSingle()
    if (!call || call.caller_id !== user.id || call.callee_id !== targetId || call.status !== 'ringing') return json(403, { error: 'Not authorized to send this push' })
  } else if (!['post', 'story'].includes(type)) {
    return json(400, { error: 'Unsupported push type' })
  }

  const payloadData = toStringRecord(data)
  let webSent = 0
  if (vapidSubject && vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const { data: subscriptions } = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', targets)
    const payload = JSON.stringify({ type, title: String(body.title), body: String(body.body), tag: `${type}-${payloadData.call_id || payloadData.message_id || payloadData.post_id || payloadData.story_id || Date.now()}`, data: payloadData })
    for (const subscription of subscriptions || []) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: type === 'call' ? 45 : 300 })
        webSent++
      } catch (error) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode: number }).statusCode) : 0
        if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', subscription.id)
      }
    }
  }

  const { data: nativeTokens } = await admin.from('native_push_tokens').select('token').in('user_id', targets)
  const nativeSent = await sendNative((nativeTokens || []).map(row => row.token), String(body.title), String(body.body), payloadData, type)
  return json(200, { webSent, nativeSent, recipients: targets.length })
})
