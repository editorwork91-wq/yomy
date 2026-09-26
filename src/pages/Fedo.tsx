import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart, MessageCircle, Share2, Bookmark, Flag, Upload, ChevronUp, Play, Pause, X, Check } from 'lucide-react'
import { Upload as TusUpload } from 'tus-js-client'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Fedo, Profile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TopBar from '@/components/layout/TopBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type MediaTicket = {
  shard: number
  node_id: string
  bucket: string
  path: string
  token: string
  storage_url: string
  storage_host: string
  anon_key: string
  kind: 'video' | 'thumbnail'
  content_type: string
}

function directStorageHost(projectUrl: string) {
  const url = new URL(projectUrl)
  const ref = url.hostname.split('.')[0]
  return `https://${ref}.storage.supabase.co`
}

function waitForVideoEvent(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', timeoutMs = 5000) {
  return new Promise<void>(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener(event, finish)
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, timeoutMs)
    video.addEventListener(event, finish, { once: true })
  })
}

async function createVideoThumbnail(file: File): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl

  try {
    await waitForVideoEvent(video, 'loadedmetadata')
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) return null

    const targetTime = Math.min(Math.max(video.duration * 0.08, 0.05), 1.5)
    video.currentTime = targetTime
    await waitForVideoEvent(video, 'seeked', 5000)

    const maxWidth = 720
    const scale = Math.min(1, maxWidth / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.86)
    })
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

export default function Fedo() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<Fedo[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [caption, setCaption] = useState('')
  const [pendingFedo, setPendingFedo] = useState<{ file: File; previewUrl: string } | null>(null)
  const [playbackUrls, setPlaybackUrls] = useState<Record<string, string>>({})
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const startRef = useRef({ x: 0, y: 0 })

  useEffect(() => () => {
    if (pendingFedo) URL.revokeObjectURL(pendingFedo.previewUrl)
  }, [pendingFedo])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fedos')
      .select('*, profiles!user_id(id,username,full_name,avatar_url,is_verified)')
      .eq('status', 'published')
      .eq('visibility', 'public')
      .order('published_at', { ascending: false })
      .limit(30)

    if (error) toast.error(error.message)
    setItems((data || []) as Fedo[])
    setPlaybackUrls({})
    setThumbnailUrls({})
    const requestedId = searchParams.get('item')
    setIndex(requestedId && data ? Math.max(0, Math.max(0, data.findIndex(row => row.id === requestedId))) : 0)
    setLoading(false)
  }, [searchParams])

  useEffect(() => {
    void load()
  }, [load])

  const resolveThumbnail = useCallback(async (fedoId: string) => {
    if (thumbnailUrls[fedoId]) return thumbnailUrls[fedoId]
    const { data, error } = await supabase.functions.invoke('fedo-media-url', {
      body: { fedo_id: fedoId, asset: 'thumbnail', expires_in: 3600 },
    })
    if (error || !data?.url) throw error || new Error('Thumbnail unavailable')
    setThumbnailUrls(current => ({ ...current, [fedoId]: String(data.url) }))
    return String(data.url)
  }, [thumbnailUrls])

  const resolvePlayback = useCallback(async (fedoId: string, force = false) => {
    if (!force && playbackUrls[fedoId]) return playbackUrls[fedoId]
    const { data, error } = await supabase.functions.invoke('fedo-media-url', {
      body: { fedo_id: fedoId, asset: 'video', expires_in: 3600 },
    })
    if (error || !data?.url) throw error || new Error('Video URL unavailable')
    setPlaybackUrls(current => ({ ...current, [fedoId]: String(data.url) }))
    return String(data.url)
  }, [playbackUrls])

  useEffect(() => {
    const targets = [index, index + 1, index - 1]
      .filter(value => value >= 0 && value < items.length)
      .map(value => items[value])
    if (!targets.length) return

    let cancelled = false
    void Promise.all(targets.map(async item => {
      try {
        await Promise.allSettled([
          resolvePlayback(item.id),
          item.thumbnail_path ? resolveThumbnail(item.id) : Promise.resolve(''),
        ])
        const url = await resolvePlayback(item.id)
        if (cancelled) return
        setPlaybackUrls(current => ({ ...current, [item.id]: url }))
      } catch {
        if (!cancelled && item.media_url) setPlaybackUrls(current => ({ ...current, [item.id]: item.media_url }))
      }
    }))
    return () => { cancelled = true }
  }, [index, items, resolvePlayback, resolveThumbnail])

  useEffect(() => {
    const item = items[index]
    if (item && user) {
      void supabase.rpc('record_fedo_event', {
        p_fedo_id: item.id,
        p_event_type: 'view',
        p_watch_ms: 0,
        p_meta: { source: 'fedo_feed' },
      })
    }
  }, [index, items, user])

  const move = useCallback((delta: number) => {
    setIndex(current => Math.max(0, Math.min(items.length - 1, current + delta)))
    setPaused(false)
  }, [items.length])

  const openCreator = () => {
    const profile = items[index]?.profiles as Profile | undefined
    if (profile?.username) navigate(`/profile/${profile.username}`)
  }

  const toggleLike = async () => {
    if (!user || !items[index]) return
    const item = items[index]
    const { data: existing } = await supabase
      .from('fedo_likes')
      .select('fedo_id')
      .eq('fedo_id', item.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      await supabase.from('fedo_likes').delete().eq('fedo_id', item.id).eq('user_id', user.id)
    } else {
      await supabase.from('fedo_likes').insert({ fedo_id: item.id, user_id: user.id })
    }

    await supabase.rpc('record_fedo_event', {
      p_fedo_id: item.id,
      p_event_type: 'like',
      p_meta: { action: existing ? 'remove' : 'add' },
    })
  }

  const toggleSave = async () => {
    if (!user || !items[index]) return
    const item = items[index]
    const { data: existing } = await supabase
      .from('fedo_saves')
      .select('fedo_id')
      .eq('fedo_id', item.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      await supabase.from('fedo_saves').delete().eq('fedo_id', item.id).eq('user_id', user.id)
    } else {
      await supabase.from('fedo_saves').insert({ fedo_id: item.id, user_id: user.id })
    }

    await supabase.rpc('record_fedo_event', {
      p_fedo_id: item.id,
      p_event_type: 'save',
      p_meta: { action: existing ? 'remove' : 'add' },
    })
  }

  const share = async () => {
    const item = items[index]
    if (!item) return
    const url = `${window.location.origin}/fedo?item=${item.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Yomy Fedo', text: item.caption, url })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied')
      }
    } catch {}
    await supabase.rpc('record_fedo_event', { p_fedo_id: item.id, p_event_type: 'share' })
  }

  const uploadSmallThumbnail = async (file: File, videoTicket: MediaTicket) => {
    const thumbnail = await createVideoThumbnail(file)
    if (!thumbnail) return null

    const { data: ticket, error } = await supabase.functions.invoke('fedo-upload-ticket', {
      body: {
        filename: `${file.name}.jpg`,
        contentType: 'image/jpeg',
        kind: 'thumbnail',
        shard: videoTicket.shard,
      },
    })

    if (error || !ticket?.token || !ticket?.path || !ticket?.storage_url || !ticket?.anon_key) {
      console.warn('Thumbnail ticket unavailable; publishing without thumbnail')
      return null
    }

    const nodeClient = createClient(String(ticket.storage_url), String(ticket.anon_key), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { error: uploadError } = await nodeClient.storage
      .from(String(ticket.bucket))
      .uploadToSignedUrl(String(ticket.path), String(ticket.token), thumbnail, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
      })

    if (uploadError) {
      console.warn('Fedo thumbnail upload failed:', uploadError.message)
      return null
    }

    return ticket as MediaTicket
  }

  const uploadFedo = async (file: File, captionText: string) => {
    if (!user || !file.type.startsWith('video/')) {
      toast.error('Choose a video for Fedo')
      return
    }

    setUploading(true)
    setProgress(0)

    try {
      const { data: ticketData, error: ticketError } = await supabase.functions.invoke('fedo-upload-ticket', {
        body: { filename: file.name, contentType: file.type, kind: 'video' },
      })
      if (ticketError || !ticketData?.storage_url || !ticketData?.path || !ticketData?.token) {
        throw ticketError || new Error('Upload ticket unavailable')
      }

      const ticket = ticketData as MediaTicket
      const endpoint = `${ticket.storage_host || directStorageHost(ticket.storage_url)}/storage/v1/upload/resumable`

      await new Promise<void>((resolve, reject) => {
        const upload = new TusUpload(file, {
          endpoint,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: {
            'x-signature': ticket.token,
            'x-upsert': 'false',
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: ticket.bucket,
            objectName: ticket.path,
            contentType: file.type,
            cacheControl: '31536000',
          },
          uploadSize: file.size,
          onError: reject,
          onProgress: (bytes, total) => setProgress(Math.round(bytes / total * 100)),
          onSuccess: () => resolve(),
        })

        void upload.findPreviousUploads().then(previousUploads => {
          if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0])
          upload.start()
        }).catch(reject)
      })

      const objectUrl = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.src = objectUrl
      await waitForVideoEvent(video, 'loadedmetadata')
      const durationMs = Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration * 1000)) : 0
      const width = video.videoWidth || 0
      const height = video.videoHeight || 0
      URL.revokeObjectURL(objectUrl)

      let thumbnailTicket: MediaTicket | null = null
      try {
        thumbnailTicket = await uploadSmallThumbnail(file, ticket)
      } catch (thumbnailError) {
        console.warn('Fedo thumbnail preparation failed:', thumbnailError)
      }

      const { data: finalized, error: finalizeError } = await supabase.functions.invoke('fedo-finalize', {
        body: {
          video_path: ticket.path,
          video_shard: ticket.shard,
          filename: file.name,
          content_type: file.type,
          file_size_bytes: file.size,
          duration_ms: durationMs,
          width,
          height,
          thumbnail_path: thumbnailTicket?.path || '',
          thumbnail_shard: thumbnailTicket?.shard ?? ticket.shard,
          caption: caption.trim(),
        },
      })

      if (finalizeError || !finalized?.id) {
        throw finalizeError || new Error('Could not finalize Fedo publication')
      }

      await supabase.from('content_metrics_daily').upsert({
        user_id: user.id,
        content_type: 'fedo',
        content_id: finalized.id,
        day: new Date().toISOString().slice(0, 10),
      }, {
        onConflict: 'content_type,content_id,day',
        ignoreDuplicates: true,
      })

      setCaption('')
      setPendingFedo(null)
      toast.success('Fedo published')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Fedo upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const current = items[index]
  const currentUrl = current ? (playbackUrls[current.id] || current.media_url || '') : ''

  return <div className="h-[100dvh] bg-black text-white overflow-hidden">
    <TopBar title="Fedo" showBack right={
      <Button variant="ghost" className="text-white" size="sm" onClick={() => fileRef.current?.click()}>
        <Upload className="size-4 mr-2" />Publish
      </Button>
    } />

    <input
      ref={fileRef}
      type="file"
      accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
      className="hidden"
      onChange={e => {
        const file = e.target.files?.[0]
        if (file) {
          if (file.size > 500 * 1024 * 1024) {
            toast.error('Fedo videos are limited to 500 MB')
          } else {
            setPendingFedo({ file, previewUrl: URL.createObjectURL(file) })
            setCaption('')
          }
        }
        e.currentTarget.value = ''
      }}
    />

    <div
      className="h-[calc(100dvh-3.5rem)] relative touch-none"
      onPointerDown={e => {
        startRef.current = { x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerUp={e => {
        const dx = e.clientX - startRef.current.x
        const dy = e.clientY - startRef.current.y
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1)
        else if (dy < -80) openCreator()
      }}
    >
      {loading ? (
        <div className="h-full flex items-center justify-center"><Spinner className="size-8" /></div>
      ) : !current ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 text-white/70">
          <Play className="size-10" />
          <p>No public Fedos yet.</p>
          <Button onClick={() => fileRef.current?.click()}>Publish the first Fedo</Button>
        </div>
      ) : (
        <div className="h-full relative bg-black">
          {currentUrl ? (
            <video
              key={`${current.id}:${currentUrl}`}
              src={currentUrl}
              poster={thumbnailUrls[current.id] || undefined}
              autoPlay={!paused}
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-contain"
              onClick={() => setPaused(value => !value)}
              onError={() => {
                void resolvePlayback(current.id, true).catch(() => {})
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"><Spinner className="size-8" /></div>
          )}

          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-black/20" />

          <div className="absolute left-4 bottom-8 right-24 pointer-events-none">
            <button onClick={openCreator} className="pointer-events-auto text-left font-semibold text-lg">
              @{(current.profiles as Profile | undefined)?.username || 'creator'}
            </button>
            <p className="mt-2 text-sm text-white/85 line-clamp-3">{current.caption}</p>
            <p className="mt-2 text-[11px] text-white/50">Swipe ← next · → previous · ↑ profile</p>
          </div>

          <div className="absolute right-3 bottom-8 flex flex-col items-center gap-5">
            <Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => void toggleLike()}>
              <Heart className="size-6" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white">
              <MessageCircle className="size-6" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => void share()}>
              <Share2 className="size-6" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => void toggleSave()}>
              <Bookmark className="size-6" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full size-12 bg-black/30 text-white" onClick={() => toast.info('Report submitted')}>
              <Flag className="size-5" />
            </Button>
          </div>

          <div className="absolute top-3 right-3 flex gap-2">
            {paused && <Button variant="ghost" size="icon" className="rounded-full bg-black/40 text-white" onClick={() => setPaused(false)}><Play /></Button>}
            {!paused && <Button variant="ghost" size="icon" className="rounded-full bg-black/40 text-white" onClick={() => setPaused(true)}><Pause /></Button>}
          </div>

          <div className="absolute top-1/2 left-2/3 -translate-y-1/2 opacity-30">
            <ChevronUp className="size-7" />
          </div>
        </div>
      )}

      {uploading && (
        <div className="absolute inset-0 z-10 bg-black/75 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-3xl bg-zinc-900 p-6">
            <p className="font-semibold">Publishing Fedo…</p>
            <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/60">{progress}% · resumable upload</p>
            <p className="mt-3 text-xs text-white/55">Private storage · resumable upload · signed playback</p>
          </div>
        </div>
      )}
      <Dialog open={!!pendingFedo} onOpenChange={open => { if (!open && !uploading) setPendingFedo(null) }}>
        <DialogContent className="w-[min(96vw,460px)] max-w-xl rounded-[30px] border-white/15 bg-zinc-950/92 p-3 text-white shadow-[0_30px_120px_rgba(0,0,0,.55)] backdrop-blur-2xl">
          <DialogHeader className="px-2 pt-1">
            <DialogTitle className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl bg-white/10"><Play className="size-4" /></span>Preview Fedo</DialogTitle>
          </DialogHeader>
          {pendingFedo && (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-[24px] bg-black ring-1 ring-white/10">
                <video src={pendingFedo.previewUrl} controls playsInline className="mx-auto max-h-[55vh] w-full object-contain" />
              </div>
              <Input
                placeholder="Caption (optional)"
                value={caption}
                onChange={e => setCaption(e.target.value.slice(0, 2200))}
                disabled={uploading}
                className="h-11 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-white/35"
              />
              <div className="flex items-center gap-2">
                <Button variant="ghost" className="flex-1 rounded-2xl text-white hover:bg-white/10" disabled={uploading} onClick={() => setPendingFedo(null)}><X className="size-4 mr-1" />Cancel</Button>
                <Button className="flex-1 rounded-2xl" disabled={uploading} onClick={() => { if (pendingFedo) void uploadFedo(pendingFedo.file, caption.trim()) }}>
                  <Check className="size-4 mr-1" />Publish
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  </div>
}
