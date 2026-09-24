import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(supabaseUrl, serviceRoleKey)

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })

  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(authorization.slice(7))
  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const messageId = typeof body?.message_id === 'string' ? body.message_id : ''
  const requestedExpires = Math.floor(Number(body?.expires_in) || 3600)
  const consumeViewOnce = body?.consume_view_once === true

  if (!messageId) return json(400, { error: 'message_id is required' })

  const { data: message, error: messageError } = await admin
    .from('messages')
    .select('id,sender_id,receiver_id,media_url,media_type,media_bucket,media_path,view_once,view_once_limit,view_once_open_count,view_once_opened,deleted_for_everyone')
    .eq('id', messageId)
    .maybeSingle()

  if (messageError || !message || message.deleted_for_everyone) {
    return json(404, { error: 'Message media not found' })
  }

  const participant = message.sender_id === user.id || message.receiver_id === user.id
  if (!participant) return json(404, { error: 'Message media not found' })
  if (!message.media_path) {
    if (message.media_url && !message.view_once) return json(200, { url: message.media_url, expires_in: null, legacy: true })
    return json(404, { error: 'Media path unavailable' })
  }

  let resolved = message
  if (message.view_once) {
    if (message.receiver_id !== user.id) return json(403, { error: 'View-once media is receiver-only' })
    if (!consumeViewOnce) {
      return json(200, {
        locked: true,
        view_once: true,
        view_once_limit: message.view_once_limit || 1,
        view_once_open_count: message.view_once_open_count || 0,
      })
    }

    const { data: claimed, error: claimError } = await admin.rpc('claim_message_view_once', { p_message_id: message.id })
    if (claimError || !claimed) {
      return json(410, {
        error: 'VIEW_ONCE_EXHAUSTED',
        view_once: true,
        view_once_limit: message.view_once_limit || 1,
        view_once_open_count: message.view_once_open_count || 0,
      })
    }
    resolved = claimed
  }

  const expiresIn = resolved.view_once
    ? Math.max(30, Math.min(120, requestedExpires))
    : Math.max(60, Math.min(3600, requestedExpires))

  const bucket = typeof resolved.media_bucket === 'string' && resolved.media_bucket
    ? resolved.media_bucket
    : 'messages-private'

  const { data: signed, error: signedError } = await admin.storage
    .from(bucket)
    .createSignedUrl(resolved.media_path, expiresIn)

  if (signedError || !signed?.signedUrl) {
    console.error('message signed URL failed:', signedError?.message || 'missing URL')
    return json(502, { error: 'Could not create signed media URL' })
  }

  const limit = Number(resolved.view_once_limit || 0)
  const count = Number(resolved.view_once_open_count || 0)

  return json(200, {
    url: signed.signedUrl,
    expires_in: expiresIn,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    view_once: Boolean(resolved.view_once),
    view_once_limit: limit,
    view_once_open_count: count,
    view_once_opened_at: resolved.view_once_opened_at || null,
    remaining_opens: resolved.view_once ? Math.max(0, limit - count) : null,
  })
})
