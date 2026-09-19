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
    return typeof shard.url === 'string' && typeof shard.service_role_key === 'string' && typeof shard.anon_key === 'string'
  })
  if (!shards.length) throw new Error('MEDIA_SHARDS_JSON_NO_VALID_SHARDS')
  return shards
}

function safePath(path: unknown, userId: string) {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 1024
    && path.startsWith(`${userId}/`)
    && !path.split('/').some(part => part === '' || part === '.' || part === '..')
}

function validVideoType(contentType: string) {
  return ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'].includes(contentType)
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
  const videoPath = body?.video_path
  const videoShard = Number(body?.video_shard)
  const thumbnailPath = typeof body?.thumbnail_path === 'string' ? body.thumbnail_path : ''
  const thumbnailShard = Number.isInteger(body?.thumbnail_shard) ? Number(body?.thumbnail_shard) : videoShard
  const filename = typeof body?.filename === 'string' ? body.filename.slice(0, 240) : 'fedo.mp4'
  const contentType = typeof body?.content_type === 'string' ? body.content_type.toLowerCase() : 'video/mp4'
  const fileSize = Math.floor(Number(body?.file_size_bytes))
  const durationMs = Math.max(0, Math.floor(Number(body?.duration_ms) || 0))
  const width = Math.max(0, Math.floor(Number(body?.width) || 0))
  const height = Math.max(0, Math.floor(Number(body?.height) || 0))
  const caption = typeof body?.caption === 'string' ? body.caption.trim().slice(0, 2200) : ''

  if (!validVideoType(contentType)) return json(400, { error: 'Unsupported Fedo video type' })
  if (!safePath(videoPath, user.id)) return json(400, { error: 'Invalid video path' })
  if (!Number.isInteger(videoShard) || videoShard < 0) return json(400, { error: 'Invalid video shard' })
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 500 * 1024 * 1024) return json(400, { error: 'Fedo video must be between 1 byte and 500 MB' })
  if (thumbnailPath && !safePath(thumbnailPath, user.id)) return json(400, { error: 'Invalid thumbnail path' })

  try {
    const shards = loadShards()
    if (videoShard >= shards.length || thumbnailShard < 0 || thumbnailShard >= shards.length) {
      return json(400, { error: 'Shard is not configured' })
    }

    const shard = shards[videoShard]
    const bucket = shard.bucket || 'fedos'
    const nodeId = shard.name || `fedo-video-node-${String(videoShard + 1).padStart(2, '0')}`

    // The signed upload token already authorizes the exact object path. Requiring the
    // caller to echo that path back is safe because the server re-checks user ownership.
    const fedoId = crypto.randomUUID()
    const nodeClient = createClient(shard.url, shard.service_role_key)
    const { error: nodeError } = await nodeClient
      .from('fedo_video_objects')
      .insert({
        id: fedoId,
        user_id: user.id,
        bucket,
        object_path: videoPath,
        original_filename: filename,
        content_type: contentType,
        file_size_bytes: fileSize,
        duration_ms: durationMs,
        width,
        height,
        storage_node: nodeId,
        status: 'ready',
        retention_until: null,
        processing_status: 'ready',
      })

    if (nodeError) {
      console.error('Fedo node metadata insert failed:', nodeError.message)
      return json(502, { error: 'Could not register video on storage node' })
    }

    const mainClient = createClient(mainUrl, mainServiceKey)
    const { data: fedo, error: mainError } = await mainClient
      .from('fedos')
      .insert({
        id: fedoId,
        user_id: user.id,
        media_path: videoPath,
        media_url: '',
        thumbnail_url: '',
        thumbnail_path: thumbnailPath || null,
        caption,
        status: 'published',
        visibility: 'public',
        published_at: new Date().toISOString(),
        duration_ms: durationMs,
        width,
        height,
        file_size_bytes: fileSize,
        storage_shard: videoShard,
        storage_node: nodeId,
      })
      .select('id,storage_shard,storage_node,media_path,thumbnail_path')
      .single()

    if (mainError || !fedo) {
      console.error('Main Fedo metadata insert failed:', mainError?.message || 'missing row')
      await nodeClient.from('fedo_video_objects').delete().eq('id', fedoId)
      return json(502, { error: 'Could not publish Fedo metadata' })
    }

    return json(200, {
      id: fedo.id,
      storage_shard: fedo.storage_shard,
      storage_node: fedo.storage_node,
      media_path: fedo.media_path,
      thumbnail_path: fedo.thumbnail_path,
    })
  } catch (error) {
    console.error('Fedo finalize failed:', error)
    return json(500, { error: error instanceof Error ? error.message.slice(0, 160) : 'FEDO_FINALIZE_FAILED' })
  }
})
