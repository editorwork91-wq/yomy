import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' }
const json = (status:number, body:Record<string,unknown>) => new Response(JSON.stringify(body), { status, headers:{ ...corsHeaders, 'Content-Type':'application/json', 'Cache-Control':'public, max-age=300' } })

function safePublicUrl(raw:string) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal' || h.endsWith('.internal')) return null
    if (/^(127|10|192\.168|169\.254)\./.test(h)) return null
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return null
    if (h === '::1') return null
    return u
  } catch { return null }
}

function decode(value:string) {
  return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
}

function meta(html:string, key:string) {
  const escaped = key.replace(/[.*+?^()|[\]\\]/g, '\\$&')
  const a = new RegExp('<meta[^>]+(?:property|name)=["\\\']' + escaped + '["\\\'][^>]+content=["\\\']([^"\\\']*)["\\\']', 'i')
  const b = new RegExp('<meta[^>]+content=["\\\']([^"\\\']*)["\\\'][^>]+(?:property|name)=["\\\']' + escaped + '["\\\']', 'i')
  return decode(a.exec(html)?.[1] || b.exec(html)?.[1] || '')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders})
  if (req.method !== 'POST') return json(405,{error:'Method not allowed'})
  const body = await req.json().catch(()=>null) as Record<string,unknown>|null
  const url = safePublicUrl(typeof body?.url === 'string' ? body.url : '')
  if (!url) return json(400,{error:'Invalid public URL'})
  try {
    const controller = new AbortController()
    const timer = setTimeout(()=>controller.abort(),6500)
    const response = await fetch(url.toString(), { redirect:'follow', headers:{'user-agent':'YomyLinkPreview/1.0'}, signal:controller.signal })
    clearTimeout(timer)
    const finalUrl = safePublicUrl(response.url)
    if (!finalUrl || !response.ok) return json(404,{error:'Preview unavailable'})
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return json(200,{url:finalUrl.toString(),title:finalUrl.hostname,description:'',image:'',site_name:finalUrl.hostname})
    const text = await response.text()
    const html = text.slice(0,260000)
    let image = meta(html,'og:image') || meta(html,'twitter:image')
    try { if (image) image = new URL(image, finalUrl).toString() } catch { image = '' }
    const title = meta(html,'og:title') || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim() || finalUrl.hostname
    const description = meta(html,'og:description') || meta(html,'description')
    const site = meta(html,'og:site_name') || finalUrl.hostname
    return json(200,{url:finalUrl.toString(),title:title.slice(0,180),description:description.slice(0,320),image,site_name:site.slice(0,100)})
  } catch (error) {
    return json(504,{error:error instanceof Error && error.name === 'AbortError' ? 'Preview timeout' : 'Preview unavailable'})
  }
})
