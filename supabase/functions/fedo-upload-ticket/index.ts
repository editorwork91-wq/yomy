import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })

const mainUrl = Deno.env.get('SUPABASE_URL')!
const mainServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const mainAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

type Shard = {
  name?: string
  url: string
  service_role_key: string
  anon_key: string
  bucket?: string
  thumbnail_bucket?: string
}

function loadShards(): Shard[] {
  const raw = Deno.env.get('MEDIA_SHARDS_JSON')
  if (!raw) {
    return [{
      name: 'yomy-main',
      url: mainUrl,
      service_role_key: mainServiceKey,
      anon_key: mainAnonKey,
      bucket: 'fedos',
      thumbnail_bucket: 'fedo-thumbnails',
    }]
  }

  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('MEDIA_SHARDS_JSON_INVALID')

  const shards = parsed.filter((value: unknown): value is Shard => {
    if (!value || typeof value !== 'object') return false
    const shard = value as Shard
    return typeof shard.url === 'string'
      && typeof shard.service_role_key === 'string'
      && typeof shard.anon_key === 'string'
  })

  if (!shards.length) throw new Error('MEDIA_SHARDS_JSON_NO_VALID_SHARDS')
  return shards
}

function directStorageHost(projectUrl: string) {
  const url = new URL(projectUrl)
  const ref = url.hostname.split('.')[0]
  return `https://${ref}.storage.supabase.co`
}

function hash(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619)
  return h >>> 0
}

function validVideoType(contentType: string) {
  return ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'].includes(contentType)
}

function validThumbnailType(contentType: string) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })

  const authClient = createClient(mainUrl, mainServiceKey)
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(auth.slice(7))

  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const filename = typeof body?.filename === 'string' ? body.filename.slice(0, 240) : ''
  const kind = body?.kind === 'thumbnail' ? 'thumbnail' : 'video'
  const defaultType = kind === 'thumbnail' ? 'image/jpeg' : 'video/mp4'
  const contentType = typeof body?.contentType === 'string'
    ? body.contentType.toLowerCase()
    : defaultType

  if (!filename) return json(400, { error: 'filename is required' })
  if (kind === 'video' && !validVideoType(contentType)) return json(400, { error: 'Unsupported Fedo video type' })
  if (kind === 'thumbnail' && !validThumbnailType(contentType)) return json(400, { error: 'Unsupported Fedo thumbnail type' })

  try {
    const shards = loadShards()
    const requestedShardRaw = body?.shard
    const requestedShard = typeof requestedShardRaw === 'number' && Number.isInteger(requestedShardRaw) ? requestedShardRaw : -1
    const index = requestedShard >= 0 && requestedShard < shards.length
      ? requestedShard
      : hash(`${user.id}:${crypto.randomUUID()}`) % shards.length
    const shard = shards[index]

    const bucket = kind === 'thumbnail'
      ? (shard.thumbnail_bucket || 'fedo-thumbnails')
      : (shard.bucket || 'fedos')

    const extension = kind === 'thumbnail'
      ? (contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg')
      : (filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'mp4')

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const path = `${user.id}/${year}/${month}/${crypto.randomUUID()}.${extension}`

    const client = createClient(shard.url, shard.service_role_key)
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false })

    if (error || !data?.token) {
      console.error('Signed upload URL creation failed:', error?.message || 'missing token')
      return json(502, { error: 'Could not create upload ticket' })
    }

    return json(200, {
      shard: index,
      node_id: shard.name || `fedo-video-node-${String(index + 1).padStart(2, '0')}`,
      bucket,
      path,
      token: data.token,
      storage_url: shard.url,
      storage_host: directStorageHost(shard.url),
      anon_key: shard.anon_key,
      kind,
      content_type: contentType,
    })
  } catch (error) {
    console.error('Fedo upload ticket failed:', error)
    return json(500, {
      error: error instanceof Error ? error.message.slice(0, 160) : 'UPLOAD_TICKET_FAILED',
    })
  }
})
