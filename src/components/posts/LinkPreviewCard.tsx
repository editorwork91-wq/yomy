import { useEffect, useState } from 'react'
import { ExternalLink, Globe, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Preview = { url: string; title: string; description: string; image: string; site_name: string }

function validUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch { return false }
}

export default function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const key = 'yomy:link-preview:' + url
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null') as Preview | null
      if (cached?.url) {
        setPreview(cached)
        setLoading(false)
        return
      }
    } catch {}

    if (!validUrl(url)) {
      setLoading(false)
      return
    }

    void supabase.functions.invoke('link-preview', { body: { url } }).then(({ data, error }) => {
      if (cancelled) return
      if (!error && data?.url) {
        const value = data as Preview
        setPreview(value)
        try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [url])

  if (loading) return <div className="mt-2 rounded-2xl border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading link preview…</div>
  if (!preview) return null

  let hostname = ''
  try { hostname = new URL(preview.url).hostname } catch {}

  return <a href={preview.url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-2xl border bg-card hover:bg-muted/40 transition-colors">
    {preview.image && <img src={preview.image} alt="" className="w-full max-h-56 object-cover" loading="lazy" referrerPolicy="no-referrer" />}
    <div className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Globe className="size-3.5" /><span className="truncate">{preview.site_name || hostname}</span><ExternalLink className="size-3 ml-auto" /></div>
      <p className="mt-1 text-sm font-semibold line-clamp-2">{preview.title || preview.url}</p>
      {preview.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{preview.description}</p>}
    </div>
  </a>
}
