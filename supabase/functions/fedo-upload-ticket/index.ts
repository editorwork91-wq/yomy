import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const mainUrl = Deno.env.get('SUPABASE_URL')!
const mainServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const mainAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

type Shard = { url: string; service_role_key: string; anon_key: string; bucket?: string }
function loadShards(): Shard[] {
  const raw = Deno.env.get('MEDIA_SHARDS_JSON')
  if (!raw) return [{ url: mainUrl, service_role_key: mainServiceKey, anon_key: mainAnonKey, bucket: 'fedos' }]
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('MEDIA_SHARDS_JSON_INVALID')
  return parsed.filter((x: unknown): x is Shard => !!x && typeof x === 'object' && typeof (x as Shard).url === 'string' && typeof (x as Shard).service_role_key === 'string' && typeof (x as Shard).anon_key === 'string')
}
function hash(value: string) { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return h >>> 0 }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })
  const authClient = createClient(mainUrl, mainServiceKey)
  const { data: { user }, error: authError } = await authClient.auth.getUser(auth.slice(7))
  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const filename = typeof body?.filename === 'string' ? body.filename : ''
  const contentType = typeof body?.contentType === 'string' ? body.contentType : 'video/mp4'
  if (!filename) return json(400, { error: 'filename is required' })
  if (!contentType.startsWith('video/')) return json(400, { error: 'Fedo accepts video media only' })

  try {
    const shards = loadShards()
    const index = hash(`${user.id}:${Date.now()}:${crypto.randomUUID()}`) % shards.length
    const shard = shards[index]
    const bucket = shard.bucket || 'fedos'
    const extension = filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'mp4'
    const path = `${user.id}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${extension}`
    const client = createClient(shard.url, shard.service_role_key)
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, { upsert: false })
    if (error || !data?.token) return json(502, { error: 'Could not create upload ticket' })
    return json(200, { shard: index, bucket, path, token: data.token, storage_url: shard.url, anon_key: shard.anon_key })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message.slice(0, 160) : 'UPLOAD_TICKET_FAILED' })
  }
})
