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

const mainUrl = Deno.env.get('SUPABASE_URL')!
const mainServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
    return [{ name: 'yomy-main', url: mainUrl, service_role_key: mainServiceKey, anon_key: '', bucket: 'fedos', thumbnail_bucket: 'fedo-thumbnails' }]
  }
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('MEDIA_SHARDS_JSON_INVALID')
  const shards = parsed.filter((value: unknown): value is Shard => {
    if (!value || typeof value !== 'object') return false
    const shard = value as Shard
    return typeof shard.url === 'string' && typeof shard.service_role_key === 'string'
  })
  if (!shards.length) throw new Error('MEDIA_SHARDS_JSON_NO_VALID_SHARDS')
  return shards
}

async function canView(client: ReturnType<typeof createClient>, userId: string, fedo: { user_id: string; status: string; visibility: string }) {
  if (fedo.status !== 'published' && fedo.user_id !== userId) return false
  if (fedo.user_id === userId) return true
  if (fedo.visibility === 'public') return true
  if (fedo.visibility !== 'followers') return false

  const { data } = await client
    .from('follows')
    .select('id')
    .eq('follower_id', userId)
    .eq('following_id', fedo.user_id)
    .eq('status', 'accepted')
    .maybeSingle()

  return Boolean(data)
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
  const fedoId = typeof body?.fedo_id === 'string' ? body.fedo_id : ''
  const asset = body?.asset === 'thumbnail' ? 'thumbnail' : 'video'
  const requestedExpires = Math.floor(Number(body?.expires_in) || 3600)
  const expiresIn = Math.max(60, Math.min(3600, requestedExpires))

  if (!fedoId) return json(400, { error: 'fedo_id is required' })

  try {
    const { data: fedo, error: fedoError } = await authClient
      .from('fedos')
      .select('id,user_id,media_path,thumbnail_path,thumbnail_url,status,visibility,storage_shard,storage_node')
      .eq('id', fedoId)
      .maybeSingle()

    if (fedoError) return json(500, { error: 'Could not load Fedo metadata' })
    if (!fedo || !(await canView(authClient, user.id, fedo))) return json(404, { error: 'Fedo not found' })

    if (asset === 'thumbnail' && !fedo.thumbnail_path) {
      if (typeof fedo.thumbnail_url === 'string' && /^https?:\/\//i.test(fedo.thumbnail_url)) {
        return json(200, { url: fedo.thumbnail_url, expires_in: null, asset, legacy: true })
      }
      return json(404, { error: 'Thumbnail not available' })
    }

    const shards = loadShards()
    let shardIndex = -1
    if (typeof fedo.storage_node === 'string' && fedo.storage_node) {
      shardIndex = shards.findIndex(shard => shard.name === fedo.storage_node)
    }
    if (shardIndex < 0 && Number.isInteger(fedo.storage_shard)) shardIndex = Number(fedo.storage_shard)
    if (shardIndex < 0 || shardIndex >= shards.length) return json(503, { error: 'Fedo storage node unavailable' })

    const shard = shards[shardIndex]
    const bucket = asset === 'thumbnail'
      ? (shard.thumbnail_bucket || 'fedo-thumbnails')
      : (shard.bucket || 'fedos')
    const path = asset === 'thumbnail' ? fedo.thumbnail_path : fedo.media_path
    if (typeof path !== 'string' || !path) return json(404, { error: 'Fedo media path unavailable' })

    const nodeClient = createClient(shard.url, shard.service_role_key)
    const { data, error } = await nodeClient.storage.from(bucket).createSignedUrl(path, expiresIn)
    if (error || !data?.signedUrl) {
      console.error('Fedo signed URL creation failed:', error?.message || 'missing URL')
      return json(502, { error: 'Could not create signed media URL' })
    }

    return json(200, {
      url: data.signedUrl,
      expires_in: expiresIn,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      asset,
      node_id: shard.name || `fedo-video-node-${String(shardIndex + 1).padStart(2, '0')}`,
    })
  } catch (error) {
    console.error('Fedo media URL failed:', error)
    return json(500, { error: error instanceof Error ? error.message.slice(0, 160) : 'FEDO_MEDIA_URL_FAILED' })
  }
})
