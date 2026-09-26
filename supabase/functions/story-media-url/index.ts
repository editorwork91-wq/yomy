import { createClient } from 'npm:@supabase/supabase-js@2'

const mainUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function canView(client: ReturnType<typeof createClient>, viewerId: string, story: any) {
  if (story.user_id === viewerId) return true
  const { data: blocked } = await client.from('blocks').select('blocker_id,blocked_id').or(
    'and(blocker_id.eq.' + story.user_id + ',blocked_id.eq.' + viewerId + '),and(blocker_id.eq.' + viewerId + ',blocked_id.eq.' + story.user_id + ')'
  ).limit(1)
  if (blocked?.length) return false

  const { data: author } = await client.from('profiles').select('id,is_private').eq('id', story.user_id).maybeSingle()
  if (!author) return false

  if (story.visibility === 'private') return false

  if (story.visibility === 'public') {
    if (!author.is_private) return true
    const { data: follow } = await client.from('follows').select('id').eq('follower_id', viewerId).eq('following_id', story.user_id).eq('status','accepted').maybeSingle()
    return Boolean(follow)
  }

  if (story.visibility === 'friends') {
    const [{ data: one }, { data: two }] = await Promise.all([
      client.from('follows').select('id').eq('follower_id', viewerId).eq('following_id', story.user_id).eq('status','accepted').maybeSingle(),
      client.from('follows').select('id').eq('follower_id', story.user_id).eq('following_id', viewerId).eq('status','accepted').maybeSingle(),
    ])
    return Boolean(one && two)
  }

  return false
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Missing authorization' })

  const admin = createClient(mainUrl, serviceKey)
  const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7))
  if (authError || !user) return json(401, { error: 'Invalid session' })

  const body = await req.json().catch(() => ({}))
  const storyId = typeof body?.story_id === 'string' ? body.story_id : ''
  if (!storyId) return json(400, { error: 'story_id is required' })

  const { data: story, error } = await admin
    .from('stories')
    .select('id,user_id,media_bucket,media_path,media_url,expires_at,visibility')
    .eq('id', storyId)
    .maybeSingle()

  if (error || !story) return json(404, { error: 'Story not found' })
  if (new Date(story.expires_at).getTime() <= Date.now()) return json(404, { error: 'Story expired' })
  if (!(await canView(admin, user.id, story))) return json(404, { error: 'Story not found' })

  if (story.media_bucket !== 'stories-private' || !story.media_path) {
    if (typeof story.media_url === 'string' && /^https?:\/\//i.test(story.media_url)) {
      return json(200, { url: story.media_url, expires_in: null, legacy: true })
    }
    return json(404, { error: 'Story media unavailable' })
  }

  const seconds = Math.max(60, Math.min(3600, Math.floor(Number(body?.expires_in) || 900)))
  const { data: signed, error: signError } = await admin.storage
    .from('stories-private')
    .createSignedUrl(story.media_path, seconds)

  if (signError || !signed?.signedUrl) return json(502, { error: 'Could not create story media URL' })
  return json(200, { url: signed.signedUrl, expires_in: seconds, expires_at: new Date(Date.now() + seconds*1000).toISOString() })
})