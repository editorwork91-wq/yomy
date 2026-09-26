import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { StoryVisibility } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { sendPushEvent } from '@/lib/push'
import TopBar from '@/components/layout/TopBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Camera, Wand2, SlidersHorizontal, Type, Music2, Clock3, Check, RotateCcw, Globe, Users, Lock } from 'lucide-react'

const VISIBILITY_OPTIONS: { value: StoryVisibility; label: string; icon: typeof Globe }[] = [
  { value: 'public', label: 'Public', icon: Globe },
  { value: 'friends', label: 'Friends', icon: Users },
  { value: 'private', label: 'Only me', icon: Lock },
]
const EXPIRATIONS = [24, 48, 5] as const

export default function CreateStory() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [mediaPath, setMediaPath] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [caption, setCaption] = useState('')
  const [expiration, setExpiration] = useState<number>(24)
  const [visibility, setVisibility] = useState<StoryVisibility>('public')
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)

  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const uploadMedia = async (file: File) => {
    if (!user) return
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Story media is limited to 50 MB')
      return
    }
    const isVideo = file.type.startsWith('video/')
    if (!file.type.startsWith('image/') && !isVideo) {
      toast.error('Choose a photo or video')
      return
    }

    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    const localPreview = URL.createObjectURL(file)
    setPreviewUrl(localPreview)
    setMediaPath(null)
    setMediaType(isVideo ? 'video' : 'image')
    setUploading(true)

    try {
      const ext = (file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).replace(/[^a-z0-9]/gi, '').slice(0, 8) || (isVideo ? 'mp4' : 'jpg')
      const path = 'stories/' + user.id + '/' + crypto.randomUUID() + '.' + ext
      const { error } = await supabase.storage.from('stories-private').upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: '31536000',
      })
      if (error) throw error
      setMediaPath(path)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
      URL.revokeObjectURL(localPreview)
      setPreviewUrl('')
      setMediaPath(null)
    } finally {
      setUploading(false)
    }
  }

  const resetMedia = async () => {
    if (user && mediaPath) await supabase.storage.from('stories-private').remove([mediaPath])
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setMediaPath(null)
    setCaption('')
  }

  const handlePost = async () => {
    if (!user || !mediaPath || uploading || posting) return
    setPosting(true)
    try {
      const expiresAt = new Date(Date.now() + expiration * 3600000).toISOString()
      const { data: story, error } = await supabase.from('stories').insert({
        user_id: user.id,
        media_url: '',
        media_bucket: 'stories-private',
        media_path: mediaPath,
        media_type: mediaType,
        caption: caption.trim(),
        expires_at: expiresAt,
        visibility,
      }).select('id').single()
      if (error) throw error
      if (story) void sendPushEvent({
        type: 'story',
        title: profile?.username ? '@' + profile.username : 'Yomy',
        body: caption.trim() || 'New story',
        data: { story_id: story.id, url: '/stories/' + story.id },
      })
      toast.success('Story shared')
      navigate('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post story')
    } finally {
      setPosting(false)
    }
  }

  const cycleExpiration = () => {
    const idx = EXPIRATIONS.indexOf(expiration as (typeof EXPIRATIONS)[number])
    setExpiration(EXPIRATIONS[(idx + 1) % EXPIRATIONS.length])
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <TopBar title="New Story" showBack right={<Button variant="ghost" size="sm" className="rounded-full text-primary font-semibold" disabled={!mediaPath || uploading || posting} onClick={() => void handlePost()}>{posting ? <Spinner className="size-4" /> : <><Check className="size-4 mr-1" />Share</>}</Button>} />
      <div className="relative mx-auto min-h-[calc(100dvh-3.5rem)] w-full max-w-lg overflow-hidden bg-black">
        {!previewUrl ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="absolute inset-5 grid place-items-center rounded-[34px] border border-white/10 bg-white/[0.035] text-white/75 shadow-[0_30px_120px_rgba(0,0,0,.35)]">
            <span className="flex flex-col items-center gap-3"><Camera className="size-12" /><span className="text-sm font-medium">Choose a photo or video</span><span className="text-[11px] text-white/45">Stories disappear when their timer ends.</span></span>
          </button>
        ) : (
          <>
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              {mediaType === 'video'
                ? <video src={previewUrl} className="max-h-full max-w-full object-contain" autoPlay muted loop playsInline />
                : <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />}
            </div>

            <div className="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex flex-col items-center gap-2">
              <button type="button" onClick={() => toast.info('Editing tools will be enabled in the next editor pass')} className="story-tool"><Wand2 className="size-5" /><span>Edit</span></button>
              <button type="button" onClick={() => toast.info('Filters will be enabled in the next editor pass')} className="story-tool"><SlidersHorizontal className="size-5" /><span>Filters</span></button>
              <button type="button" onClick={() => toast.info('Text overlays will be enabled in the next editor pass')} className="story-tool"><Type className="size-5" /><span>Text</span></button>
              <button type="button" onClick={() => toast.info('Music selection will be enabled in the next editor pass')} className="story-tool"><Music2 className="size-5" /><span>Music</span></button>
              <button type="button" onClick={cycleExpiration} className="story-tool" aria-label="Change story duration"><Clock3 className="size-5" /><strong>{expiration}h</strong></button>
            </div>

            <button type="button" onClick={() => void resetMedia()} className="absolute right-3 top-3 z-20 grid size-10 place-items-center rounded-full border border-white/15 bg-black/35 text-white backdrop-blur-xl active:scale-95" aria-label="Choose another file"><RotateCcw className="size-4" /></button>

            <div className="absolute bottom-4 left-4 right-4 z-20 space-y-3">
              <div className="rounded-[24px] border border-white/15 bg-black/35 p-2 backdrop-blur-2xl shadow-[0_18px_70px_rgba(0,0,0,.35)]">
                <Input value={caption} onChange={e => setCaption(e.target.value.slice(0,2200))} placeholder="Write a caption…" className="h-11 border-0 bg-transparent text-white placeholder:text-white/45 focus-visible:ring-0" />
              </div>
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {VISIBILITY_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  return <button key={opt.value} type="button" onClick={() => setVisibility(opt.value)} className={'story-choice ' + (visibility === opt.value ? 'story-choice-active' : '')}><Icon className="size-4" />{opt.label}</button>
                })}
              </div>
            </div>

            {uploading && <div className="absolute inset-0 z-30 grid place-items-center bg-black/25 backdrop-blur-[2px]"><div className="rounded-full border border-white/15 bg-black/55 px-4 py-2 text-xs text-white backdrop-blur-2xl"><Spinner className="mr-2 inline-block size-3" />Uploading securely…</div></div>}
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const file=e.target.files?.[0]; if(file) void uploadMedia(file); e.currentTarget.value='' }} />
      </div>
    </div>
  )
}
