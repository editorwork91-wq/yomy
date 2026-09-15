import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart, MessageCircle, Share2, Bookmark, Flag, Upload, ChevronUp, Play, Pause } from 'lucide-react'
import { Upload as TusUpload } from 'tus-js-client'
import { supabase } from '@/lib/supabase'
import type { Fedo, Profile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import TopBar from '@/components/layout/TopBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

function directStorageHost(projectUrl: string) {
  const url = new URL(projectUrl)
  const ref = url.hostname.split('.')[0]
  return `https://${ref}.storage.supabase.co`
}

export default function Fedo() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<Fedo[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [caption, setCaption] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const startRef = useRef({ x: 0, y: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('fedos').select('*, profiles!user_id(id,username,full_name,avatar_url,is_verified)').eq('status', 'published').eq('visibility', 'public').order('published_at', { ascending: false }).limit(30)
    if (error) toast.error(error.message)
    setItems((data || []) as Fedo[])
    setIndex(0)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { const item = items[index]; if (item && user) void supabase.rpc('record_fedo_event', { p_fedo_id: item.id, p_event_type: 'view', p_watch_ms: 0, p_meta: { source: 'fedo_feed' } }) }, [index, items, user])
  const move = useCallback((delta: number) => { setIndex(current => Math.max(0, Math.min(items.length - 1, current + delta))); setPaused(false) }, [items.length])
  const openCreator = () => { const profile = items[index]?.profiles as Profile | undefined; if (profile?.username) navigate(`/profile/${profile.username}`) }
  const toggleLike = async () => { if (!user || !items[index]) return; const item = items[index]; const { data: existing } = await supabase.from('fedo_likes').select('fedo_id').eq('fedo_id', item.id).eq('user_id', user.id).maybeSingle(); if (existing) await supabase.from('fedo_likes').delete().eq('fedo_id', item.id).eq('user_id', user.id); else await supabase.from('fedo_likes').insert({ fedo_id: item.id, user_id: user.id }); await supabase.rpc('record_fedo_event', { p_fedo_id: item.id, p_event_type: 'like', p_meta: { action: existing ? 'remove' : 'add' } }) }
  const toggleSave = async () => { if (!user || !items[index]) return; const item = items[index]; const { data: existing } = await supabase.from('fedo_saves').select('fedo_id').eq('fedo_id', item.id).eq('user_id', user.id).maybeSingle(); if (existing) await supabase.from('fedo_saves').delete().eq('fedo_id', item.id).eq('user_id', user.id); else await supabase.from('fedo_saves').insert({ fedo_id: item.id, user_id: user.id }); await supabase.rpc('record_fedo_event', { p_fedo_id: item.id, p_event_type: 'save', p_meta: { action: existing ? 'remove' : 'add' } }) }
  const share = async () => { const item = items[index]; if (!item) return; const url = `${window.location.origin}/fedo?item=${item.id}`; try { if (navigator.share) await navigator.share({ title: 'Yomy Fedo', text: item.caption, url }); else { await navigator.clipboard.writeText(url); toast.success('Link copied') } } catch {} await supabase.rpc('record_fedo_event', { p_fedo_id: item.id, p_event_type: 'share' }) }

  const uploadFedo = async (file: File) => {
    if (!user || !file.type.startsWith('video/')) return toast.error('Choose a video for Fedo')
    setUploading(true); setProgress(0)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session expired')
      const { data: ticket, error: ticketError } = await supabase.functions.invoke('fedo-upload-ticket', { body: { filename: file.name, contentType: file.type } })
      if (ticketError || !ticket?.storage_url || !ticket?.path || !ticket?.token) throw ticketError || new Error('Upload ticket unavailable')
      const endpoint = `${directStorageHost(String(ticket.storage_url))}/storage/v1/upload/resumable`
      await new Promise<void>((resolve, reject) => {
        const upload = new TusUpload(file, {
          endpoint,
          retryDelays: [0, 1000, 3000, 5000, 10000],
          headers: { Authorization: `Bearer ${session.access_token}`, 'x-signature': String(ticket.token) },
          metadata: { bucketName: String(ticket.bucket), objectName: String(ticket.path), contentType: file.type, cacheControl: '31536000' },
          uploadSize: file.size,
          onError: reject,
          onProgress: (bytes, total) => setProgress(Math.round(bytes / total * 100)),
          onSuccess: () => resolve(),
        })
        upload.start()
      })
      const mediaUrl = `${String(ticket.storage_url).replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(String(ticket.bucket))}/${String(ticket.path).split('/').map(encodeURIComponent).join('/')}`
      const video = document.createElement('video'); video.preload = 'metadata'; const objectUrl = URL.createObjectURL(file); video.src = objectUrl
      await new Promise<void>(resolve => { video.onloadedmetadata = () => resolve(); video.onerror = () => resolve() })
      const { data: row, error } = await supabase.from('fedos').insert({ user_id: user.id, media_path: ticket.path, media_url: mediaUrl, thumbnail_url: '', caption: caption.trim(), status: 'published', visibility: 'public', published_at: new Date().toISOString(), duration_ms: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0, width: video.videoWidth || 0, height: video.videoHeight || 0, file_size_bytes: file.size, storage_shard: Number(ticket.shard || 0) }).select('id').single()
      URL.revokeObjectURL(objectUrl)
      if (error) throw error
      await supabase.from('content_metrics_daily').upsert({ user_id: user.id, content_type: 'fedo', content_id: row.id, day: new Date().toISOString().slice(0, 10) }, { onConflict: 'content_type,content_id,day', ignoreDuplicates: true })
      setCaption(''); toast.success('Fedo published'); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Fedo upload failed') }
    finally { setUploading(false); setProgress(0) }
  }

  const current = items[index]
  return <div className="h-[100dvh] bg-black text-white overflow-hidden">
    <TopBar title="Fedo" showBack right={<Button variant="ghost" className="text-white" size="sm" onClick={() => fileRef.current?.click()}><Upload className="size-4 mr-2"/>Publish</Button>} />
    <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void uploadFedo(file); e.currentTarget.value = '' }} />
    <div className="h-[calc(100dvh-3.5rem)] relative touch-none" onPointerDown={e => { startRef.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) }} onPointerUp={e => { const dx = e.clientX - startRef.current.x; const dy = e.clientY - startRef.current.y; if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1); else if (dy < -80) openCreator() }}>
      {loading ? <div className="h-full flex items-center justify-center"><Spinner className="size-8"/></div> : !current ? <div className="h-full flex flex-col items-center justify-center gap-4 text-white/70"><Play className="size-10"/><p>No public Fedos yet.</p><Button onClick={() => fileRef.current?.click()}>Publish the first Fedo</Button></div> : <div className="h-full relative bg-black">
        <video key={current.id} src={current.media_url} autoPlay={!paused} loop playsInline className="absolute inset-0 w-full h-full object-contain" onClick={() => setPaused(value => !value)} />
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-black/20"/>
        <div className="absolute left-4 bottom-8 right-24 pointer-events-none"><button onClick={openCreator} className="pointer-events-auto text-left font-semibold text-lg">@{(current.profiles as Profile | undefined)?.username || 'creator'}</button><p className="mt-2 text-sm text-white/85 line-clamp-3">{current.caption}</p><p className="mt-2 text-[11px] text-white/50">Swipe ← next · → previous · ↑ profile</p></div>
        <div className="absolute right-3 bottom-8 flex flex-col items-center gap-5"><Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => void toggleLike()}><Heart className="size-6"/></Button><Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white"><MessageCircle className="size-6"/></Button><Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => void share()}><Share2 className="size-6"/></Button><Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => void toggleSave()}><Bookmark className="size-6"/></Button><Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => toast.info('Report submitted')}><Flag className="size-5"/></Button></div>
        <div className="absolute top-3 right-3 flex gap-2">{paused && <Button variant="ghost" size="icon" className="rounded-full bg-black/40 text-white" onClick={() => setPaused(false)}><Play/></Button>}{!paused && <Button variant="ghost" size="icon" className="rounded-full bg-black/40 text-white" onClick={() => setPaused(true)}><Pause/></Button>}</div>
        <div className="absolute top-1/2 left-2/3 -translate-y-1/2 opacity-30"><ChevronUp className="size-7"/></div>
      </div>}
      {uploading && <div className="absolute inset-0 z-10 bg-black/75 flex items-center justify-center p-6"><div className="w-full max-w-sm rounded-3xl bg-zinc-900 p-6"><p className="font-semibold">Publishing Fedo…</p><div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-white transition-all" style={{ width: `${progress}%` }}/></div><p className="mt-2 text-xs text-white/60">{progress}% · resumable upload</p><Input className="mt-4 bg-white/5 border-white/10 text-white" placeholder="Caption (optional)" value={caption} onChange={e => setCaption(e.target.value)}/></div></div>}
    </div>
  </div>
}
