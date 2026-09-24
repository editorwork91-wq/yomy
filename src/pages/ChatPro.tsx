import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Archive, BellOff, Check, CheckCheck, ChevronLeft, Copy, Heart, ImagePlus,
  Mic, MoreVertical, Palette, Phone, Reply, Send, Smile, Trash2, Video, WifiOff,
  X, Pencil, Eye, Clock3
} from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Message, Profile as ProfileType } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useCall } from '@/components/calls/CallProvider'
import { sendPushEvent } from '@/lib/push'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import {
  cacheJson, cacheMessages, queueMessage, readCachedJson, readCachedMessages,
  readQueuedMessages, removeQueuedMessage
} from '@/lib/offlineStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type ChatPreference = {
  user_id: string
  other_user_id: string
  archived: boolean
  muted: boolean
  wallpaper: 'default' | 'romance' | 'hearts' | 'petals' | 'midnight' | 'paper'
  bubble_theme: 'default' | 'ocean' | 'mint' | 'violet' | 'rose' | 'amber'
}

type PendingMedia = { file: File; kind: 'image' | 'video'; previewUrl: string }

const wallpapers: ChatPreference['wallpaper'][] = ['default', 'romance', 'hearts', 'petals', 'midnight', 'paper']
const bubbleThemes: ChatPreference['bubble_theme'][] = ['default', 'ocean', 'mint', 'violet', 'rose', 'amber']

const bubbleClasses: Record<ChatPreference['bubble_theme'], string> = {
  default: 'bg-primary text-primary-foreground',
  ocean: 'bg-sky-500 text-white',
  mint: 'bg-emerald-500 text-white',
  violet: 'bg-violet-500 text-white',
  rose: 'bg-rose-500 text-white',
  amber: 'bg-amber-500 text-white',
}

const wallpaperLabel: Record<ChatPreference['wallpaper'], string> = {
  default: 'Default',
  romance: 'Love & romance',
  hearts: 'Hearts',
  petals: 'Flowers & petals',
  midnight: 'Midnight',
  paper: 'Paper',
}

function fallbackPreference(userId: string, otherUserId: string): ChatPreference {
  return {
    user_id: userId,
    other_user_id: otherUserId,
    archived: false,
    muted: false,
    wallpaper: 'default',
    bubble_theme: 'default',
  }
}

function initials(profile?: ProfileType | null) {
  return profile?.username?.slice(0, 1)?.toUpperCase() || '?'
}

function isTransientSendError(error: unknown) {
  const value = error as { message?: string; code?: string; status?: number } | null
  const message = String(value?.message || '').toLowerCase()
  const status = Number(value?.status || 0)
  return !navigator.onLine
    || status === 0
    || [408, 425, 429].includes(status)
    || status >= 500
    || /failed to fetch|network|timeout|timed out|fetch failed|connection reset|econn|offline/.test(message)
}

function renderMessageText(content: string) {
  const parts = content.split(/(https?:\/\/[^\s]+)/gi)
  return parts.map((part, index) =>
    /^https?:\/\//i.test(part)
      ? <a key={index} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 opacity-95">{part}</a>
      : <span key={index}>{part}</span>
  )
}

function Wallpaper({ type }: { type: ChatPreference['wallpaper'] }) {
  if (type === 'default') return null
  const symbols = type === 'romance'
    ? ['♥', '♡', '✿', '❀', '♥', '❁']
    : type === 'hearts'
      ? ['♥', '♡', '❤', '❥']
      : type === 'petals'
        ? ['✿', '❀', '❁', '✾']
        : type === 'midnight'
          ? ['✦', '✧', '⋆', '✩']
          : ['·', '•', '⊹', '◦']
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none opacity-[0.075]">
      <div className="grid grid-cols-6 gap-x-7 gap-y-8 p-5 text-3xl leading-none text-foreground">
        {Array.from({ length: 54 }, (_, i) => (
          <span key={i} className="text-center" style={{ transform: 'rotate(' + ((i % 5 - 2) * 7) + 'deg)' }}>
            {symbols[i % symbols.length]}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ChatPro() {
  const { username } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { startCall } = useCall()
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const [otherUser, setOtherUser] = useState<ProfileType | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [preference, setPreference] = useState<ChatPreference | null>(null)
  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [reactionFor, setReactionFor] = useState<string | null>(null)
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null)
  const [viewOnceUrl, setViewOnceUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [draftTheme, setDraftTheme] = useState<ChatPreference['wallpaper']>('default')
  const [draftBubble, setDraftBubble] = useState<ChatPreference['bubble_theme']>('default')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  const syncingRef = useRef(false)

  const targetUsername = username || searchParams.get('to')

  const loadOtherUser = useCallback(async () => {
    if (!targetUsername) return
    const cacheKey = 'chatPeer:' + targetUsername
    const cached = await readCachedJson<ProfileType>(cacheKey)
    if (cached) setOtherUser(cached)

    if (!online) return
    const { data, error } = await supabase.from('profiles').select('*').eq('username', targetUsername).maybeSingle()
    if (error) {
      if (!cached) toast.error('Could not load this conversation')
      return
    }
    if (data) {
      setOtherUser(data as ProfileType)
      await cacheJson(cacheKey, data as ProfileType)
    }
  }, [online, targetUsername])

  const loadPreference = useCallback(async (peerId: string) => {
    if (!user) return
    const key = 'chatPref:' + user.id + ':' + peerId
    const cached = await readCachedJson<ChatPreference>(key)
    if (cached) setPreference(cached)
    if (!online) {
      if (!cached) setPreference(fallbackPreference(user.id, peerId))
      return
    }
    const { data } = await supabase.from('chat_preferences').select('*').eq('user_id', user.id).eq('other_user_id', peerId).maybeSingle()
    const next = (data as ChatPreference | null) || fallbackPreference(user.id, peerId)
    setPreference(next)
    await cacheJson(key, next)
  }, [online, user])

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const loadMessages = useCallback(async (withLoader = true) => {
    if (!user || !otherUser) return
    const cached = await readCachedMessages<Message>(user.id, otherUser.id)
    if (cached?.length) {
      setMessages(cached)
      if (withLoader) setLoading(false)
    }
    if (!online) {
      setLoading(false)
      return
    }
    if (withLoader) setLoading(true)
    const { data, error } = await supabase
      .from('messages')
      .select('*, message_reactions(id,user_id,emoji,created_at)')
      .or('and(sender_id.eq.' + user.id + ',receiver_id.eq.' + otherUser.id + '),and(sender_id.eq.' + otherUser.id + ',receiver_id.eq.' + user.id + ')')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(250)
    if (!error && data) {
      const next = data as Message[]
      setMessages(next)
      await cacheMessages(user.id, otherUser.id, next)
      if (next.some(m => m.receiver_id === user.id && !m.is_seen && !m.deleted_for_everyone)) {
        await supabase.rpc('mark_messages_seen', { p_other_user_id: otherUser.id })
      }
    }
    setLoading(false)
  }, [online, otherUser, user])

  const flushQueue = useCallback(async () => {
    if (!user || !otherUser || !online || syncingRef.current) return
    syncingRef.current = true
    const queued = (await readQueuedMessages(user.id)).filter(item => item.otherUserId === otherUser.id)
    if (!queued.length) {
      syncingRef.current = false
      return
    }
    for (const item of queued) {
      const { data, error } = await supabase.rpc('send_message', {
        p_receiver_id: otherUser.id,
        p_content: item.content,
        p_reply_to_id: item.replyToId,
        p_media_url: '',
        p_media_type: '',
        p_media_bucket: 'messages',
        p_media_path: null,
        p_view_once: false,
        p_client_message_id: item.clientMessageId,
      })
      if (!error && data) {
        await removeQueuedMessage(user.id, item.clientMessageId)
      } else if (error && !isTransientSendError(error)) {
        await removeQueuedMessage(user.id, item.clientMessageId)
        setMessages(prev => prev.filter(message => message.client_message_id !== item.clientMessageId && message.id !== 'local:' + item.clientMessageId))
        toast.error('Could not send a queued message: ' + error.message)
      }
    }
    syncingRef.current = false
    await loadMessages(false)
  }, [loadMessages, online, otherUser, user])

  useEffect(() => { void loadOtherUser() }, [loadOtherUser])
  useEffect(() => {
    if (otherUser) {
      void loadPreference(otherUser.id)
      void loadMessages()
    }
  }, [loadMessages, loadPreference, otherUser])
  useEffect(() => { if (online) void flushQueue() }, [flushQueue, online])

  useEffect(() => {
    if (!user || !otherUser) return
    const channel = supabase.channel('chat-pro:' + user.id + ':' + otherUser.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + user.id }, payload => {
        const row = payload.new as Message
        if (row.sender_id !== otherUser.id) return
        setMessages(prev => prev.some(m => m.id === row.id) ? prev : [...prev, row])
        void supabase.rpc('mark_message_delivered', { p_message_id: row.id })
        // "Delivered" and "Read" are different states. Do not mark a
        // message as read while the app is backgrounded.
        if (document.visibilityState === 'visible') {
          void supabase.rpc('mark_messages_seen', { p_other_user_id: otherUser.id })
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        const row = payload.new as Message
        setMessages(prev => prev.map(m => m.id === row.id ? { ...m, ...row } : m))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, () => void loadMessages(false))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, () => void loadMessages(false))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, () => void loadMessages(false))
      .subscribe()
    const onOnline = () => { void flushQueue(); void loadMessages(false) }
    const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void loadMessages(false) }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [flushQueue, loadMessages, otherUser, user])

  useEffect(() => { window.setTimeout(() => scrollToBottom(false), 0) }, [messages.length, scrollToBottom])
  useEffect(() => () => {
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl)
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
  }, [pendingMedia])

  const savePreference = async (patch: Partial<ChatPreference>) => {
    if (!user || !otherUser) return
    const base = preference || fallbackPreference(user.id, otherUser.id)
    const next = { ...base, ...patch }
    setPreference(next)
    await cacheJson('chatPref:' + user.id + ':' + otherUser.id, next)
    if (!online) {
      toast.success('Saved on this device • will sync when online')
      return
    }
    const { error } = await supabase.from('chat_preferences').upsert(next, { onConflict: 'user_id,other_user_id' })
    if (error) toast.error(error.message)
    if ('muted' in patch) {
      if (next.muted) {
        await supabase.from('muted_chats').upsert({ user_id: user.id, muted_user_id: otherUser.id })
      } else {
        await supabase.from('muted_chats').delete().eq('user_id', user.id).eq('muted_user_id', otherUser.id)
      }
    }
  }

  const copyMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content)
      toast.success('Copied')
    } catch {}
  }

  const editMessage = async () => {
    if (!editing || !user || !input.trim() || !online) return
    const content = input.trim()
    const editedAt = new Date().toISOString()
    const { error } = await supabase.from('messages').update({ content, edited_at: editedAt }).eq('id', editing.id).eq('sender_id', user.id)
    if (error) return toast.error(error.message)
    setMessages(prev => prev.map(m => m.id === editing.id ? { ...m, content, edited_at: editedAt } : m))
    setEditing(null)
    setInput('')
  }

  const deleteForEveryone = async (message: Message) => {
    if (!user || !online || message.sender_id !== user.id) return
    const { error } = await supabase.from('messages').update({
      deleted_for_everyone: true,
      content: '',
      media_url: '',
      media_type: '',
    }).eq('id', message.id).eq('sender_id', user.id)
    if (error) toast.error(error.message)
    else setMessages(prev => prev.map(m => m.id === message.id ? { ...m, deleted_for_everyone: true, content: '', media_url: '', media_type: '' } : m))
  }

  const react = async (messageId: string, emoji: string) => {
    if (!user || !online || messageId.startsWith('local:')) return
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    const existing = msg.message_reactions?.find(r => r.user_id === user.id)
    let result
    if (existing?.emoji === emoji) {
      result = await supabase.from('message_reactions').delete().eq('id', existing.id)
    } else if (existing) {
      result = await supabase.from('message_reactions').update({ emoji }).eq('id', existing.id)
    } else {
      result = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji })
    }
    if (result.error) toast.error(result.error.message)
    setReactionFor(null)
    await loadMessages(false)
  }

  const uploadMedia = async (file: File, kind: 'image' | 'video') => {
    if (!user || !otherUser) return
    if (!online) {
      toast.error('Media waits for a connection. Text messages still work offline.')
      return
    }
    const path = (kind === 'video' ? 'videos/' : 'images/') + user.id + '/' + crypto.randomUUID() + '.' + (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg'))
    const { error: uploadError } = await supabase.storage.from('messages').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (uploadError) return toast.error(uploadError.message)
    const { data: publicData } = supabase.storage.from('messages').getPublicUrl(path)
    const { data, error } = await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: otherUser.id,
      content: input.trim(),
      media_url: publicData.publicUrl,
      media_type: kind,
      media_bucket: 'messages',
      media_path: path,
      is_encrypted: true,
      view_once: false,
      reply_to_id: replyTo?.id || null,
    }).select('*').single()
    if (error) return toast.error(error.message)
    setMessages(prev => [...prev, data as Message])
    setInput('')
    setReplyTo(null)
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl)
    setPendingMedia(null)
    void sendPushEvent({
      type: 'message',
      targetUserId: otherUser.id,
      title: user.user_metadata?.username || 'Yomy',
      body: kind === 'video' ? '🎬 Video' : '📷 Photo',
      data: { message_id: data.id, url: '/messages/' + otherUser.username },
    })
  }

  const uploadVoice = async (file: File) => {
    if (!user || !otherUser || !online) return
    const path = 'audio/' + user.id + '/' + crypto.randomUUID() + '.' + (file.name.split('.').pop() || 'webm')
    const { error: uploadError } = await supabase.storage.from('messages').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (uploadError) return toast.error(uploadError.message)
    const { data: pub } = supabase.storage.from('messages').getPublicUrl(path)
    const { data, error } = await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: otherUser.id,
      content: '',
      media_url: pub.publicUrl,
      media_type: 'audio',
      media_bucket: 'messages',
      media_path: path,
      is_encrypted: true,
      view_once: false,
      reply_to_id: replyTo?.id || null,
    }).select('*').single()
    if (error) return toast.error(error.message)
    setMessages(prev => [...prev, data as Message])
    setReplyTo(null)
  }

  const startVoice = async () => {
    if (!online || recording) return
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) {
      toast.error('Voice recording is not supported here')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      recordingStreamRef.current = stream
      recordingChunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) recordingChunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        stream.getTracks().forEach(track => track.stop())
        recorderRef.current = null
        recordingStreamRef.current = null
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
        setRecording(false)
        setRecordingSeconds(0)
        if (blob.size) {
          const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
          await uploadVoice(new File([blob], 'voice-' + Date.now() + '.' + ext, { type: blob.type }))
        }
      }
      recorder.start(200)
      setRecording(true)
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds(v => v + 1), 1000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not access microphone')
    }
  }

  const sendText = async () => {
    if (!user || !otherUser || !input.trim() || sending) return
    if (editing) {
      await editMessage()
      return
    }
    const content = input.trim()
    const clientMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const replyId = replyTo?.id || null
    const temp: Message = {
      id: 'local:' + clientMessageId,
      sender_id: user.id,
      receiver_id: otherUser.id,
      content,
      media_url: '',
      media_type: '',
      is_seen: false,
      delivered_at: null,
      is_encrypted: true,
      view_once: false,
      view_once_opened: false,
      deleted_at: null,
      deleted_for_everyone: false,
      reply_to_id: replyId,
      edited_at: null,
      is_request: false,
      request_accepted: false,
      created_at: createdAt,
      client_message_id: clientMessageId,
      reply_to: replyTo || undefined,
    }
    const nextLocal = [...messages, temp]
    setMessages(nextLocal)
    setInput('')
    setReplyTo(null)
    await cacheMessages(user.id, otherUser.id, nextLocal)

    if (!online) {
      await queueMessage({ clientMessageId, userId: user.id, otherUserId: otherUser.id, content, replyToId: replyId, createdAt })
      toast.success('Message saved • will send when you reconnect')
      return
    }

    setSending(true)
    const { data, error } = await supabase.rpc('send_message', {
      p_receiver_id: otherUser.id,
      p_content: content,
      p_reply_to_id: replyId,
      p_media_url: '',
      p_media_type: '',
      p_media_bucket: 'messages',
      p_media_path: null,
      p_view_once: false,
      p_client_message_id: clientMessageId,
    })
    if (!error && data) {
      const replaced = nextLocal.map(m => m.id === temp.id ? data as Message : m)
      setMessages(replaced)
      await cacheMessages(user.id, otherUser.id, replaced)
      void sendPushEvent({ type: 'message', targetUserId: otherUser.id, title: user.user_metadata?.username || 'Yomy', body: content, data: { message_id: data.id, url: '/messages/' + otherUser.username } })
    } else if (isTransientSendError(error)) {
      await queueMessage({ clientMessageId, userId: user.id, otherUserId: otherUser.id, content, replyToId: replyId, createdAt })
    } else {
      setMessages(prev => prev.filter(message => message.id !== temp.id))
      await cacheMessages(user.id, otherUser.id, nextLocal.filter(message => message.id !== temp.id))
      toast.error('Message was not sent: ' + (error?.message || 'Unknown server error'))
    }
    setSending(false)
  }

  const pendingCount = messages.filter(message => message.id.startsWith('local:')).length
  const pref = preference || (user && otherUser ? fallbackPreference(user.id, otherUser.id) : null)
  const myBubble = pref ? bubbleClasses[pref.bubble_theme] : bubbleClasses.default

  const wallpaperBackground = useMemo(() => {
    if (!pref || pref.wallpaper === 'default') return ''
    if (pref.wallpaper === 'midnight') return 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950'
    if (pref.wallpaper === 'paper') return 'bg-[linear-gradient(rgba(127,127,127,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(127,127,127,.06)_1px,transparent_1px)] bg-[size:28px_28px]'
    return 'bg-muted/25'
  }, [pref])

  if (!otherUser) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-7" /></div>

  return (
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden">
      <header className="h-14 shrink-0 border-b border-border/70 bg-background/90 backdrop-blur-xl flex items-center gap-1 px-2">
        <Button variant="ghost" size="icon" className="size-10 rounded-full" onClick={() => navigate(-1)}><ChevronLeft className="size-5" /></Button>
        <Link to={'/profile/' + otherUser.username} className="flex items-center gap-2 min-w-0 flex-1">
          <div className="relative">
            <Avatar className="size-10"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback>{initials(otherUser)}</AvatarFallback></Avatar>
            {online && <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{otherUser.username}</p>
            <p className="text-[11px] text-muted-foreground truncate">{online ? 'Online · synced' : 'Offline · saved on this device'}</p>
          </div>
        </Link>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" disabled={!online} onClick={() => void startCall({ id: otherUser.id, username: otherUser.username, full_name: otherUser.full_name, avatar_url: otherUser.avatar_url }, 'voice')} aria-label="Voice call"><Phone className="size-5" /></Button>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" disabled={!online} onClick={() => void startCall({ id: otherUser.id, username: otherUser.username, full_name: otherUser.full_name, avatar_url: otherUser.avatar_url }, 'video')} aria-label="Video call"><Video className="size-5" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Chat options"><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => navigate('/profile/' + otherUser.username)}>Open profile</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void savePreference({ archived: !pref?.archived })}><Archive className="size-4 mr-2" />{pref?.archived ? 'Remove from archive' : 'Move to archive'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void savePreference({ muted: !pref?.muted })}><BellOff className="size-4 mr-2" />{pref?.muted ? 'Unmute notifications' : 'Mute notifications'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setDraftTheme(pref?.wallpaper || 'default'); setDraftBubble(pref?.bubble_theme || 'default'); setSettingsOpen(true) }}><Palette className="size-4 mr-2" />Chat theme & colors</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => scrollToBottom(true)}>Jump to latest</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {!online && <div className="shrink-0 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] flex items-center gap-2"><WifiOff className="size-3.5 text-amber-600" /><span>Offline mode: cached chat works. New posts, calls and live updates wait for internet.</span>{pendingCount > 0 && <span className="ml-auto font-semibold">{pendingCount} queued</span>}</div>}

      <div className={'relative flex-1 overflow-hidden ' + wallpaperBackground}>
        <Wallpaper type={pref?.wallpaper || 'default'} />
        <div ref={scrollRef} className="relative h-full overflow-y-auto px-3 py-4 space-y-2">
          {loading ? <div className="h-full flex items-center justify-center"><Spinner className="size-6" /></div> : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-3"><Heart className="size-7" /></div>
              <p className="font-medium">Say hello 👋</p><p className="text-xs mt-1">This conversation is ready.</p>
            </div>
          ) : messages.map(message => {
            const mine = message.sender_id === user?.id
            const queued = message.id.startsWith('local:')
            const reactionSummary = message.message_reactions?.reduce<Record<string, number>>((acc, item) => { acc[item.emoji] = (acc[item.emoji] || 0) + 1; return acc }, {})
            return (
              <div key={message.id} id={'message-' + message.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start') + ' group'}>
                <div className="max-w-[84%] sm:max-w-[72%] flex flex-col">
                  <div className={'rounded-[1.15rem] px-3.5 py-2 shadow-sm border border-black/5 ' + (mine ? myBubble + ' rounded-br-md' : 'bg-card text-foreground rounded-bl-md border-border')}>
                    {message.reply_to && !message.deleted_for_everyone && (
                      <button onClick={() => document.getElementById('message-' + message.reply_to_id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={'w-full text-left mb-2 rounded-lg px-2.5 py-1.5 text-[11px] ' + (mine ? 'bg-white/15' : 'bg-muted')}>
                        <span className="font-semibold block">{message.reply_to.sender_id === user?.id ? 'You' : otherUser.username}</span>
                        <span className="truncate block opacity-75">{message.reply_to.content || 'Attachment'}</span>
                      </button>
                    )}
                    {message.deleted_for_everyone ? <p className="text-xs italic opacity-60">Message deleted</p> : (
                      <>
                        {message.media_type === 'image' && message.media_url && <button onClick={() => message.view_once && setViewOnceUrl(message.media_url)} className="block"><img src={message.media_url} alt="" className="rounded-xl max-h-64 max-w-full object-cover mb-1.5" loading="lazy" /></button>}
                        {message.media_type === 'video' && message.media_url && <video src={message.media_url} controls playsInline className="rounded-xl max-h-64 max-w-full mb-1.5" />}
                        {message.media_type === 'audio' && message.media_url && <audio src={message.media_url} controls className="w-full min-w-48 h-9 mb-1.5" />}
                        {message.content && <p className="text-[15px] whitespace-pre-wrap break-words leading-[1.35]">{renderMessageText(message.content)}</p>}
                        {message.view_once && message.media_type && <p className="text-[11px] mt-1 opacity-75 flex items-center gap-1"><Eye className="size-3" />View once</p>}
                      </>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                      <span className={'text-[10px] ' + (mine ? 'text-white/60' : 'text-muted-foreground')}>{format(new Date(message.created_at), 'HH:mm')}</span>
                      {message.edited_at && <span className={'text-[10px] ' + (mine ? 'text-white/55' : 'text-muted-foreground')}>edited</span>}
                      {mine && (queued
                        ? <span className="text-white/65 text-[10px] inline-flex items-center gap-0.5"><Clock3 className="size-3" />{online ? 'Sending…' : 'Waiting for connection'}</span>
                        : message.is_seen ? <CheckCheck className="size-3.5 text-sky-200" /> : message.delivered_at ? <CheckCheck className="size-3.5 text-white/70" /> : <Check className="size-3.5 text-white/70" />)}
                    </div>
                  </div>
                  {Object.keys(reactionSummary || {}).length > 0 && <div className="-mt-2 z-10 rounded-full border bg-background px-2 py-0.5 text-[11px] shadow-sm">{Object.entries(reactionSummary || {}).map(([emoji, count]) => <span key={emoji} className="mr-1">{emoji}{count > 1 ? count : ''}</span>)}</div>}
                  {!queued && !message.deleted_for_everyone && <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setReactionFor(reactionFor === message.id ? null : message.id)}><Smile className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(message)}><Reply className="size-4" /></Button>
                    {mine && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void copyMessage(message)}><Copy className="size-4 mr-2" />Copy</DropdownMenuItem>{message.media_type === '' && <DropdownMenuItem onClick={() => { setEditing(message); setInput(message.content) }}><Pencil className="size-4 mr-2" />Edit</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem onClick={() => void deleteForEveryone(message)} className="text-destructive focus:text-destructive"><Trash2 className="size-4 mr-2" />Delete for everyone</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
                  </div>}
                  {reactionFor === message.id && <div className="mt-1 rounded-full border bg-background px-2 py-1 shadow-lg flex gap-1">{['❤️','😂','👍','🔥','😮','😢','🎉','👏'].map(emoji => <button key={emoji} onClick={() => void react(message.id, emoji)} className="size-8 rounded-full hover:bg-muted active:scale-90 transition-transform">{emoji}</button>)}</div>}
                </div>
              </div>
            )
          })}
          <div className="h-3" />
        </div>
      </div>

      {pendingMedia && <div className="shrink-0 border-t bg-card px-3 py-2"><div className="flex items-center gap-3">{pendingMedia.kind === 'image' ? <img src={pendingMedia.previewUrl} alt="" className="size-16 rounded-xl object-cover" /> : <video src={pendingMedia.previewUrl} muted playsInline className="size-16 rounded-xl object-cover" />}<div className="min-w-0 flex-1"><p className="text-sm font-medium">{pendingMedia.kind === 'image' ? 'Photo ready' : 'Video ready'}</p><p className="text-xs text-muted-foreground truncate">Add an optional caption in the box below</p></div><Button variant="ghost" size="icon" onClick={() => { URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null) }}><X className="size-5" /></Button><Button size="sm" disabled={!online} onClick={() => void uploadMedia(pendingMedia.file, pendingMedia.kind)}><Send className="size-4 mr-1" />Send</Button></div></div>}

      {replyTo && <div className="shrink-0 border-t bg-card px-4 py-2 flex items-center gap-3"><Reply className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">Replying to {replyTo.sender_id === user?.id ? 'yourself' : otherUser.username}</p><p className="text-xs text-muted-foreground truncate">{replyTo.content || 'Attachment'}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(null)}><X className="size-4" /></Button></div>}

      {editing && <div className="shrink-0 border-t bg-card px-4 py-2 flex items-center gap-3"><Pencil className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">Editing message</p><p className="text-xs text-muted-foreground truncate">{editing.content}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditing(null); setInput('') }}><X className="size-4" /></Button></div>}

      {recording && <div className="shrink-0 border-t bg-card px-4 py-3 flex items-center gap-3"><span className="size-2.5 rounded-full bg-destructive animate-pulse" /><span className="text-sm font-medium">Recording {String(Math.floor(recordingSeconds / 60)).padStart(2,'0')}:{String(recordingSeconds % 60).padStart(2,'0')}</span><div className="flex-1" /><Button size="icon" className="rounded-full" onClick={() => recorderRef.current?.stop()}><Check /></Button></div>}

      {!recording && <div className="shrink-0 border-t bg-background/95 backdrop-blur-xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-end gap-1.5">
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const file=e.target.files?.[0]; if(file && online) setPendingMedia({ file, kind:file.type.startsWith('video/')?'video':'image', previewUrl:URL.createObjectURL(file) }); e.currentTarget.value='' }} />
        <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" disabled={!online || !!pendingMedia} onClick={() => fileRef.current?.click()}><ImagePlus className="size-5" /></Button>
        <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" disabled={!online || !!pendingMedia} onClick={() => void startVoice()}><Mic className="size-5" /></Button>
        <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" onClick={() => setInput(value => value + ' ❤️')}><Smile className="size-5" /></Button>
        <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendText()} }} placeholder={editing ? 'Edit message…' : online ? 'Message' : 'Message offline…'} className="flex-1 rounded-2xl min-h-10 bg-muted/55 border-transparent focus-visible:border-border" />
        <Button size="icon" className="size-10 rounded-full shrink-0" disabled={!input.trim() || sending} onClick={() => void sendText()}>{editing ? <CheckCheck className="size-5" /> : <Send className="size-5" />}</Button>
      </div>}

      {settingsOpen && pref && <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm max-h-[82vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Chat theme & colors</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Decorative background</p>
              <div className="grid grid-cols-2 gap-2">
                {wallpapers.map(item => <button key={item} onClick={() => setDraftTheme(item)} className={'rounded-2xl border p-3 text-left transition-all ' + (draftTheme === item ? 'ring-2 ring-primary border-primary' : '')}>
                  <div className={'h-14 rounded-xl mb-2 flex items-center justify-center text-lg ' + (item === 'default' ? 'bg-muted' : item === 'midnight' ? 'bg-slate-950 text-white' : item === 'paper' ? 'bg-muted/40' : 'bg-pink-100 dark:bg-pink-950/30')}>{item === 'romance' ? '♥ ✿' : item === 'hearts' ? '♥ ♡' : item === 'petals' ? '✿ ❀' : item === 'midnight' ? '✦ ⋆' : item === 'paper' ? '· •' : 'A'}</div>
                  <span className="text-xs font-medium">{wallpaperLabel[item]}</span>
                </button>)}
              </div>
            </section>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Your message color</p>
              <div className="grid grid-cols-3 gap-2">
                {bubbleThemes.map(item => <button key={item} onClick={() => setDraftBubble(item)} className={'rounded-2xl border p-2 transition-all ' + (draftBubble === item ? 'ring-2 ring-primary border-primary' : '')}>
                  <div className={'h-9 rounded-xl ' + bubbleClasses[item] + ' flex items-center justify-end px-3 text-[11px]'}>Hello</div>
                  <span className="text-[11px] capitalize mt-1 block text-center">{item}</span>
                </button>)}
              </div>
            </section>
            <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setSettingsOpen(false)}>Cancel</Button><Button className="flex-1" onClick={async () => { await savePreference({ wallpaper:draftTheme, bubble_theme:draftBubble }); setSettingsOpen(false) }}>Apply</Button></div>
          </div>
        </DialogContent>
      </Dialog>}

      {viewOnceUrl && <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4" onClick={() => setViewOnceUrl(null)}><img src={viewOnceUrl} alt="" className="max-w-full max-h-full object-contain" /><Button variant="ghost" className="absolute top-4 right-4 text-white" size="icon"><X className="size-6" /></Button></div>}
      {pref?.muted && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-background/90 border px-3 py-1.5 text-[11px] shadow-xl backdrop-blur-xl">Notifications muted for this chat</div>}
    </div>
  )
}
