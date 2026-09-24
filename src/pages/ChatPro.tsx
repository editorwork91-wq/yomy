import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EmojiPicker, { EmojiStyle, Theme as EmojiTheme } from 'emoji-picker-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Archive, BellOff, Camera, Check, CheckCheck, ChevronLeft, Copy, Heart, ImagePlus,
  Mic, MoreVertical, Palette, Phone, Reply, RotateCcw, Send, Smile, Trash2, Video, WifiOff, PenLine,
  X, Pencil, Eye, Clock3, UserRound, ShieldCheck, Plus, FileText, BarChart3
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
  queueSyncOperation, patchCachedConversation
} from '@/lib/offlineStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import LinkPreviewCard from '@/components/posts/LinkPreviewCard'
import ChatDoodleEditor from '@/components/chat/ChatDoodleEditor'
import { BUILT_IN_STICKERS, stickerDataUrl, stickerFile } from '@/components/chat/ChatStickerTray'
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
  wallpaper: 'default' | 'romance' | 'hearts' | 'petals' | 'midnight' | 'paper' | 'roses'
  bubble_theme: 'default' | 'ocean' | 'mint' | 'violet' | 'rose' | 'amber'
}

type PendingMedia = { file: File; kind: 'image' | 'video' | 'file'; previewUrl: string }

const wallpapers: ChatPreference['wallpaper'][] = ['default', 'romance', 'hearts', 'petals', 'roses', 'midnight', 'paper']
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
  roses: 'Rose garden',
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

function firstUrl(value: string) {
  return value.match(/https?:\/\/[^\s]+/i)?.[0] || ''
}

function sharedChatKey(userId: string, otherUserId: string) {
  return userId < otherUserId
    ? { user_low: userId, user_high: otherUserId }
    : { user_low: otherUserId, user_high: userId }
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
      ? ['♥', '♡', '❤', '❥', '💗']
      : type === 'petals'
        ? ['✿', '❀', '❁', '✾', '🌸']
        : type === 'roses'
          ? ['🌹', '♡', '✿', '❀', '🌹']
          : type === 'midnight'
            ? ['✦', '✧', '⋆', '✩']
            : ['·', '•', '⊹', '◦']

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
      <div className="absolute inset-0 opacity-70" style={{
        backgroundImage: type === 'midnight'
          ? 'radial-gradient(circle at 20% 20%, rgba(120,140,255,.12), transparent 30%), radial-gradient(circle at 80% 70%, rgba(190,120,255,.10), transparent 28%)'
          : type === 'roses'
            ? 'radial-gradient(circle at 18% 24%, rgba(255,90,130,.11), transparent 22%), radial-gradient(circle at 82% 72%, rgba(255,160,180,.10), transparent 26%)'
            : 'radial-gradient(circle at 20% 20%, rgba(255,120,160,.08), transparent 25%), radial-gradient(circle at 85% 75%, rgba(120,180,255,.07), transparent 24%)'
      }} />
      <div className="relative grid grid-cols-6 gap-x-7 gap-y-8 p-5 text-2xl leading-none text-foreground/80 opacity-[0.085]">
        {Array.from({ length: 60 }, (_, i) => <span key={i} className="text-center" style={{ transform: 'rotate(' + ((i % 5 - 2) * 7) + 'deg) scale(' + (0.88 + ((i % 3) * .08)) + ')' }}>{symbols[i % symbols.length]}</span>)}
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
  const [sharedWallpaper, setSharedWallpaper] = useState<ChatPreference['wallpaper']>('default')
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [reactionFor, setReactionFor] = useState<string | null>(null)
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null)
  const [viewOnceUrl, setViewOnceUrl] = useState<string | null>(null)
  const [viewOnceMessageId, setViewOnceMessageId] = useState<string | null>(null)
  const [viewOnceRemaining, setViewOnceRemaining] = useState<number | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [pendingViewOnceLimit, setPendingViewOnceLimit] = useState<0 | 1 | 2>(0)
  const [viewOncePickerOpen, setViewOncePickerOpen] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('photo')
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment')
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraRecording, setCameraRecording] = useState(false)
  const [cameraSeconds, setCameraSeconds] = useState(0)
  const [cameraFlash, setCameraFlash] = useState(false)
  const [drawingOpen, setDrawingOpen] = useState(false)
  const [stickers, setStickers] = useState<Array<{ id: string; url: string; name: string }>>([])
  const [stickersLoading, setStickersLoading] = useState(false)
  const longPressRef = useRef<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [draftTheme, setDraftTheme] = useState<ChatPreference['wallpaper']>('default')
  const [draftBubble, setDraftBubble] = useState<ChatPreference['bubble_theme']>('default')
  const scrollRef = useRef<HTMLDivElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const cameraRecorderRef = useRef<MediaRecorder | null>(null)
  const cameraChunksRef = useRef<Blob[]>([])
  const cameraTimerRef = useRef<number | null>(null)
  const resolvingMediaRef = useRef(new Set<string>())
  const openingViewOnceRef = useRef(new Set<string>())
  const longPressTriggeredRef = useRef(false)
  
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

  const loadSharedSettings = useCallback(async (peerId: string) => {
    if (!user) return
    const key = 'chatShared:' + [user.id, peerId].sort().join(':')
    const cached = await readCachedJson<{ wallpaper: ChatPreference['wallpaper'] }>(key)
    if (cached?.wallpaper) setSharedWallpaper(cached.wallpaper)
    if (!online) {
      if (!cached) setSharedWallpaper('default')
      return
    }
    const pair = sharedChatKey(user.id, peerId)
    const { data } = await supabase
      .from('chat_shared_settings')
      .select('wallpaper')
      .eq('user_low', pair.user_low)
      .eq('user_high', pair.user_high)
      .maybeSingle()
    const wallpaper = (data?.wallpaper as ChatPreference['wallpaper'] | undefined) || 'default'
    setSharedWallpaper(wallpaper)
    await cacheJson(key, { wallpaper })
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
      .select('*, message_reactions(id,user_id,emoji,created_at), chat_polls(id,question,chat_poll_options(id,option_index,label),chat_poll_votes(user_id,option_id))')
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


  useEffect(() => { void loadOtherUser() }, [loadOtherUser])
  useEffect(() => {
    if (otherUser) {
      void loadPreference(otherUser.id)
      void loadSharedSettings(otherUser.id)
      void loadMessages()
    }
  }, [loadMessages, loadPreference, loadSharedSettings, otherUser])

  useEffect(() => {
    if (!user || !otherUser || !online) return
    const pair = sharedChatKey(user.id, otherUser.id)
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
        setMessages(prev => {
          if (!prev.some(m => m.id === row.id)) return prev
          return prev.map(m => m.id === row.id ? { ...m, ...row } : m)
        })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_shared_settings' }, payload => {
        const row = payload.new as { user_low?: string; user_high?: string; wallpaper?: string }
        if (row.user_low !== pair.user_low || row.user_high !== pair.user_high) return
        const wallpaper = (row.wallpaper || 'default') as ChatPreference['wallpaper']
        setSharedWallpaper(wallpaper)
        void cacheJson('chatShared:' + [user.id, otherUser.id].sort().join(':'), { wallpaper })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_shared_settings' }, payload => {
        const row = payload.new as { user_low?: string; user_high?: string; wallpaper?: string }
        if (row.user_low !== pair.user_low || row.user_high !== pair.user_high) return
        const wallpaper = (row.wallpaper || 'default') as ChatPreference['wallpaper']
        setSharedWallpaper(wallpaper)
        void cacheJson('chatShared:' + [user.id, otherUser.id].sort().join(':'), { wallpaper })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_poll_votes' }, payload => {
        const vote = payload.new as { poll_id: string; user_id: string; option_id: string }
        setMessages(prev => prev.map(message => {
          const raw = message.chat_poll
          const poll = Array.isArray(raw) ? raw[0] : raw
          if (message.message_type !== 'poll' || !poll || poll.id !== vote.poll_id) return message
          return { ...message, chat_poll: { ...poll, chat_poll_votes: [...(poll.chat_poll_votes || []).filter(v => v.user_id !== vote.user_id), { user_id: vote.user_id, option_id: vote.option_id }] } }
        }))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_poll_votes' }, payload => {
        const vote = payload.new as { poll_id: string; user_id: string; option_id: string }
        setMessages(prev => prev.map(message => {
          const raw = message.chat_poll
          const poll = Array.isArray(raw) ? raw[0] : raw
          if (message.message_type !== 'poll' || !poll || poll.id !== vote.poll_id) return message
          return { ...message, chat_poll: { ...poll, chat_poll_votes: [...(poll.chat_poll_votes || []).filter(v => v.user_id !== vote.user_id), { user_id: vote.user_id, option_id: vote.option_id }] } }
        }))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const row = payload.new as Message
        if (row.message_type === 'poll' && row.sender_id === otherUser.id) void loadMessages(false)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, payload => {
        const row = payload.new as { id: string; message_id: string; user_id: string; emoji: string; created_at: string }
        setMessages(prev => {
          if (!prev.some(m => m.id === row.message_id)) return prev
          return prev.map(m => m.id !== row.message_id ? m : {
            ...m,
            message_reactions: [...(m.message_reactions || []).filter(reaction => reaction.id !== row.id && reaction.user_id !== row.user_id), row],
          })
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, payload => {
        const row = payload.new as { id: string; message_id: string; user_id: string; emoji: string; created_at: string }
        setMessages(prev => prev.map(m => m.id !== row.message_id ? m : {
          ...m,
          message_reactions: [...(m.message_reactions || []).filter(reaction => reaction.id !== row.id && reaction.user_id !== row.user_id), row],
        }))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, payload => {
        const row = payload.old as { id?: string; message_id?: string }
        if (!row.id) return
        setMessages(prev => prev.map(m => !m.message_reactions?.some(reaction => reaction.id === row.id) ? m : {
          ...m,
          message_reactions: m.message_reactions.filter(reaction => reaction.id !== row.id),
        }))
      })
      .subscribe()
    const onOnline = () => { void loadMessages(false); void loadSharedSettings(otherUser.id) }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void loadMessages(false)
        void loadSharedSettings(otherUser.id)
      }
    }
    const onSyncComplete = () => { void loadMessages(false); void loadSharedSettings(otherUser.id) }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('yomy-sync-complete', onSyncComplete)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('yomy-sync-complete', onSyncComplete)
      void supabase.removeChannel(channel)
    }
  }, [loadMessages, loadSharedSettings, online, otherUser, user])

  useEffect(() => { window.setTimeout(() => scrollToBottom(false), 0) }, [messages.length, scrollToBottom])
  useEffect(() => () => {
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl)
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
  }, [pendingMedia])

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach(track => track.stop())
      if (cameraTimerRef.current) window.clearInterval(cameraTimerRef.current)
    }
  }, [cameraStream])

  useEffect(() => {
    const video = cameraVideoRef.current
    if (!video || !cameraStream) return
    video.srcObject = cameraStream
    void video.play().catch(() => undefined)
  }, [cameraStream, cameraOpen])

  const savePreference = async (patch: Partial<ChatPreference>) => {
    if (!user || !otherUser) return
    const base = preference || fallbackPreference(user.id, otherUser.id)
    const next = { ...base, ...patch }
    setPreference(next)
    await cacheJson('chatPref:' + user.id + ':' + otherUser.id, next)
    await patchCachedConversation(user.id, otherUser.id, {
      archived: next.archived,
      muted: next.muted,
    })

    if ('wallpaper' in patch && patch.wallpaper) {
      setSharedWallpaper(patch.wallpaper)
      await cacheJson('chatShared:' + [user.id, otherUser.id].sort().join(':'), { wallpaper: patch.wallpaper })
    }

    const personalPatch: { archived?: boolean; muted?: boolean; bubble_theme?: string } = {}
    if (typeof patch.archived === 'boolean') personalPatch.archived = patch.archived
    if (typeof patch.muted === 'boolean') personalPatch.muted = patch.muted
    if (patch.bubble_theme) personalPatch.bubble_theme = patch.bubble_theme

    if (!online) {
      if (Object.keys(personalPatch).length) {
        await queueSyncOperation({
          opId: crypto.randomUUID(),
          userId: user.id,
          kind: 'chat_personal',
          createdAt: new Date().toISOString(),
          payload: { otherUserId: otherUser.id, patch: personalPatch },
        })
      }
      if ('wallpaper' in patch && patch.wallpaper) {
        await queueSyncOperation({
          opId: crypto.randomUUID(),
          userId: user.id,
          kind: 'chat_shared',
          createdAt: new Date().toISOString(),
          payload: { otherUserId: otherUser.id, wallpaper: patch.wallpaper },
        })
      }
      window.dispatchEvent(new CustomEvent('yomy-chat-settings-changed', { detail: { otherUserId: otherUser.id, patch } }))
      toast.success('Saved on this device • will sync when you reconnect')
      return
    }

    if (Object.keys(personalPatch).length) {
      const { error } = await supabase.from('chat_preferences').upsert(
        { user_id: user.id, other_user_id: otherUser.id, ...personalPatch },
        { onConflict: 'user_id,other_user_id' },
      )
      if (error) toast.error(error.message)
    }

    if ('muted' in personalPatch) {
      if (next.muted) await supabase.from('muted_chats').upsert({ user_id: user.id, muted_user_id: otherUser.id })
      else await supabase.from('muted_chats').delete().eq('user_id', user.id).eq('muted_user_id', otherUser.id)
    }

    if ('wallpaper' in patch && patch.wallpaper) {
      const pair = sharedChatKey(user.id, otherUser.id)
      const { error } = await supabase.from('chat_shared_settings').upsert(
        { ...pair, wallpaper: patch.wallpaper, updated_by: user.id },
        { onConflict: 'user_low,user_high' },
      )
      if (error) toast.error(error.message)
    }

    window.dispatchEvent(new CustomEvent('yomy-chat-settings-changed', { detail: { otherUserId: otherUser.id, patch } }))
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
    if (!user || messageId.startsWith('local:') || !otherUser) return
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return

    const existing = msg.message_reactions?.find(r => r.user_id === user.id)
    const mode = existing?.emoji === emoji ? 'clear' : 'set'
    const nextReactions = (msg.message_reactions || [])
      .filter(r => r.user_id !== user.id)
      .concat(mode === 'set'
        ? [{ id: existing?.id || 'local-reaction:' + crypto.randomUUID(), message_id: messageId, user_id: user.id, emoji, created_at: new Date().toISOString() }]
        : [])

    const nextMessages = messages.map(item => item.id === messageId ? { ...item, message_reactions: nextReactions } : item)
    setMessages(nextMessages)
    setReactionFor(null)
    await cacheMessages(user.id, otherUser.id, nextMessages)

    if (!online) {
      await queueSyncOperation({
        opId: crypto.randomUUID(),
        userId: user.id,
        kind: 'reaction_set',
        createdAt: new Date().toISOString(),
        payload: { messageId, mode, emoji },
      })
      return
    }

    const result = mode === 'clear'
      ? await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', user.id)
      : await supabase.from('message_reactions').upsert(
        { message_id: messageId, user_id: user.id, emoji },
        { onConflict: 'message_id,user_id' },
      )

    if (result.error) {
      toast.error(result.error.message)
      await loadMessages(false)
      return
    }
    await loadMessages(false)
  }

  const loadStickers = useCallback(async () => {
    if (!user || !online || stickersLoading) return
    setStickersLoading(true)
    try {
      const { data } = await supabase.from('chat_stickers').select('id,name,bucket,storage_path').eq('user_id', user.id).order('created_at', { ascending: false }).limit(32)
      const urls = await Promise.all((data || []).map(async sticker => {
        const { data: signed } = await supabase.storage.from(String(sticker.bucket || 'chat-stickers')).createSignedUrl(String(sticker.storage_path), 3600)
        return signed?.signedUrl ? { id: sticker.id, name: sticker.name, url: signed.signedUrl } : null
      }))
      setStickers(urls.filter(Boolean) as Array<{ id: string; url: string; name: string }>)
    } finally { setStickersLoading(false) }
  }, [online, stickersLoading, user])

  const saveImageAsSticker = async (message: Message) => {
    if (!user || !online || message.media_type !== 'image' || message.view_once) return
    const url = mediaUrls[message.id] || message.media_url
    if (!url) return
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error('Image unavailable')
      const blob = await response.blob()
      const stickerPath = user.id + '/' + crypto.randomUUID() + '.png'
      const { error: uploadError } = await supabase.storage.from('chat-stickers').upload(stickerPath, blob, { upsert: false, contentType: 'image/png', cacheControl: '31536000' })
      if (uploadError) throw uploadError
      const { error } = await supabase.from('chat_stickers').insert({ user_id: user.id, name: 'My sticker', bucket: 'chat-stickers', storage_path: stickerPath })
      if (error) { await supabase.storage.from('chat-stickers').remove([stickerPath]); throw error }
      await loadStickers()
      toast.success('Saved as a private sticker')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save sticker') }
  }

  const sendStickerFile = async (file: File) => {
    if (!user || !otherUser || !online || sending) return
    setSending(true)
    try {
      const mime = file.type || 'image/png'
      const ext = mime.includes('svg') ? 'svg' : 'png'
      const mediaPath = 'images/' + user.id + '/' + crypto.randomUUID() + '.' + ext
      const { error: uploadError } = await supabase.storage.from('messages-private').upload(mediaPath, file, { upsert: false, contentType: mime, cacheControl: '31536000' })
      if (uploadError) throw uploadError
      const { data, error } = await supabase.from('messages').insert({
        sender_id: user.id, receiver_id: otherUser.id, content: '', media_url: '', media_type: 'image',
        media_bucket: 'messages-private', media_path: mediaPath, is_encrypted: true,
        view_once: false, view_once_limit: 0, view_once_open_count: 0, view_once_opened: false,
        client_message_id: crypto.randomUUID(), reply_to_id: null, created_at: new Date().toISOString(),
      }).select('*').single()
      if (error) { await supabase.storage.from('messages-private').remove([mediaPath]); throw error }
      const next = [...messages, data as Message]
      setMessages(next)
      await cacheMessages(user.id, otherUser.id, next)
      void sendPushEvent({ type: 'message', targetUserId: otherUser.id, title: user.user_metadata?.username || 'Yomy', body: '✨ Sticker', data: { message_id: data.id, url: '/messages/' + otherUser.username } })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Sticker failed') }
    finally { setSending(false) }
  }

  const uploadMedia = async (file: File, kind: 'image' | 'video' | 'file') => {
    if (!user || !otherUser) return
    if (!online) {
      toast.error('Media waits for a connection. Text messages still work offline.')
      return
    }
    const folder = kind === 'video' ? 'videos/' : kind === 'file' ? 'files/' : 'images/'
    const path = folder + user.id + '/' + crypto.randomUUID() + '.' + (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : kind === 'file' ? 'bin' : 'jpg'))
    const clientMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const { error: uploadError } = await supabase.storage.from('messages-private').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (uploadError) return toast.error(uploadError.message)

    const { data, error } = await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: otherUser.id,
      content: kind === 'file' ? (input.trim() || file.name) : input.trim(),
      media_url: '',
      media_type: kind,
      media_bucket: 'messages-private',
      media_path: path,
      is_encrypted: true,
      view_once: kind !== 'file' && pendingViewOnceLimit > 0,
      view_once_limit: kind === 'file' ? 0 : pendingViewOnceLimit,
      view_once_open_count: 0,
      view_once_opened: false,
      client_message_id: clientMessageId,
      reply_to_id: replyTo?.id || null,
      created_at: createdAt,
    }).select('*').single()
    if (error) {
      await supabase.storage.from('messages-private').remove([path])
      return toast.error(error.message)
    }
    setMessages(prev => [...prev, data as Message])
    setInput('')
    setReplyTo(null)
    setPendingViewOnceLimit(0)
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl)
    setPendingMedia(null)
    void sendPushEvent({
      type: 'message',
      targetUserId: otherUser.id,
      title: user.user_metadata?.username || 'Yomy',
      body: kind === 'video' ? '🎬 Video' : kind === 'file' ? '📎 ' + file.name : '📷 Photo',
      data: { message_id: data.id, url: '/messages/' + otherUser.username },
    })
  }

  const uploadVoice = async (file: File) => {
    if (!user || !otherUser || !online) return
    const path = 'audio/' + user.id + '/' + crypto.randomUUID() + '.' + (file.name.split('.').pop() || 'webm')
    const clientMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const { error: uploadError } = await supabase.storage.from('messages-private').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (uploadError) return toast.error(uploadError.message)

    const { data, error } = await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: otherUser.id,
      content: '',
      media_url: '',
      media_type: 'audio',
      media_bucket: 'messages-private',
      media_path: path,
      is_encrypted: true,
      view_once: false,
      view_once_limit: 0,
      view_once_open_count: 0,
      view_once_opened: false,
      client_message_id: clientMessageId,
      reply_to_id: replyTo?.id || null,
      created_at: createdAt,
    }).select('*').single()
    if (error) {
      await supabase.storage.from('messages-private').remove([path])
      return toast.error(error.message)
    }
    setMessages(prev => [...prev, data as Message])
    setReplyTo(null)
    void sendPushEvent({
      type: 'message',
      targetUserId: otherUser.id,
      title: user.user_metadata?.username || 'Yomy',
      body: '🎙️ Voice message',
      data: { message_id: data.id, url: '/messages/' + otherUser.username },
    })
  }

  const stopCamera = useCallback(() => {
    cameraRecorderRef.current?.stop()
    cameraRecorderRef.current = null
    cameraStream?.getTracks().forEach(track => track.stop())
    setCameraStream(null)
    setCameraRecording(false)
    setCameraSeconds(0)
    if (cameraTimerRef.current) window.clearInterval(cameraTimerRef.current)
    cameraTimerRef.current = null
  }, [cameraStream])

  const startCameraStream = useCallback(async (facing: 'environment' | 'user', mode: 'photo' | 'video') => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera is not supported on this device')
      return false
    }
    cameraStream?.getTracks().forEach(track => track.stop())
    try {
      const constraints: MediaStreamConstraints = {
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (error) {
        if (mode === 'video') {
          stream = await navigator.mediaDevices.getUserMedia({ video: constraints.video })
          toast.info('Microphone unavailable — video will be sent without audio')
        } else {
          throw error
        }
      }
      setCameraStream(stream)
      setCameraFacing(facing)
      setCameraMode(mode)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not access camera')
      return false
    }
  }, [cameraStream])

  const openCamera = async () => {
    if (!online || !!pendingMedia) return
    const ok = await startCameraStream(cameraFacing, cameraMode)
    if (ok) setCameraOpen(true)
  }

  const flipCamera = async () => {
    if (cameraRecording) return
    const next = cameraFacing === 'environment' ? 'user' : 'environment'
    await startCameraStream(next, cameraMode)
  }

  const changeCameraMode = async (mode: 'photo' | 'video') => {
    if (cameraRecording || mode === cameraMode) return
    await startCameraStream(cameraFacing, mode)
  }

  const capturePhoto = () => {
    const video = cameraVideoRef.current
    if (!video || !cameraStream || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('Camera is not ready yet')
      return
    }
    setCameraFlash(true)
    window.setTimeout(() => setCameraFlash(false), 110)
    const canvas = document.createElement('canvas')
    const maxWidth = 1440
    const scale = Math.min(1, maxWidth / Math.max(video.videoWidth, 1))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (cameraFacing === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!blob) return toast.error('Could not capture the photo')
      const file = new File([blob], 'camera-photo-' + Date.now() + '.jpg', { type: 'image/jpeg' })
      setPendingMedia({ file, kind: 'image', previewUrl: URL.createObjectURL(file) })
      stopCamera()
      setCameraOpen(false)
    }, 'image/jpeg', 0.86)
  }

  const toggleCameraRecording = () => {
    if (!cameraStream) return
    if (cameraRecording) {
      cameraRecorderRef.current?.stop()
      return
    }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
    try {
      const recorder = mimeType
        ? new MediaRecorder(cameraStream, { mimeType, videoBitsPerSecond: 5_000_000 })
        : new MediaRecorder(cameraStream)
      cameraRecorderRef.current = recorder
      cameraChunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) cameraChunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const blob = new Blob(cameraChunksRef.current, { type: recorder.mimeType || 'video/webm' })
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
        const file = new File([blob], 'camera-video-' + Date.now() + '.' + ext, { type: blob.type })
        cameraRecorderRef.current = null
        setCameraRecording(false)
        setCameraSeconds(0)
        if (cameraTimerRef.current) window.clearInterval(cameraTimerRef.current)
        cameraTimerRef.current = null
        if (blob.size) {
          setPendingMedia({ file, kind: 'video', previewUrl: URL.createObjectURL(file) })
          stopCamera()
          setCameraOpen(false)
        } else {
          toast.error('Could not record the video')
        }
      }
      recorder.start(200)
      setCameraRecording(true)
      setCameraSeconds(0)
      cameraTimerRef.current = window.setInterval(() => setCameraSeconds(value => value + 1), 1000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start video recording')
    }
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
      view_once_limit: 0,
      view_once_open_count: 0,
      view_once_opened_at: null,
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
    await patchCachedConversation(user.id, otherUser.id, {
      user: otherUser,
      lastMessage: temp,
      unreadCount: 0,
      archived: preference?.archived || false,
      muted: preference?.muted || false,
    })
    setInput('')
    setReplyTo(null)
    await cacheMessages(user.id, otherUser.id, nextLocal)

    if (!online) {
      await queueMessage({ clientMessageId, userId: user.id, otherUserId: otherUser.id, content, replyToId: replyId, createdAt })
      toast.success('Saved offline · will send automatically')
      return
    }

    setSending(true)
    const { data, error } = await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: otherUser.id,
      content,
      media_url: '',
      media_type: '',
      media_bucket: 'messages-private',
      media_path: null,
      is_encrypted: true,
      view_once: false,
      view_once_limit: 0,
      view_once_open_count: 0,
      view_once_opened: false,
      client_message_id: clientMessageId,
      reply_to_id: replyId,
      created_at: createdAt,
    }).select('*').single()
    if (!error && data) {
      const replaced = nextLocal.map(m => m.id === temp.id ? data as Message : m)
      setMessages(replaced)
      await cacheMessages(user.id, otherUser.id, replaced)
      await patchCachedConversation(user.id, otherUser.id, {
        user: otherUser,
        lastMessage: data as Message,
        unreadCount: 0,
        archived: preference?.archived || false,
        muted: preference?.muted || false,
      })
      void sendPushEvent({ type: 'message', targetUserId: otherUser.id, title: user.user_metadata?.username || 'Yomy', body: content, data: { message_id: data.id, url: '/messages/' + otherUser.username } })
    } else if (isTransientSendError(error)) {
      await queueMessage({ clientMessageId, userId: user.id, otherUserId: otherUser.id, content, replyToId: replyId, createdAt })
      window.dispatchEvent(new CustomEvent('yomy-sync-queued'))
    } else {
      setMessages(prev => prev.filter(message => message.id !== temp.id))
      await cacheMessages(user.id, otherUser.id, nextLocal.filter(message => message.id !== temp.id))
      toast.error('Message was not sent: ' + (error?.message || 'Unknown server error'))
    }
    setSending(false)
  }

  const votePoll = async (pollId: string, optionId: string) => {
    if (!user || !online || sending) return
    const { error } = await supabase.from('chat_poll_votes').upsert(
      { poll_id: pollId, user_id: user.id, option_id: optionId },
      { onConflict: 'poll_id,user_id' }
    )
    if (error) return toast.error(error.message)
    setMessages(prev => prev.map(message => {
      const raw = message.chat_poll
      const poll = Array.isArray(raw) ? raw[0] : raw
      if (message.message_type !== 'poll' || !poll || poll.id !== pollId) return message
      return {
        ...message,
        chat_poll: { ...poll, chat_poll_votes: [...(poll.chat_poll_votes || []).filter(v => v.user_id !== user.id), { user_id: user.id, option_id: optionId }] }
      }
    }))
  }

  const createPoll = async () => {
    if (!user || !otherUser || !online || sending) return
    if (peerSleeping) { toast.error('This chat is in sleep mode right now'); return }
    const question = pollQuestion.trim()
    const options = pollOptions.map(value => value.trim()).filter(Boolean)
    if (!question) return toast.error('Write a question first')
    if (options.length < 2) return toast.error('Add at least two choices')
    if (options.length > 6) return toast.error('Up to six choices are supported')
    setSending(true)
    try {
      const createdAt = new Date().toISOString()
      const { data: message, error: messageError } = await supabase.from('messages').insert({
        sender_id: user.id, receiver_id: otherUser.id, content: '', media_url: '', media_type: '',
        media_bucket: 'messages', media_path: null, message_type: 'poll',
        is_encrypted: true, view_once: false, view_once_limit: 0, view_once_open_count: 0,
        view_once_opened: false, client_message_id: crypto.randomUUID(), reply_to_id: replyTo?.id || null,
        created_at: createdAt,
      }).select('*').single()
      if (messageError || !message) { if (peerSleeping) throw new Error('This chat is in sleep mode right now.'); throw messageError || new Error('Could not create poll') }
      const { data: poll, error: pollError } = await supabase.from('chat_polls').insert({ message_id: message.id, question }).select('*').single()
      if (pollError || !poll) {
        await supabase.from('messages').delete().eq('id', message.id)
        throw pollError || new Error('Could not create poll')
      }
      const { error: optionError } = await supabase.from('chat_poll_options').insert(options.map((label, option_index) => ({ poll_id: poll.id, label, option_index })))
      if (optionError) {
        await supabase.from('messages').delete().eq('id', message.id)
        throw optionError
      }
      setPollOpen(false); setPollQuestion(''); setPollOptions(['', '']); setReplyTo(null)
      await loadMessages(false)
      void sendPushEvent({ type: 'message', targetUserId: otherUser.id, title: user.user_metadata?.username || 'Yomy', body: '📊 New poll', data: { message_id: message.id, url: '/messages/' + otherUser.username } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send poll')
    } finally { setSending(false) }
  }

  useEffect(() => {
    if (!online || !user || !messages.length) return
    const candidates = messages
      .filter(message => message.media_type && !message.view_once && !mediaUrls[message.id] && !resolvingMediaRef.current.has(message.id))
      .slice(-16)
    if (!candidates.length) return
    let cancelled = false

    void Promise.all(candidates.map(async message => {
      resolvingMediaRef.current.add(message.id)
      try {
        if (message.media_url && message.media_bucket !== 'messages-private') {
          if (!cancelled) setMediaUrls(current => ({ ...current, [message.id]: message.media_url }))
          return
        }
        const { data, error } = await supabase.functions.invoke('message-media-url', {
          body: { message_id: message.id, expires_in: 3600 },
        })
        if (!cancelled && !error && data?.url) {
          setMediaUrls(current => ({ ...current, [message.id]: String(data.url) }))
        }
      } finally {
        resolvingMediaRef.current.delete(message.id)
      }
    }))

    return () => { cancelled = true }
  }, [messages, online, user])

  const openViewOnce = async (message: Message) => {
    if (!message.media_path || !user || !online) {
      if (!online) toast.error('Connect to the internet to open protected media')
      return
    }
    if (openingViewOnceRef.current.has(message.id)) return
    openingViewOnceRef.current.add(message.id)
    try {
      const { data, error } = await supabase.functions.invoke('message-media-url', {
        body: { message_id: message.id, expires_in: 90, consume_view_once: true },
      })
      if (error || data?.ok === false || !data?.url) {
        toast.error(String(data?.error || error?.message || 'Media is no longer available'))
        return
      }
      const limit = Number(data.view_once_limit || message.view_once_limit || 1)
      const used = Number(data.view_once_open_count || message.view_once_open_count || 0)
      setMessages(prev => prev.map(item => item.id === message.id
        ? { ...item, view_once: true, view_once_limit: (limit === 1 || limit === 2 ? limit : 1) as 0 | 1 | 2, view_once_open_count: used, view_once_opened: true, view_once_opened_at: data.view_once_opened_at || item.view_once_opened_at || null }
        : item))
      setViewOnceMessageId(message.id)
      setViewOnceRemaining(Math.max(0, limit - used))
      setViewOnceUrl(String(data.url))
    } finally {
      openingViewOnceRef.current.delete(message.id)
    }
  }

  const pendingCount = messages.filter(message => message.id.startsWith('local:')).length
  const pref = preference || (user && otherUser ? fallbackPreference(user.id, otherUser.id) : null)
  const peerSleeping = useMemo(() => {
    if (!otherUser?.sleep_mode_enabled) return false
    try {
      const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: otherUser.timezone_name || 'UTC' }).format(new Date())
      const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
      const start = Number((otherUser.sleep_start || '22:00').slice(0, 2)) * 60 + Number((otherUser.sleep_start || '22:00').slice(3, 5))
      const end = Number((otherUser.sleep_end || '05:00').slice(0, 2)) * 60 + Number((otherUser.sleep_end || '05:00').slice(3, 5))
      return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
    } catch { return false }
  }, [otherUser])
  const myBubble = pref ? bubbleClasses[pref.bubble_theme] : bubbleClasses.default

  const wallpaperBackground = useMemo(() => {
    if (sharedWallpaper === 'default') return ''
    if (sharedWallpaper === 'midnight') return 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950'
    if (sharedWallpaper === 'paper') return 'bg-[linear-gradient(rgba(127,127,127,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(127,127,127,.06)_1px,transparent_1px)] bg-[size:28px_28px]'
    if (sharedWallpaper === 'roses') return 'bg-rose-50/40 dark:bg-rose-950/15'
    return 'bg-muted/25'
  }, [sharedWallpaper])

  if (!otherUser) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-7" /></div>

  return (
    <div className="yomy-chat-shell h-[100dvh] flex flex-col bg-background overflow-hidden">
      <header className="h-16 shrink-0 border-b border-border/45 yomy-glass-bar flex items-center gap-1 px-2 shadow-[0_8px_30px_rgba(0,0,0,.06)]">
        <Button variant="ghost" size="icon" className="size-10 rounded-full" onClick={() => navigate(-1)}><ChevronLeft className="size-5" /></Button>
        <Link to={'/profile/' + otherUser.username} className="flex items-center gap-2 min-w-0 flex-1">
          <div className="relative">
            <Avatar className="size-10"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback>{initials(otherUser)}</AvatarFallback></Avatar>
            {online && !peerSleeping && <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm truncate">{otherUser.username}</p>
              {otherUser.is_verified && <ShieldCheck className="size-3.5 text-sky-500 shrink-0" />}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{peerSleeping ? 'Sleep mode' : online ? 'Online · synced' : 'Offline · device snapshot'}</p>
          </div>
        </Link>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" disabled={!online} onClick={() => void startCall({ id: otherUser.id, username: otherUser.username, full_name: otherUser.full_name, avatar_url: otherUser.avatar_url }, 'voice')} aria-label="Voice call"><Phone className="size-5" /></Button>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" disabled={!online} onClick={() => void startCall({ id: otherUser.id, username: otherUser.username, full_name: otherUser.full_name, avatar_url: otherUser.avatar_url }, 'video')} aria-label="Video call"><Video className="size-5" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Chat options"><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 rounded-2xl p-1.5">
            <DropdownMenuItem onClick={() => navigate('/profile/' + otherUser.username)}><UserRound className="size-4 mr-2" />Open profile</DropdownMenuItem>
            <DropdownMenuItem onClick={async () => { const nextArchived = !pref?.archived; await savePreference({ archived: nextArchived }); if (nextArchived) navigate('/messages') }}><Archive className="size-4 mr-2" />{pref?.archived ? 'Remove from archive' : 'Move to archive'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void savePreference({ muted: !pref?.muted })}><BellOff className="size-4 mr-2" />{pref?.muted ? 'Unmute notifications' : 'Mute notifications'}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setDraftTheme(sharedWallpaper); setDraftBubble(pref?.bubble_theme || 'default'); setSettingsOpen(true) }}><Palette className="size-4 mr-2" />Wallpaper & message colors</DropdownMenuItem>
            <DropdownMenuItem onClick={() => scrollToBottom(true)}>Jump to latest</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

{!online && <div className="shrink-0 px-3 py-1.5 bg-amber-500/8 border-b border-amber-500/15 text-[11px] flex items-center gap-2"><WifiOff className="size-3.5 text-amber-600" /><span>Offline snapshot · messages stay here until connection returns.</span>{pendingCount > 0 && <span className="ml-auto rounded-full bg-amber-500/12 px-2 py-0.5 font-semibold">{pendingCount} waiting</span>}</div>}

      <div className={'relative flex-1 overflow-hidden ' + wallpaperBackground}>
        <Wallpaper type={sharedWallpaper} />
        <div ref={scrollRef} className="relative h-full overflow-y-auto px-3 py-4 space-y-2 yomy-chat-scroll">
          {loading ? <div className="h-full flex items-center justify-center"><Spinner className="size-6" /></div> : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-3"><Heart className="size-7" /></div>
              <p className="font-medium">Say hello 👋</p><p className="text-xs mt-1">This conversation is ready.</p>
            </div>
          ) : messages.map(message => {
            const mine = message.sender_id === user?.id
            const queued = message.id.startsWith('local:')
            const rawPoll = message.chat_poll
            const poll = Array.isArray(rawPoll) ? rawPoll[0] : rawPoll
            const reactionSummary = message.message_reactions?.reduce<Record<string, number>>((acc, item) => { acc[item.emoji] = (acc[item.emoji] || 0) + 1; return acc }, {})
            return (
              <div key={message.id} id={'message-' + message.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start') + ' group'}>
                <div className="max-w-[78%] sm:max-w-[66%] flex flex-col">
                  <div className={'rounded-[1.3rem] px-3 py-1.5 shadow-sm border border-black/5 ' + (mine ? myBubble + ' rounded-br-md' : 'bg-card text-foreground rounded-bl-md border-border')}>
                    {message.reply_to && !message.deleted_for_everyone && (
                      <button onClick={() => document.getElementById('message-' + message.reply_to_id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={'w-full text-left mb-2 rounded-lg px-2.5 py-1.5 text-[11px] ' + (mine ? 'bg-white/15' : 'bg-muted')}>
                        <span className="font-semibold block">{message.reply_to.sender_id === user?.id ? 'You' : otherUser.username}</span>
                        <span className="truncate block opacity-75">{message.reply_to.content || 'Attachment'}</span>
                      </button>
                    )}
                    {message.deleted_for_everyone ? <p className="text-xs italic opacity-60">Message deleted</p> : (
                      <>
                        {message.message_type === 'poll' && poll && <div className="w-[min(19rem,78vw)] rounded-[1.15rem] border border-white/10 bg-background/55 p-3 shadow-inner">
                          <div className="flex items-start gap-2.5 mb-3">
                            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-4" /></span>
                            <div className="min-w-0 flex-1"><p className="font-semibold text-sm leading-5">{poll.question}</p><p className="text-[10px] text-muted-foreground mt-0.5">Poll</p></div>
                          </div>
                          <div className="space-y-2">{(poll.chat_poll_options || []).slice().sort((a,b) => a.option_index - b.option_index).map(option => {
                            const votes = poll.chat_poll_votes || []
                            const count = votes.filter(v => v.option_id === option.id).length
                            const selected = votes.some(v => v.user_id === user?.id && v.option_id === option.id)
                            const total = votes.length
                            const width = total ? Math.max(8, Math.round((count / total) * 100)) : 0
                            return <button key={option.id} type="button" onClick={() => void votePoll(poll.id, option.id)} className="relative w-full overflow-hidden rounded-xl border border-border/60 px-3 py-2.5 text-left transition-all active:scale-[.985] hover:border-primary/35">
                              <span className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: width + '%' }} />
                              <span className="relative flex items-center gap-2"><span className={'grid size-4 place-items-center rounded-full border shrink-0 ' + (selected ? 'border-primary bg-primary' : 'border-muted-foreground/40')}>{selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}</span><span className="flex-1 text-sm truncate">{option.label}</span><span className="text-[10px] text-muted-foreground">{count}</span></span>
                            </button>
                          })}</div>
                          <p className="text-[10px] text-muted-foreground mt-2">{(poll.chat_poll_votes || []).length} vote{(poll.chat_poll_votes || []).length === 1 ? '' : 's'}</p>
                        </div>}
                        {message.media_type === 'image' && message.view_once && !message.deleted_for_everyone && <button disabled={message.sender_id === user?.id || message.view_once_open_count >= (message.view_once_limit || 1)} onClick={() => void openViewOnce(message)} className="w-[min(18rem,76vw)] h-24 rounded-2xl border border-white/10 bg-black/10 dark:bg-white/5 flex items-center gap-3 px-4 text-left shadow-inner disabled:opacity-55"><Eye className="size-5 shrink-0" /><span><b className="block text-sm">{message.sender_id === user?.id ? 'Sent media' : message.view_once_open_count >= (message.view_once_limit || 1) ? 'Media expired' : 'View photo'}</b><small className="opacity-70">{message.sender_id === user?.id ? ((message.view_once_limit || 1) + '× mode') : Math.max(0, (message.view_once_limit || 1) - message.view_once_open_count) + ' view(s) left'}</small></span></button>}
                        {message.media_type === 'video' && message.view_once && !message.deleted_for_everyone && <button disabled={message.sender_id === user?.id || message.view_once_open_count >= (message.view_once_limit || 1)} onClick={() => void openViewOnce(message)} className="w-56 h-28 rounded-2xl border border-white/10 bg-black/10 dark:bg-white/5 flex items-center gap-3 px-4 text-left shadow-inner disabled:opacity-55"><Video className="size-5 shrink-0" /><span><b className="block text-sm">{message.sender_id === user?.id ? 'Sent media' : message.view_once_open_count >= (message.view_once_limit || 1) ? 'Media expired' : 'View video'}</b><small className="opacity-70">{message.sender_id === user?.id ? ((message.view_once_limit || 1) + '× mode') : Math.max(0, (message.view_once_limit || 1) - message.view_once_open_count) + ' view(s) left'}</small></span></button>}
                        {message.media_type === 'image' && !message.view_once && (mediaUrls[message.id] || message.media_url) && <button onPointerDown={() => { longPressTriggeredRef.current = false; if (longPressRef.current) window.clearTimeout(longPressRef.current); longPressRef.current = window.setTimeout(() => { longPressRef.current = null; longPressTriggeredRef.current = true; void saveImageAsSticker(message) }, 650) }} onPointerUp={() => { if (longPressRef.current) window.clearTimeout(longPressRef.current); longPressRef.current = null }} onPointerCancel={() => { if (longPressRef.current) window.clearTimeout(longPressRef.current); longPressRef.current = null }} onClick={() => { if (longPressTriggeredRef.current) { longPressTriggeredRef.current = false; return }; setViewOnceUrl(mediaUrls[message.id] || message.media_url) }} className="block"><img src={mediaUrls[message.id] || message.media_url} alt="" className="rounded-[1.15rem] max-h-64 max-w-[min(18rem,76vw)] object-cover aspect-[4/3] mb-1.5 shadow-[0_8px_30px_rgba(0,0,0,.10)]" loading="lazy" /></button>}
                        {message.media_type === 'video' && !message.view_once && (mediaUrls[message.id] || message.media_url) && <video src={mediaUrls[message.id] || message.media_url} controls playsInline preload="metadata" className="rounded-xl max-h-64 max-w-[min(18rem,76vw)] mb-1.5" />}
                        {message.media_type === 'audio' && (mediaUrls[message.id] || message.media_url) && <audio src={mediaUrls[message.id] || message.media_url} controls className="w-full min-w-48 h-9 mb-1.5" />}
                        {message.media_type === 'file' && (mediaUrls[message.id] || message.media_url) && <a href={mediaUrls[message.id] || message.media_url} target="_blank" rel="noreferrer" download className="flex items-center gap-3 w-[min(20rem,80vw)] rounded-[1.05rem] border border-border/60 bg-background/45 px-3 py-3 hover:bg-background/65 transition-colors"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary shrink-0"><FileText className="size-5" /></span><span className="min-w-0 flex-1"><b className="block text-sm truncate">{message.content || 'Attachment'}</b><small className="text-[10px] text-muted-foreground">Open or save file</small></span></a>}
                        {!message.media_url && message.media_type && !mediaUrls[message.id] && <div className="h-24 w-52 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse mb-1.5" />}
                        {message.content && <p className="text-[14px] whitespace-pre-wrap break-words leading-[1.45]">{renderMessageText(message.content)}</p>}
                        {message.content && firstUrl(message.content) && <LinkPreviewCard url={firstUrl(message.content)} />}
                        {message.view_once && message.media_type && <p className="text-[11px] mt-1 opacity-75 flex items-center gap-1"><Eye className="size-3" />{message.view_once_limit === 2 ? 'View twice' : 'View once'}</p>}
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
                  {!queued && !message.deleted_for_everyone && <div className="mt-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => { setReactionFor(message.id); setEmojiOpen(true) }}><Smile className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(message)}><Reply className="size-4" /></Button>
                    {mine && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void copyMessage(message)}><Copy className="size-4 mr-2" />Copy</DropdownMenuItem>{message.media_type === '' && <DropdownMenuItem onClick={() => { setEditing(message); setInput(message.content) }}><Pencil className="size-4 mr-2" />Edit</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem onClick={() => void deleteForEveryone(message)} className="text-destructive focus:text-destructive"><Trash2 className="size-4 mr-2" />Delete for everyone</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
                  </div>}
                </div>
              </div>
            )
          })}
          <div className="h-3" />
        </div>
      </div>

      {pendingMedia && <div className="shrink-0 border-t bg-card/92 backdrop-blur-xl px-3 py-2.5">
        <div className="flex items-center gap-3">
          {pendingMedia.kind === 'image' ? <img src={pendingMedia.previewUrl} alt="" className="size-16 rounded-2xl object-cover shadow-sm" /> : pendingMedia.kind === 'video' ? <video src={pendingMedia.previewUrl} muted playsInline className="size-16 rounded-2xl object-cover shadow-sm" /> : <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary shadow-sm"><FileText className="size-7" /></div>}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{pendingMedia.kind === 'image' ? 'Photo ready' : pendingMedia.kind === 'video' ? 'Video ready' : 'File ready'}</p>
            <p className="text-xs text-muted-foreground truncate">Receiver access</p>
            <div className="mt-2 inline-flex rounded-xl border bg-muted/55 p-0.5 shadow-inner">
              {[{value:0,label:'Normal'},{value:1,label:'1×'},{value:2,label:'2×'}].map(option => <button key={option.value} type="button" onClick={() => setPendingViewOnceLimit(option.value as 0 | 1 | 2)} className={'px-3 py-1 rounded-[10px] text-[11px] font-semibold transition-all ' + (pendingViewOnceLimit === option.value ? 'bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-muted-foreground hover:text-foreground')}>{option.label}</button>)}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => { URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null); setPendingViewOnceLimit(0) }}><X className="size-5" /></Button>
          <Button size="sm" disabled={!online} className="rounded-full px-4" onClick={() => void uploadMedia(pendingMedia.file, pendingMedia.kind)}><Send className="size-4 mr-1" />Send</Button>
        </div>
      </div>}

      {replyTo && <div className="shrink-0 border-t bg-card px-4 py-2 flex items-center gap-3"><Reply className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">Replying to {replyTo.sender_id === user?.id ? 'yourself' : otherUser.username}</p><p className="text-xs text-muted-foreground truncate">{replyTo.content || 'Attachment'}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(null)}><X className="size-4" /></Button></div>}

      {editing && <div className="shrink-0 border-t bg-card px-4 py-2 flex items-center gap-3"><Pencil className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">Editing message</p><p className="text-xs text-muted-foreground truncate">{editing.content}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditing(null); setInput('') }}><X className="size-4" /></Button></div>}

      {recording && <div className="shrink-0 border-t bg-card px-4 py-3 flex items-center gap-3"><span className="size-2.5 rounded-full bg-destructive animate-pulse" /><span className="text-sm font-medium">Recording {String(Math.floor(recordingSeconds / 60)).padStart(2,'0')}:{String(recordingSeconds % 60).padStart(2,'0')}</span><div className="flex-1" /><Button size="icon" className="rounded-full" onClick={() => recorderRef.current?.stop()}><Check /></Button></div>}

      {!recording && <div className="relative shrink-0 border-t border-border/45 yomy-glass-bar p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {attachMenuOpen && <div className="absolute left-2 bottom-[calc(100%+.5rem)] z-40 w-[min(20rem,calc(100vw-1rem))] rounded-[1.35rem] border border-white/15 bg-background/78 p-2 shadow-[0_24px_70px_rgba(0,0,0,.2)] backdrop-blur-2xl ring-1 ring-black/5">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!online || !!pendingMedia} onClick={() => { setAttachMenuOpen(false); galleryRef.current?.click() }} className="yomy-attach-item"><span className="yomy-attach-icon"><ImagePlus className="size-5" /></span><span><b>Gallery</b><small>Photos & videos</small></span></button>
            <button type="button" disabled={!online || !!pendingMedia} onClick={() => { setAttachMenuOpen(false); void openCamera() }} className="yomy-attach-item"><span className="yomy-attach-icon"><Camera className="size-5" /></span><span><b>Camera</b><small>Take now</small></span></button>
            <button type="button" disabled={!online || !!pendingMedia} onClick={() => { setAttachMenuOpen(false); fileRef.current?.click() }} className="yomy-attach-item"><span className="yomy-attach-icon"><FileText className="size-5" /></span><span><b>Document</b><small>PDF, APK, ZIP & more</small></span></button>
            <button type="button" disabled={!online || !!pendingMedia} onClick={() => { setAttachMenuOpen(false); setDrawingOpen(true) }} className="yomy-attach-item"><span className="yomy-attach-icon"><PenLine className="size-5" /></span><span><b>Draw</b><small>Sketch & send</small></span></button>
            <button type="button" disabled={!online} onClick={() => { setAttachMenuOpen(false); setPollOpen(true) }} className="yomy-attach-item col-span-2"><span className="yomy-attach-icon"><BarChart3 className="size-5" /></span><span><b>Poll</b><small>Ask a question and let the chat vote</small></span></button>
          </div>
        </div>}
        <input ref={galleryRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const file=e.target.files?.[0]; if(file && online) setPendingMedia({ file, kind:file.type.startsWith('video/')?'video':'image', previewUrl:URL.createObjectURL(file) }); e.currentTarget.value='' }} />
        <input ref={fileRef} type="file" accept="*/*" className="hidden" onChange={e => { const file=e.target.files?.[0]; if(file && online) setPendingMedia({ file, kind:file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : 'file', previewUrl:URL.createObjectURL(file) }); e.currentTarget.value='' }} />
        <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={e => { const file=e.target.files?.[0]; if(file && online) setPendingMedia({ file, kind:file.type.startsWith('video/')?'video':'image', previewUrl:URL.createObjectURL(file) }); e.currentTarget.value='' }} />
        <div className="flex items-end gap-1.5">
          <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0 yomy-compose-button" disabled={!online || !!pendingMedia} onClick={() => setAttachMenuOpen(v => !v)} aria-label="More attachments" title="More"><Plus className="size-5 transition-transform" style={{ transform: attachMenuOpen ? 'rotate(45deg)' : undefined }} /></Button>
          <Button variant="ghost" size="icon" className={'size-10 rounded-full shrink-0 ' + (pendingViewOnceLimit > 0 ? 'bg-primary/10 text-primary ring-1 ring-primary/25' : '')} onClick={() => setViewOncePickerOpen(true)} aria-label="View once settings" title="View once">
            <Eye className="size-5" />{pendingViewOnceLimit > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-4">{pendingViewOnceLimit}×</span>}
          </Button>
          <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" disabled={!online || !!pendingMedia} onClick={() => void startVoice()} aria-label="Voice message"><Mic className="size-5" /></Button>
          <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" onClick={() => setEmojiOpen(true)} aria-label="Open emoji picker"><Smile className="size-5" /></Button>
          <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendText()} }} placeholder={editing ? 'Edit message…' : online ? 'Message' : 'Message offline…'} className="flex-1 rounded-[1.1rem] min-h-10 bg-background/55 border-white/10 shadow-inner" />
          <Button size="icon" className="size-10 rounded-full shrink-0 shadow-lg" disabled={!input.trim() || sending} onClick={() => void sendText()}>{editing ? <CheckCheck className="size-5" /> : <Send className="size-5" />}</Button>
        </div>
      </div>}

      {cameraOpen && <div className="fixed inset-0 z-[130] bg-black text-white flex flex-col overflow-hidden">
        <div className="absolute inset-0">
          <video ref={cameraVideoRef} muted playsInline className={'h-full w-full object-cover ' + (cameraFacing === 'user' ? 'scale-x-[-1]' : '')} />
          {cameraFlash && <div className="absolute inset-0 bg-white z-10" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/75 pointer-events-none" />
        </div>
        <div className="relative z-20 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button type="button" onClick={() => { stopCamera(); setCameraOpen(false) }} disabled={cameraRecording} className="grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-xl border border-white/15 disabled:opacity-40" aria-label="Close camera"><X className="size-6" /></button>
          <div className="rounded-full border border-white/15 bg-black/35 px-4 py-2 text-[11px] font-semibold tracking-[0.18em] backdrop-blur-xl">YOMY CAMERA</div>
          <button type="button" onClick={() => void flipCamera()} disabled={cameraRecording} className="grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-xl border border-white/15" aria-label="Flip camera"><RotateCcw className="size-5" /></button>
        </div>
        <div className="relative z-20 mt-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-5 flex w-fit rounded-full border border-white/15 bg-black/40 p-1 backdrop-blur-2xl">
            <button type="button" onClick={() => void changeCameraMode('photo')} disabled={cameraRecording} className={'min-w-28 rounded-full px-5 py-2 text-sm font-semibold transition-all disabled:opacity-50 ' + (cameraMode === 'photo' ? 'bg-white text-black shadow-lg' : 'text-white/80')}>PHOTO</button>
            <button type="button" onClick={() => void changeCameraMode('video')} disabled={cameraRecording} className={'min-w-28 rounded-full px-5 py-2 text-sm font-semibold transition-all disabled:opacity-50 ' + (cameraMode === 'video' ? 'bg-white text-black shadow-lg' : 'text-white/80')}>VIDEO</button>
          </div>
          <div className="flex items-center justify-center gap-7">
            <div className="w-12" />
            <button type="button" onClick={() => cameraMode === 'photo' ? capturePhoto() : toggleCameraRecording()} className={'grid size-[78px] place-items-center rounded-full border-4 border-white shadow-[0_10px_50px_rgba(0,0,0,.45)] transition-transform active:scale-95 ' + (cameraRecording ? 'bg-red-500/90' : 'bg-white/95')} aria-label={cameraMode === 'photo' ? 'Take photo' : cameraRecording ? 'Stop recording' : 'Start recording'}>
              {cameraMode === 'photo' ? <span className="size-[62px] rounded-full bg-white border-2 border-black/10" /> : cameraRecording ? <span className="size-7 rounded-lg bg-white" /> : <span className="size-16 rounded-full bg-red-500" />}
            </button>
            <div className="w-12 flex justify-center">{cameraRecording && <span className="rounded-full bg-black/45 border border-white/15 px-2.5 py-1.5 text-xs font-semibold backdrop-blur-xl">{String(Math.floor(cameraSeconds / 60)).padStart(2,'0')}:{String(cameraSeconds % 60).padStart(2,'0')}</span>}</div>
          </div>
          <p className="mt-4 text-center text-[11px] text-white/70">{cameraMode === 'photo' ? 'Tap to capture · Front/back camera supported' : cameraRecording ? 'Tap to stop and preview the video' : 'Tap to start recording · Audio included when permission is available'}</p>
        </div>
      </div>}

      <Dialog open={pollOpen} onOpenChange={setPollOpen}>
        <DialogContent className="max-w-sm rounded-[1.65rem] border-white/15 bg-background/82 backdrop-blur-2xl shadow-[0_30px_90px_rgba(0,0,0,.22)]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="size-5 text-primary" />Create poll</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input autoFocus value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Ask a question…" className="rounded-xl bg-muted/45" />
            <div className="space-y-2">
              {pollOptions.map((value, index) => <div key={index} className="flex gap-2">
                <Input value={value} onChange={e => setPollOptions(list => list.map((item, i) => i === index ? e.target.value : item))} placeholder={'Choice ' + (index + 1)} className="rounded-xl bg-muted/45" />
                {pollOptions.length > 2 && <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={() => setPollOptions(list => list.filter((_, i) => i !== index))}><X className="size-4" /></Button>}
              </div>)}
            </div>
            <Button variant="outline" className="w-full rounded-xl" disabled={pollOptions.length >= 6} onClick={() => setPollOptions(list => [...list, ''])}><Plus className="size-4 mr-1" />Add choice</Button>
            <div className="flex gap-2 pt-1"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setPollOpen(false)}>Cancel</Button><Button className="flex-1 rounded-xl" disabled={sending || !online} onClick={() => void createPoll()}>Send poll</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={viewOncePickerOpen} onOpenChange={setViewOncePickerOpen}>
        <DialogContent className="max-w-sm rounded-[28px] border-white/15 bg-background/90 backdrop-blur-2xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="size-5 text-primary" />Media viewing mode</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2.5 pt-1">
            {[
              { value: 0 as const, title: 'Normal', description: 'Media stays available normally' },
              { value: 1 as const, title: 'View once', description: 'Recipient can open it one time' },
              { value: 2 as const, title: 'View twice', description: 'Recipient can open it two times' },
            ].map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => { setPendingViewOnceLimit(option.value); setViewOncePickerOpen(false) }}
                className={'w-full rounded-2xl border px-4 py-3 text-left transition-all ' + (pendingViewOnceLimit === option.value ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border/60 bg-muted/35 hover:bg-muted/60')}
              >
                <div className="flex items-center gap-3">
                  <span className={'grid size-10 place-items-center rounded-xl ' + (pendingViewOnceLimit === option.value ? 'bg-primary text-primary-foreground' : 'bg-background/80')}>
                    {option.value === 0 ? <ImagePlus className="size-5" /> : <Eye className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm">{option.title}</b>
                    <small className="block text-xs text-muted-foreground mt-0.5">{option.description}</small>
                  </span>
                  {pendingViewOnceLimit === option.value && <Check className="size-5 text-primary shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {settingsOpen && pref && <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm max-h-[82vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Wallpaper & message colors</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Decorative background</p>
              <div className="grid grid-cols-2 gap-2">
                {wallpapers.map(item => <button key={item} onClick={() => setDraftTheme(item)} className={'rounded-2xl border p-3 text-left transition-all ' + (draftTheme === item ? 'ring-2 ring-primary border-primary' : '')}>
                  <div className={'h-14 rounded-xl mb-2 flex items-center justify-center text-lg ' + (item === 'default' ? 'bg-muted' : item === 'midnight' ? 'bg-slate-950 text-white' : item === 'paper' ? 'bg-muted/40' : item === 'roses' ? 'bg-rose-100 dark:bg-rose-950/30' : 'bg-pink-100 dark:bg-pink-950/30')}>{item === 'romance' ? '♥ ✿' : item === 'hearts' ? '♥ ♡' : item === 'petals' ? '✿ ❀' : item === 'roses' ? '🌹 ♡' : item === 'midnight' ? '✦ ⋆' : item === 'paper' ? '· •' : 'A'}</div>
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

      {emojiOpen && <Dialog open={emojiOpen} onOpenChange={open => { setEmojiOpen(open); if (!open) setReactionFor(null) }}>
        <DialogContent className="w-[min(96vw,430px)] max-w-[430px] rounded-[28px] border-border/70 bg-background/95 p-2 shadow-[0_30px_100px_rgba(0,0,0,.28)] backdrop-blur-2xl">
          <DialogHeader className="px-3 pt-2 pb-1"><DialogTitle className="text-base font-semibold">{reactionFor ? 'React to message' : 'Emoji'}</DialogTitle></DialogHeader>
          <div className="px-2 pb-2 overflow-x-auto">
            <div className="flex gap-2 items-center">
              {BUILT_IN_STICKERS.map(sticker => <button key={sticker.id} type="button" className="yomy-sticker-tile" title={sticker.name} onClick={async () => { await sendStickerFile(stickerFile(sticker.svg, 'yomy-' + sticker.id)); setEmojiOpen(false) }}><img src={stickerDataUrl(sticker.svg)} alt={sticker.name} /></button>)}
              {stickersLoading && <Spinner className="size-4 my-2" />}
              {stickers.map(sticker => <button key={sticker.id} type="button" className="yomy-sticker-tile" title={sticker.name} onClick={async () => { try { const res = await fetch(sticker.url); const blob = await res.blob(); await sendStickerFile(new File([blob], 'sticker.png', { type: 'image/png' })); setEmojiOpen(false) } catch { toast.error('Could not send sticker') } }}><img src={sticker.url} alt={sticker.name} /></button>)}
            </div>
          </div>
          <div className="overflow-hidden rounded-[22px] border border-border/60 shadow-inner">
            <EmojiPicker
              theme={EmojiTheme.AUTO}
              emojiStyle={EmojiStyle.NATIVE}
              width="100%"
              height={440}
              previewConfig={{ showPreview: false }}
              onEmojiClick={data => {
                if (reactionFor) {
                  void react(reactionFor, data.emoji)
                  setEmojiOpen(false)
                  setReactionFor(null)
                } else {
                  setInput(value => value + data.emoji)
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>}

      {drawingOpen && <ChatDoodleEditor onCancel={() => setDrawingOpen(false)} onDone={file => { setDrawingOpen(false); setPendingMedia({ file, kind: 'image', previewUrl: URL.createObjectURL(file) }) }} />}

      {viewOnceUrl && <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4" onClick={() => { setViewOnceUrl(null); setViewOnceMessageId(null); setViewOnceRemaining(null) }}>
        <div className="absolute top-5 left-1/2 -translate-x-1/2 text-white/85 rounded-full bg-white/10 border border-white/10 px-4 py-2 text-xs backdrop-blur-xl" onClick={e => e.stopPropagation()}>
          {viewOnceRemaining && viewOnceRemaining > 0 ? (viewOnceRemaining + ' view remaining') : 'This media expires after this view'}
        </div>
        <div className="relative max-w-full max-h-full rounded-[28px] overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,.5)] ring-1 ring-white/10">
          {messages.find(item => item.id === viewOnceMessageId)?.media_type === 'video'
            ? <video src={viewOnceUrl} autoPlay controls playsInline className="max-w-[94vw] max-h-[78vh] object-contain bg-black" onClick={e => e.stopPropagation()} />
            : <img src={viewOnceUrl} alt="" className="max-w-[94vw] max-h-[78vh] object-contain" onClick={e => e.stopPropagation()} />}
        </div>
        <Button variant="ghost" className="absolute top-5 right-5 text-white hover:bg-white/10 rounded-full" size="icon" onClick={e => { e.stopPropagation(); setViewOnceUrl(null); setViewOnceMessageId(null); setViewOnceRemaining(null) }}><X className="size-6" /></Button>
      </div>}
      {pref?.muted && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-background/90 border px-3 py-1.5 text-[11px] shadow-xl backdrop-blur-xl">Notifications muted for this chat</div>}
    </div>
  )
}
