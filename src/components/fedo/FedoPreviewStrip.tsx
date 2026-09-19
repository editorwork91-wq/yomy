import { useEffect, useState } from 'react'
import { Clapperboard, Play, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Fedo, Profile } from '@/lib/supabase'

type PreviewRow = Omit<Fedo, 'profiles'> & { profiles?: Profile | Profile[] }

export default function FedoPreviewStrip() {
  const [items, setItems] = useState<PreviewRow[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    void supabase
      .from('fedos')
      .select('id,user_id,media_path,media_url,thumbnail_url,thumbnail_path,storage_node,status,visibility,published_at,deleted_at,retention_until,duration_ms,width,height,file_size_bytes,storage_shard,created_at,updated_at,profiles!user_id(id,username,full_name,avatar_url,is_verified)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) console.error('Fedo preview load failed:', error.message)
        setItems((data || []).map(row => ({
          ...row,
          profiles: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles,
        })) as PreviewRow[])
        setLoading(false)
      })

    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!items.length) return
    let cancelled = false

    void Promise.all(items.map(async item => {
      try {
        const asset = item.thumbnail_path ? 'thumbnail' : 'video'
        const { data, error } = await supabase.functions.invoke('fedo-media-url', {
          body: { fedo_id: item.id, asset, expires_in: 3600 },
        })

        if (error || !data?.url) {
          if (asset === 'thumbnail') {
            const fallback = await supabase.functions.invoke('fedo-media-url', {
              body: { fedo_id: item.id, asset: 'video', expires_in: 3600 },
            })
            if (!cancelled && fallback.data?.url) {
              setSignedUrls(current => ({ ...current, [item.id]: String(fallback.data.url) }))
              return
            }
          }
          const legacy = item.thumbnail_url || item.media_url
          if (!cancelled && legacy && /^https?:\/\//i.test(legacy)) {
            setSignedUrls(current => ({ ...current, [item.id]: legacy }))
          }
          return
        }

        if (!cancelled) {
          setSignedUrls(current => ({ ...current, [item.id]: String(data.url) }))
        }
      } catch {
        const legacy = item.thumbnail_url || item.media_url
        if (!cancelled && legacy && /^https?:\/\//i.test(legacy)) {
          setSignedUrls(current => ({ ...current, [item.id]: legacy }))
        }
      }
    }))

    return () => { cancelled = true }
  }, [items])

  return (
    <section className="px-4 py-3" aria-label="Fedo">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clapperboard className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Fedo</p>
            <p className="text-[11px] text-muted-foreground">Video, creators & moments</p>
          </div>
        </div>
        <Link to="/fedo" className="text-xs font-semibold text-primary active:opacity-70">Open Fedo</Link>
      </div>

      <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
        <Link
          to="/fedo"
          className="relative w-24 aspect-[9/16] overflow-hidden rounded-2xl shrink-0 border border-primary/20 bg-primary/5 flex flex-col items-center justify-center gap-2 text-primary active:scale-[0.98] transition-transform"
        >
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Plus className="size-5" />
          </span>
          <span className="text-[11px] font-semibold">Publish Fedo</span>
        </Link>

        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={`skeleton-${i}`} className="relative w-24 aspect-[9/16] rounded-2xl shrink-0 bg-muted animate-pulse" />
            ))
          : items.map(item => {
              const profile = item.profiles as Profile | undefined
              const src = signedUrls[item.id] || (item.thumbnail_url || item.media_url || '')
              return (
                <Link
                  key={item.id}
                  to={`/fedo?item=${item.id}`}
                  className="relative w-24 aspect-[9/16] overflow-hidden rounded-2xl bg-muted shrink-0 group active:scale-[0.98] transition-transform"
                >
                  {src ? (
                    item.thumbnail_path || item.thumbnail_url ? (
                      <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <video
                        src={src}
                        muted
                        playsInline
                        preload="metadata"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    )
                  ) : (
                    <div className="absolute inset-0 animate-pulse bg-white/5" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent" />
                  <div className="absolute left-2 right-2 bottom-2 text-white">
                    <p className="text-[10px] font-semibold truncate">@{profile?.username || 'creator'}</p>
                    <div className="flex items-center gap-1 text-[9px] text-white/75">
                      <Play className="size-2.5" />
                      Fedo
                    </div>
                  </div>
                </Link>
              )
            })}

        {!loading && items.length === 0 && (
          <Link to="/fedo" className="min-w-0 flex-1 rounded-2xl border border-dashed border-border p-4 flex items-center gap-3 text-left active:bg-muted/70">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <Play className="size-5 text-muted-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">No public Fedos yet</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">Be the first to publish a video.</span>
            </span>
          </Link>
        )}
      </div>
    </section>
  )
}
