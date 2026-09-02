import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

const admin = createClient(supabaseUrl, serviceRoleKey)

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) return json(503, { error: 'Push is not configured' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = await req.json().catch(() => null)
  if (!body?.targetUserId || !body?.type || !body?.title || !body?.body) return json(400, { error: 'Invalid payload' })

  const targetId = String(body.targetUserId)
  const type = String(body.type)
  const data = (body.data && typeof body.data === 'object') ? body.data as Record<string, unknown> : {}

  let authorized = false
  if (type === 'message' && data.message_id) {
    const { data: message } = await admin.from('messages').select('id,sender_id,receiver_id,deleted_for_everyone').eq('id', String(data.message_id)).maybeSingle()
    authorized = !!message && message.sender_id === user.id && message.receiver_id === targetId && !message.deleted_for_everyone
  } else if (type === 'call' && data.call_id) {
    const { data: call } = await admin.from('call_sessions').select('id,caller_id,callee_id,status').eq('id', String(data.call_id)).maybeSingle()
    authorized = !!call && call.caller_id === user.id && call.callee_id === targetId && call.status === 'ringing'
  } else if (type === 'notification' && data.notification_id) {
    const { data: notification } = await admin.from('notifications').select('id,actor_id,user_id').eq('id', String(data.notification_id)).maybeSingle()
    authorized = !!notification && notification.actor_id === user.id && notification.user_id === targetId
  }
  if (!authorized) return json(403, { error: 'Not authorized to send this push' })

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  const { data: subscriptions, error: subError } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', targetId)
  if (subError) return json(500, { error: subError.message })

  const payload = JSON.stringify({ type, title: String(body.title), body: String(body.body), tag: `${type}-${data.call_id || data.message_id || Date.now()}`, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) })
  let sent = 0
  for (const subscription of subscriptions || []) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: type === 'call' ? 45 : 300 })
      sent++
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode: number }).statusCode) : 0
      if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', subscription.id)
      console.warn('push send failed:', error)
    }
  }
  return json(200, { sent, total: subscriptions?.length || 0 })
})
