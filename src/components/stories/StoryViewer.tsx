import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Story, Profile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { X, Send, Eye, Trash2, MoreVertical, Heart, MessageCircle, ChevronLeft, Pencil, Globe, Users, Lock, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

type StoryGroup = { user: Profile; stories: Story[] }
type StoryComment = { id: string; story_id: string; user_id: string; content: string; created_at: string; profiles?: Profile }
type StoryViewerProps = { groups: StoryGroup[]; initialGroupIndex: number; onClose: () => void }

export default function StoryViewer({ groups, initialGroupIndex, onClose }: StoryViewerProps) {
  const { user } = useAuth()
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex)
  const [storyIndex, setStoryIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [comment, setComment] = useState('')
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<StoryComment[]>([])
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<Profile[]>([])
  const [storyMediaUrl, setStoryMediaUrl] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editCaption, setEditCaption] = useState('')
  const [editVisibility, setEditVisibility] = useState<'public'|'friends'|'private'>('public')
  const [editDuration, setEditDuration] = useState('24')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const DURATION = 5000
  const language = document.documentElement.lang || 'en'
  const copyEdit = language === 'ar'
    ? { edit:'تعديل الحالة', caption:'النص', audience:'الخصوصية', duration:'المدة', save:'حفظ' }
    : { edit:'Edit story', caption:'Caption', audience:'Who can see it', duration:'Duration', save:'Save changes' }

  const copy = useMemo(() => language === 'ar'
    ? { incoming:'قصة واردة', like:'إعجاب', liked:'تم الإعجاب', comments:'التعليقات', add:'أضف تعليقًا…', post:'إرسال', viewers:'المشاهدون', view:'عرض المشاهدين', story:'قصة', noComments:'لا توجد تعليقات بعد', delete:'حذف القصة' }
    : language === 'de'
      ? { incoming:'Story', like:'Gefällt mir', liked:'Gefällt mir', comments:'Kommentare', add:'Kommentar hinzufügen…', post:'Senden', viewers:'Zuschauer', view:'Zuschauer anzeigen', story:'Story', noComments:'Noch keine Kommentare', delete:'Story löschen' }
      : language === 'fr'
        ? { incoming:'Story', like:"J'aime", liked:"J'aime", comments:'Commentaires', add:'Ajouter un commentaire…', post:'Envoyer', viewers:'Spectateurs', view:'Voir les spectateurs', story:'Story', noComments:'Pas encore de commentaires', delete:'Supprimer la story' }
        : language === 'es'
          ? { incoming:'Historia', like:'Me gusta', liked:'Te gusta', comments:'Comentarios', add:'Añadir comentario…', post:'Enviar', viewers:'Espectadores', view:'Ver espectadores', story:'Historia', noComments:'Aún no hay comentarios', delete:'Eliminar historia' }
          : { incoming:'Story', like:'Like', liked:'Liked', comments:'Comments', add:'Add a comment…', post:'Send', viewers:'Viewers', view:'View viewers', story:'Story', noComments:'No comments yet', delete:'Delete story' }, [language])

  const currentGroup = groups[groupIndex]
  const currentStory = currentGroup?.stories[storyIndex]
  const isOwner = currentGroup?.user.id === user?.id

  const openEdit = () => {
    if (!currentStory || !isOwner) return
    setEditCaption(currentStory.caption || '')
    setEditVisibility(currentStory.visibility || 'public')
    const remaining = Math.max(1, (new Date(currentStory.expires_at).getTime() - Date.now()) / 3600000)
    setEditDuration(Math.abs(remaining - 48) < 5 ? '48' : Math.abs(remaining - 5) < 2 ? '5' : '24')
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!currentStory || !user || !isOwner) return
    const hours = Number(editDuration)
    const expiresAt = new Date(Date.now() + hours * 3600000).toISOString()
    const { error } = await supabase.from('stories').update({
      caption: editCaption.trim(),
      visibility: editVisibility,
      expires_at: expiresAt,
    }).eq('id', currentStory.id).eq('user_id', user.id)
    if (error) return toast.error(error.message)
    setEditOpen(false)
    toast.success(copyEdit.save)
  }

  const loadInteractions = async (storyId: string) => {
    if (!user) return
    const [{ data: likes }, { data: rows }] = await Promise.all([
      supabase.from('story_likes').select('user_id').eq('story_id', storyId),
      supabase.from('story_comments').select('id,story_id,user_id,content,created_at,profiles!user_id(id,username,full_name,avatar_url,is_verified)').eq('story_id', storyId).order('created_at', { ascending: true }),
    ])
    setLikeCount(likes?.length || 0)
    setLiked(Boolean(likes?.some(l => l.user_id === user.id)))
    setComments((rows || []).map(row => ({ ...row, profiles: row.profiles as unknown as Profile })))
  }

  useEffect(() => {
    if (!currentStory || !user) return
    let cancelled = false
    const fallback = currentStory.media_url || ''
    if (!currentStory.media_path) {
      setStoryMediaUrl(fallback)
      return
    }
    void supabase.functions.invoke('story-media-url', { body: { story_id: currentStory.id, expires_in: 900 } })
      .then(({ data, error }) => {
        if (!cancelled && !error && data?.url) setStoryMediaUrl(String(data.url))
        else if (!cancelled) setStoryMediaUrl(fallback)
      })
    return () => { cancelled = true }
  }, [currentStory?.id, currentStory?.media_path, currentStory?.media_url, user])

  useEffect(() => {
    if (!currentStory || !user) return
    let alive = true
    void (async () => {
      const { error } = await supabase.from('story_views').upsert({ story_id: currentStory.id, viewer_id: user.id }, { onConflict: 'story_id,viewer_id' })
      if (!alive) return
      if (!error) await loadInteractions(currentStory.id)
    })()
    return () => { alive = false }
  }, [currentStory?.id, user])

  useEffect(() => {
    const previous = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehaviorY
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehaviorY = 'none'
    return () => {
      document.body.style.overflow = previous
      document.body.style.overscrollBehaviorY = previousOverscroll
    }
  }, [])

  useEffect(() => {
    if (paused) return
    intervalRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          advance()
          return 0
        }
        return p + (100 / (DURATION / 100))
      })
    }, 100)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [groupIndex, storyIndex, paused])

  const advance = () => {
    setProgress(0)
    const group = groups[groupIndex]
    if (!group) return onClose()
    if (storyIndex < group.stories.length - 1) {
      setStoryIndex(s => s + 1)
    } else if (groupIndex < groups.length - 1) {
      setGroupIndex(g => g + 1)
      setStoryIndex(0)
    } else {
      onClose()
    }
  }

  const goBack = () => {
    setProgress(0)
    if (storyIndex > 0) setStoryIndex(s => s - 1)
    else if (groupIndex > 0) {
      setGroupIndex(g => g - 1)
      setStoryIndex(groups[groupIndex - 1].stories.length - 1)
    }
  }

  const toggleLike = async () => {
    if (!user || !currentStory || isOwner) return
    const next = !liked
    setLiked(next)
    setLikeCount(c => Math.max(0, c + (next ? 1 : -1)))
    const result = next
      ? await supabase.from('story_likes').upsert({ story_id: currentStory.id, user_id: user.id }, { onConflict: 'story_id,user_id' })
      : await supabase.from('story_likes').delete().eq('story_id', currentStory.id).eq('user_id', user.id)
    if (result.error) {
      setLiked(!next)
      setLikeCount(c => Math.max(0, c + (next ? -1 : 1)))
      toast.error(result.error.message)
    }
  }

  const loadViewers = async () => {
    if (!currentStory) return
    const { data, error } = await supabase
      .from('story_views')
      .select('viewer_id, profiles!viewer_id(id,username,full_name,avatar_url,is_verified)')
      .eq('story_id', currentStory.id)
    if (error) return toast.error(error.message)
    setViewers((data || []).map(v => v.profiles as unknown as Profile).filter(Boolean))
    setShowViewers(true)
  }

  const submitComment = async () => {
    if (!comment.trim() || !user || !currentStory) return
    const text = comment.trim()
    const { data, error } = await supabase.from('story_comments')
      .insert({ story_id: currentStory.id, user_id: user.id, content: text })
      .select('id,story_id,user_id,content,created_at,profiles!user_id(id,username,full_name,avatar_url,is_verified)')
      .single()
    if (error) return toast.error(error.message)
    if (data) setComments(rows => [...rows, { ...data, profiles: data.profiles as unknown as Profile }])
    setComment('')
  }

  const deleteStory = async () => {
    if (!currentStory || !user) return
    const { error } = await supabase.from('stories').delete().eq('id', currentStory.id)
    if (error) return toast.error(error.message)
    toast.success(copy.delete)
    if (currentGroup.stories.length > 1) {
      if (storyIndex < currentGroup.stories.length - 1) setStoryIndex(s => s + 1)
      else setStoryIndex(s => Math.max(0, s - 1))
    } else if (groups.length > 1) {
      setGroupIndex(g => g + 1 < groups.length ? g + 1 : 0)
      setStoryIndex(0)
    } else onClose()
    setProgress(0)
  }

  if (!currentStory || !currentGroup) return null

  return (
    <div className="fixed inset-0 z-[80] bg-black text-white overflow-hidden yomy-story-stage" onWheel={e => e.preventDefault()} onTouchMove={e => e.preventDefault()}>
      <div className="relative mx-auto h-[100dvh] w-full max-w-[430px] overflow-hidden bg-black">
        <div className="absolute top-0 left-0 right-0 z-30 flex gap-1.5 px-3 pt-[max(.6rem,env(safe-area-inset-top))]">
          {currentGroup.stories.map((_, i) => <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25"><div className="h-full bg-white" style={{ width: i < storyIndex ? '100%' : i === storyIndex ? progress + '%' : '0%' }} /></div>)}
        </div>

        <header className="absolute top-[max(1.5rem,env(safe-area-inset-top)+.55rem)] left-0 right-0 z-30 flex items-center gap-3 px-3">
          <button type="button" className="grid size-9 place-items-center rounded-full bg-black/25 border border-white/10 backdrop-blur-xl" onClick={goBack} aria-label="Previous"><ChevronLeft className="size-5" /></button>
          <Avatar className="size-9 ring-2 ring-white/25 shadow-xl"><AvatarImage src={currentGroup.user.avatar_url} /><AvatarFallback>{currentGroup.user.username[0]?.toUpperCase()}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{currentGroup.user.username}</p><p className="text-[10px] text-white/55">{new Date(currentStory.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</p></div>
          {isOwner && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-9 rounded-full text-white hover:bg-white/10"><MoreVertical className="size-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="z-[120] w-52 rounded-2xl"><DropdownMenuItem onClick={openEdit}><Pencil className="size-4 mr-2" />{copyEdit.edit}</DropdownMenuItem><DropdownMenuItem onClick={loadViewers}><Eye className="size-4 mr-2" />{copy.view}</DropdownMenuItem><DropdownMenuItem onClick={deleteStory} className="text-destructive focus:text-destructive"><Trash2 className="size-4 mr-2" />{copy.delete}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
          <button type="button" className="grid size-9 place-items-center rounded-full bg-black/25 border border-white/10 backdrop-blur-xl" onClick={onClose} aria-label="Close"><X className="size-5" /></button>
        </header>

        <div className="absolute inset-0 z-0 flex items-center justify-center" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
          {currentStory.media_type === 'video' ? <video src={storyMediaUrl} className="w-full h-full object-cover" autoPlay muted playsInline loop /> : <img src={storyMediaUrl} className="w-full h-full object-cover" alt="" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />
        </div>

        <button type="button" aria-label="Previous story" className="absolute left-0 top-20 bottom-28 z-10 w-1/3" onClick={goBack} />
        <button type="button" aria-label="Next story" className="absolute right-0 top-20 bottom-28 z-10 w-1/3" onClick={advance} />

        {currentStory.caption && <div className="absolute left-4 right-4 bottom-32 z-20"><p className="inline-block max-w-full rounded-2xl bg-black/30 px-3 py-2 text-sm backdrop-blur-xl">{currentStory.caption}</p></div>}

        <div className="absolute bottom-0 left-0 right-0 z-30 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 rounded-[1.4rem] border border-white/12 bg-black/35 p-2 backdrop-blur-2xl shadow-[0_18px_55px_rgba(0,0,0,.3)]">
            {!isOwner && <button type="button" onClick={() => void toggleLike()} className={'grid size-11 place-items-center rounded-full border transition-all active:scale-90 ' + (liked ? 'bg-white text-rose-500 border-white/70' : 'bg-white/8 border-white/15 text-white')} aria-label={liked ? copy.liked : copy.like}><Heart className={'size-5 ' + (liked ? 'fill-current' : '')} /></button>}
            <button type="button" onClick={() => { setCommentsOpen(true); setPaused(true) }} className="grid size-11 place-items-center rounded-full bg-white/8 border border-white/15 text-white active:scale-90" aria-label={copy.comments}><MessageCircle className="size-5" /></button>
            <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">{likeCount} {copy.like.toLowerCase()}</p><p className="text-[10px] text-white/55">{comments.length} {copy.comments.toLowerCase()}</p></div>
            {isOwner && <Button variant="ghost" size="sm" className="rounded-full text-white hover:bg-white/10" onClick={loadViewers}><Eye className="size-4 mr-1" />{viewers.length || ''} {copy.viewers}</Button>}
          </div>
        </div>

        {editOpen && <div className="absolute inset-x-3 bottom-3 z-[100] rounded-[28px] border border-white/15 bg-black/80 p-4 backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,.55)]">
          <div className="flex items-center gap-2 mb-3"><Pencil className="size-4" /><p className="font-semibold flex-1">{copyEdit.edit}</p><button type="button" onClick={() => setEditOpen(false)} className="grid size-8 place-items-center rounded-full bg-white/8"><X className="size-4" /></button></div>
          <div className="space-y-3">
            <Input value={editCaption} onChange={e => setEditCaption(e.target.value)} placeholder={copyEdit.caption} className="h-11 rounded-2xl border-white/15 bg-white/8 text-white" />
            <div className="grid grid-cols-3 gap-2">
              {(['public','friends','private'] as const).map(value => {
                const Icon = value === 'public' ? Globe : value === 'friends' ? Users : Lock
                return <button key={value} type="button" onClick={() => setEditVisibility(value)} className={'flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border text-xs ' + (editVisibility === value ? 'border-white bg-white text-black' : 'border-white/15 bg-white/5 text-white/75')}><Icon className="size-4" />{value === 'public' ? 'Public' : value === 'friends' ? 'Friends' : 'Only me'}</button>
              })}
            </div>
            <div className="flex gap-2">{['24','48','5'].map(value => <button key={value} type="button" onClick={() => setEditDuration(value)} className={'flex-1 min-h-11 rounded-2xl border text-xs font-semibold ' + (editDuration === value ? 'border-white bg-white text-black' : 'border-white/15 bg-white/5 text-white/75')}>{value}h</button>)}</div>
            <Button className="w-full rounded-2xl" onClick={() => void saveEdit()}><Check className="size-4 mr-1" />{copyEdit.save}</Button>
          </div>
        </div>}

        {commentsOpen && <div className="absolute inset-x-2 bottom-2 z-40 max-h-[65dvh] overflow-hidden rounded-[1.6rem] border border-white/15 bg-black/78 backdrop-blur-2xl shadow-[0_25px_90px_rgba(0,0,0,.45)]" onTouchMove={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><MessageCircle className="size-4" /><p className="text-sm font-semibold flex-1">{copy.comments}</p><button type="button" onClick={() => { setCommentsOpen(false); setPaused(false) }} className="grid size-8 place-items-center rounded-full bg-white/8"><X className="size-4" /></button></div>
          <div className="max-h-[45dvh] overflow-y-auto overscroll-contain px-3 py-2">
            {comments.length === 0 ? <p className="py-10 text-center text-xs text-white/55">{copy.noComments}</p> : comments.map(item => <div key={item.id} className="flex gap-2.5 py-2"><Avatar className="size-8 shrink-0"><AvatarImage src={item.profiles?.avatar_url} /><AvatarFallback>{item.profiles?.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0"><p className="text-xs font-semibold">{item.profiles?.username}</p><p className="text-sm whitespace-pre-wrap break-words text-white/90">{item.content}</p></div></div>)}
          </div>
          <div className="border-t border-white/10 p-2 flex gap-2">
            <Input value={comment} onChange={e => setComment(e.target.value)} placeholder={copy.add} className="h-10 rounded-full bg-white/8 border-white/10 text-white placeholder:text-white/40" onFocus={() => setPaused(true)} onKeyDown={e => { if (e.key === 'Enter') void submitComment() }} />
            <Button size="icon" className="size-10 rounded-full bg-white text-black hover:bg-white/90" disabled={!comment.trim()} onClick={() => void submitComment()}><Send className="size-4" /></Button>
          </div>
        </div>}

        {showViewers && <div className="absolute inset-x-2 bottom-2 z-50 max-h-[70dvh] overflow-hidden rounded-[1.6rem] border border-white/15 bg-background/92 text-foreground backdrop-blur-2xl shadow-[0_25px_90px_rgba(0,0,0,.45)]">
          <div className="flex items-center justify-between p-4 border-b"><h3 className="font-semibold text-sm">{copy.viewers} ({viewers.length})</h3><Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowViewers(false)}><X className="size-4" /></Button></div>
          <div className="max-h-[55dvh] overflow-y-auto">{viewers.map(v => <div key={v.id} className="flex items-center gap-3 px-4 py-3"><Avatar className="size-9"><AvatarImage src={v.avatar_url} /><AvatarFallback>{v.username[0]?.toUpperCase()}</AvatarFallback></Avatar><div><p className="text-sm font-medium">{v.username}</p><p className="text-xs text-muted-foreground">{v.full_name}</p></div></div>)}</div>
        </div>}
      </div>
    </div>
  )
}
