import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const huaweiClientId = Deno.env.get('HUAWEI_CLIENT_ID')
const huaweiClientSecret = Deno.env.get('HUAWEI_CLIENT_SECRET')
const admin = createClient(supabaseUrl, serviceRoleKey)

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function huaweiAccessToken() {
  if (!huaweiClientId || !huaweiClientSecret) throw new Error('HUAWEI_OAUTH_CREDENTIALS_MISSING')
  const response = await fetch('https://oauth-login.cloud.huawei.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: huaweiClientId,
      client_secret: huaweiClientSecret,
    }),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || typeof result.access_token !== 'string') {
    const detail = typeof result.error_description === 'string' ? result.error_description : ''
    throw new Error('HUAWEI_OAUTH_' + response.status + (detail ? ':' + detail.slice(0, 140) : ''))
  }
  return result.access_token
}

function errorText(status: number, body: Record<string, unknown>) {
  const code = typeof body.code === 'string' ? body.code : ''
  const msg = typeof body.msg === 'string' ? body.msg : ''
  if (code) return 'HMS_' + status + '_' + code
  if (msg) return 'HMS_' + status + ':' + msg.slice(0, 180)
  return 'HMS_' + status
}

function toStringRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)]))
}

function isSleeping(profile: Record<string, unknown>) {
  if (!profile.sleep_mode_enabled) return false
  try {
    const clock = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: String(profile.timezone_name || 'UTC'),
    }).format(new Date())
    const minutes = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
    const startRaw = String(profile.sleep_start || '22:00')
    const endRaw = String(profile.sleep_end || '05:00')
    const start = Number(startRaw.slice(0, 2)) * 60 + Number(startRaw.slice(3, 5))
    const end = Number(endRaw.slice(0, 2)) * 60 + Number(endRaw.slice(3, 5))
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
  } catch {
    return false
  }
}

async function resolveTargets(type: string, targetId: string | null, data: Record<string, unknown>, actorId: string) {
  if (targetId && !['post', 'story'].includes(type)) return [targetId]

  if (type === 'post' && data.post_id) {
    const { data: post } = await admin.from('posts').select('id,user_id,status')
      .eq('id', String(data.post_id)).maybeSingle()
    if (!post || post.user_id !== actorId || post.status !== 'published') return []
    const { data: followers } = await admin.from('follows').select('follower_id')
      .eq('following_id', actorId).eq('status', 'accepted')
    return (followers || []).map(row => row.follower_id).filter((id: string) => id !== actorId)
  }

  if (type === 'story' && data.story_id) {
    const { data: story } = await admin.from('stories').select('id,user_id,expires_at')
      .eq('id', String(data.story_id)).maybeSingle()
    if (!story || story.user_id !== actorId || new Date(story.expires_at).getTime() <= Date.now()) return []
    const { data: followers } = await admin.from('follows').select('follower_id')
      .eq('following_id', actorId).eq('status', 'accepted')
    return (followers || []).map(row => row.follower_id).filter((id: string) => id !== actorId)
  }

  return []
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })
  const accessToken = authHeader.slice('Bearer '.length)

  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken)
  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = await req.json().catch(() => null)
  if (!body?.type || !body?.title || !body?.body) return json(400, { error: 'Invalid payload' })

  const type = String(body.type)
  const targetId = body.targetUserId ? String(body.targetUserId) : null
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {}
  const targets = await resolveTargets(type, targetId, data, user.id)
  if (!targets.length) return json(403, { error: 'No authorized notification targets' })

  const { data: profiles } = await admin.from('profiles')
    .select('id,sleep_mode_enabled,sleep_start,sleep_end,timezone_name').in('id', targets)
  const activeTargets = (profiles || []).filter(profile => !isSleeping(profile)).map(profile => profile.id)

  if (!activeTargets.length) return json(200, {
    webSent: 0, nativeSent: 0, nativeFailed: 0,
    nativeConfigured: Boolean(huaweiClientId && huaweiClientSecret),
    nativeAttempted: false, nativeReason: 'SLEEP_MODE', recipients: 0,
  })

  if (type === 'notification') {
    if (!data.notification_id || !targetId) return json(400, { error: 'notification_id and targetUserId are required' })
    const { data: notification } = await admin.from('notifications').select('id,actor_id,user_id')
      .eq('id', String(data.notification_id)).maybeSingle()
    if (!notification || notification.actor_id !== user.id || notification.user_id !== targetId) {
      return json(403, { error: 'Not authorized to send this push' })
    }
  } else if (type === 'message') {
    const { data: message } = await admin.from('messages')
      .select('id,sender_id,receiver_id,deleted_for_everyone').eq('id', String(data.message_id || '')).maybeSingle()
    if (!message || message.sender_id !== user.id || message.receiver_id !== targetId || message.deleted_for_everyone) {
      return json(403, { error: 'Not authorized to send this push' })
    }
  } else if (type === 'call') {
    const { data: call } = await admin.from('call_sessions')
      .select('id,caller_id,callee_id,status').eq('id', String(data.call_id || '')).maybeSingle()
    if (!call || call.caller_id !== user.id || call.callee_id !== targetId || call.status !== 'ringing') {
      return json(403, { error: 'Not authorized to send this push' })
    }
  } else if (!['post', 'story'].includes(type)) {
    return json(400, { error: 'Unsupported push type' })
  }

  if (!huaweiClientId || !huaweiClientSecret) return json(503, {
    error: 'Huawei Push is not configured', nativeConfigured: false, nativeAttempted: false,
    nativeSent: 0, nativeFailed: 0, nativeReason: 'HUAWEI_CLIENT_CREDENTIALS_MISSING',
    recipients: activeTargets.length,
  })

  const { data: tokenRows, error: tokenError } = await admin.from('native_push_tokens')
    .select('token').in('user_id', activeTargets).eq('platform', 'huawei')
  if (tokenError) return json(500, { error: 'Huawei token lookup failed', detail: tokenError.message })

  const tokens = (tokenRows || []).map(row => String(row.token)).filter(Boolean)
  if (!tokens.length) return json(200, {
    webSent: 0, nativeSent: 0, nativeFailed: 0, nativeConfigured: true,
    nativeAttempted: false, nativeReason: 'NO_HUAWEI_TOKENS', recipients: activeTargets.length,
  })

  try {
    const bearer = await huaweiAccessToken()
    const payloadData = toStringRecord({
      ...data,
      event_type: type === 'call' ? 'CALL_INCOMING' : (data.event_type || type.toUpperCase()),
      push_title: String(body.title),
      push_body: String(body.body),
      url: typeof data.url === 'string' && data.url ? data.url
        : typeof data.deep_link === 'string' && data.deep_link ? data.deep_link
        : '/notifications',
    })

    let sent = 0
    let failed = 0
    let firstReason = ''

    for (const token of tokens) {
      const response = await fetch(
        'https://push-api.cloud.huawei.com/v1/' + encodeURIComponent(huaweiClientId) + '/messages:send',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + bearer,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            validate_only: false,
            message: {
              data: JSON.stringify(payloadData),
              android: { delivery_priority: 'HIGH', ttl: '60s' },
              token: [token],
            },
          }),
        },
      )

      const result = await response.json().catch(() => ({})) as Record<string, unknown>
      const code = String(result.code || '')
      if (response.ok && (!code || code === '80000000')) {
        sent += 1
        continue
      }

      failed += 1
      if (!firstReason) firstReason = errorText(response.status, result)
    }

    await admin.from('push_delivery_diagnostics').insert({
      actor_id: user.id, push_type: type, target_count: activeTargets.length, token_count: tokens.length,
      firebase_configured: false, fcm_attempted: true, fcm_sent: sent, fcm_failed: failed,
      fcm_reason: firstReason ? 'HMS:' + firstReason : null,
    })

    if (failed > 0 && sent === 0) return json(502, {
      error: 'Huawei push delivery failed', nativeConfigured: true, nativeAttempted: true,
      nativeSent: sent, nativeFailed: failed, nativeReason: firstReason || 'HMS delivery failed',
      recipients: activeTargets.length,
    })

    return json(200, {
      webSent: 0, nativeSent: sent, nativeFailed: failed, nativeConfigured: true,
      nativeAttempted: true, nativeReason: firstReason || null, recipients: activeTargets.length,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 220) : 'HUAWEI_PUSH_EXCEPTION'
    await admin.from('push_delivery_diagnostics').insert({
      actor_id: user.id, push_type: type, target_count: activeTargets.length, token_count: tokens.length,
      firebase_configured: false, fcm_attempted: true, fcm_sent: 0, fcm_failed: tokens.length,
      fcm_reason: 'HMS:' + reason,
    })
    return json(502, {
      error: 'Huawei push delivery exception', nativeConfigured: true, nativeAttempted: true,
      nativeSent: 0, nativeFailed: tokens.length, nativeReason: reason,
      recipients: activeTargets.length,
    })
  }
})
