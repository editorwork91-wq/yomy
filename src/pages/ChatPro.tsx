import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Archive, BellOff, Check, CheckCheck, ChevronLeft, Copy, Heart, ImagePlus, Maximize2,
  Mic, MoreVertical, Palette, Phone, Reply, Send, Smile, Trash2, Video, WifiOff,
  X, Pencil, Eye, EyeOff, Clock3, UserRound, ShieldCheck
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

type PendingMedia = { file: File; kind: 'image' | 'video'; previewUrl: string }
type ViewOnceLimit = 0 | 1 | 2

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

function viewOnceInfo(message: Message) {
  const limit = message.view_once ? Math.max(1, Math.min(2, Number(message.view_once_limit || 1))) : 0
  const count = message.view_once ? Math.max(0, Math.min(limit, Number(message.view_once_open_count ?? (message.view_once_opened ? 1 : 0)))) : 0
  return { limit, count, remaining: Math.max(0, limit - count) }
}

function Rose3DWallpaper({ active }: { active: boolean }) {
  if (!active) return null
  const blooms = [
    { left: '6%', top: '8%', size: 118, delay: '-1.2s', duration: '12s', tilt: -14 },
    { left: '72%', top: '5%', size: 92, delay: '-5s', duration: '15s', tilt: 9 },
    { left: '38%', top: '20%', size: 74, delay: '-8s', duration: '13s', tilt: -6 },
    { left: '88%', top: '34%', size: 126, delay: '-3s', duration: '16s', tilt: 18 },
    { left: '4%', top: '48%', size: 86, delay: '-7s', duration: '14s', tilt: -10 },
    { left: '57%', top: '58%', size: 104, delay: '-2s', duration: '17s', tilt: 7 },
    { left: '18%', top: '78%', size: 128, delay: '-10s', duration: '15s', tilt: 15 },
    { left: '76%', top: '82%', size: 78, delay: '-6s', duration: '13s', tilt: -12 },
  ]
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden yomy-3d-stage opacity-[0.34]" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,160,195,.12),transparent_42%),radial-gradient(circle_at_12%_78%,rgba(180,105,155,.10),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(255,205,220,.11),transparent_28%)]" />
      {blooms.map((bloom, index) => (
        <div key={index} className="absolute yomy-3d-bloom" style={{ left: bloom.left, top: bloom.top, width: bloom.size, height: bloom.size, animationDelay: bloom.delay, animationDuration: bloom.duration }}>
          <div className="relative w-full h-full" style={{ transform: 'rotateX(58deg) rotateZ(' + bloom.tilt + 'deg)', transformStyle: 'preserve-3d' }}>
            {Array.from({ length: 8 }, (_, petal) => (
              <i key={petal} className="yomy-3d-petal" style={{ transform: 'translate(-50%, -100%) rotateZ(' + (petal * 45) + 'deg) rotateX(' + (petal % 2 ? 12 : -8) + 'deg) translateZ(' + (8 + (petal % 3) * 5) + 'px)' }} />
            ))}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[24%] rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,rgba(255,216,229,.96)_30%,rgba(157,42,89,.95)_100%)] shadow-[0_7px_18px_rgba(92,20,61,.32)] yomy-3d-bloom-core" />
          </div>
        </div>
      ))}
    </div>
  )
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
  const [viewOnceLimit, setViewOnceLimit] = useState<ViewOnceLimit>(0)
  const [viewOnceOpening, setViewOnceOpening] = useState(false)
  const [mediaViewer, setMediaViewer] = useState<{ url: string; kind: 'image' | 'video' } | null>(null)
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
      .select('*, message_reactions(id,user_id,emoji,created_at)')
      .or('and(sender_id.eq.' + user.id + ',receiver_id.eq.' + otherUser.id + '),and(sender_id.eq.' + otherUser.id + ',receiver_id.eq.' + user.id + ')')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(250)
    if (!error && data) {
      const serverMessages = data as Message[]
      const localPending = (cached || []).filter(message =>
        message.id.startsWith('local:') &&
        !serverMessages.some(server => server.client_message_id && server.client_message_id === message.client_message_id)
      )
      const next = [...serverMessages, ...localPending].sort((a, b) => a.created_at.localeCompare(b.created_at))
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
        setMessages(prev => prev.map(m => m.id === row.id ? { ...m, ...row } : m))
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, () => void loadMessages(false))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, () => void loadMessages(false))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, () => void loadMessages(false))
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

  useEffect(() => {
    const onSyncError = (event: Event) => {
      const detail = (event as CustomEvent<{ clientMessageId?: string; messageId?: string; message?: string }>).detail
      if (detail?.clientMessageId) {
        setMessages(prev => prev.filter(message => message.client_message_id !== detail.clientMessageId && message.id !== 'local:' + detail.clientMessageId))
        void loadMessages(false)
        toast.error(detail.message || 'Message could not be sent')
      } else if (detail?.messageId) {
        void loadMessages(false)
        toast.error(detail.message || 'Sync failed')
      }
    }
    window.addEventListener('yomy-sync-error', onSyncError)
    return () => window.removeEventListener('yomy-sync-error', onSyncError)
  }, [loadMessages])

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
      if (error) {
        if (isTransientSendError(error)) await queueSyncOperation({ opId: crypto.randomUUID(), userId: user.id, kind: 'chat_personal', createdAt: new Date().toISOString(), payload: { otherUserId: otherUser.id, patch: personalPatch } })
        else toast.error(error.message)
      }
    }

    if ('muted' in personalPatch) {
      const mutedResult = next.muted
        ? await supabase.from('muted_chats').upsert({ user_id: user.id, muted_user_id: otherUser.id })
        : await supabase.from('muted_chats').delete().eq('user_id', user.id).eq('muted_user_id', otherUser.id)
      if (mutedResult.error && isTransientSendError(mutedResult.error)) {
        await queueSyncOperation({ opId: crypto.randomUUID(), userId: user.id, kind: 'chat_personal', createdAt: new Date().toISOString(), payload: { otherUserId: otherUser.id, patch: { muted: next.muted } } })
      }
    }

    if ('wallpaper' in patch && patch.wallpaper) {
      const pair = sharedChatKey(user.id, otherUser.id)
      const { error } = await supabase.from('chat_shared_settings').upsert(
        { ...pair, wallpaper: patch.wallpaper, updated_by: user.id },
        { onConflict: 'user_low,user_high' },
      )
      if (error) {
        if (isTransientSendError(error)) await queueSyncOperation({ opId: crypto.randomUUID(), userId: user.id, kind: 'chat_shared', createdAt: new Date().toISOString(), payload: { otherUserId: otherUser.id, wallpaper: patch.wallpaper } })
        else toast.error(error.message)
      }
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
    if (!editing || !user || !input.trim()) return
    const content = input.trim()
    const editedAt = new Date().toISOString()
    const nextMessages = messages.map(m => m.id === editing.id ? { ...m, content, edited_at: editedAt } : m)
    setMessages(nextMessages)
    if (otherUser) await cacheMessages(user.id, otherUser.id, nextMessages)
    setEditing(null)
    setInput('')
    const operation = { opId: crypto.randomUUID(), userId: user.id, kind: 'message_edit' as const, createdAt: new Date().toISOString(), payload: { messageId: editing.id, content, editedAt } }
    if (!online) {
      await queueSyncOperation(operation)
      return
    }
    const { error } = await supabase.from('messages').update({ content, edited_at: editedAt }).eq('id', editing.id).eq('sender_id', user.id)
    if (error) {
      if (isTransientSendError(error)) await queueSyncOperation(operation)
      else { await loadMessages(false); toast.error(error.message) }
    }
  }

  const deleteForEveryone = async (message: Message) => {
    if (!user || message.sender_id !== user.id) return
    const deletedPatch = { deleted_for_everyone: true, content: '', media_url: '', media_type: '' as const }
    const nextMessages = messages.map(m => m.id === message.id ? { ...m, ...deletedPatch } : m)
    setMessages(nextMessages)
    if (otherUser) await cacheMessages(user.id, otherUser.id, nextMessages)
    const operation = { opId: crypto.randomUUID(), userId: user.id, kind: 'message_delete' as const, createdAt: new Date().toISOString(), payload: { messageId: message.id } }
    if (!online) {
      await queueSyncOperation(operation)
      return
    }
    const { error } = await supabase.from('messages').update(deletedPatch).eq('id', message.id).eq('sender_id', user.id)
    if (error) {
      if (isTransientSendError(error)) await queueSyncOperation(operation)
      else { await loadMessages(false); toast.error(error.message) }
    }
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
      if (isTransientSendError(result.error)) {
        await queueSyncOperation({ opId: crypto.randomUUID(), userId: user.id, kind: 'reaction_set', createdAt: new Date().toISOString(), payload: { messageId, mode, emoji } })
      } else {
        toast.error(result.error.message)
        await loadMessages(false)
      }
      return
    }
    await loadMessages(false)
  }

  const openViewOnceMedia = useCallback(async (message: Message) => {
    if (!user || !otherUser || !online || !message.view_once || message.media_type !== 'image' || message.sender_id === user.id) return
    const info = viewOnceInfo(message)
    if (!info.remaining) {
      toast.error('This photo has already been closed')
      return
    }
    setViewOnceOpening(true)
    try {
      const { data, error } = await supabase.functions.invoke('message-media-url', {
        body: { message_id: message.id, expires_in: 90, consume_view_once: true },
      })
      if (error || !data?.url) {
        const exhausted = Number(data?.view_once_open_count || 0) >= Number(data?.view_once_limit || info.limit)
        if (exhausted) {
          setMessages(prev => prev.map(item => item.id === message.id ? { ...item, view_once_opened: true, view_once_open_count: info.limit } : item))
          toast.error('This photo is no longer available')
        } else {
          toast.error(error?.message || 'Could not open this photo')
        }
        return
      }
      const openedCount = Number(data.view_once_open_count || info.count + 1)
      const nextMessages = messages.map(item => item.id === message.id
        ? { ...item, view_once_opened: true, view_once_open_count: openedCount, view_once_opened_at: data.view_once_opened_at || item.view_once_opened_at }
        : item)
      setMessages(nextMessages)
      await cacheMessages(user.id, otherUser.id, nextMessages)
      setMediaViewer({ url: String(data.url), kind: 'image' })
    } finally {
      setViewOnceOpening(false)
    }
  }, [messages, online, otherUser, user])

  const uploadMedia = async (file: File, kind: 'image' | 'video', onceLimit: ViewOnceLimit = 0) => {
    if (!user || !otherUser) return
    if (!online) {
      toast.error('Media waits for a connection. Text messages still work offline.')
      return
    }
    const path = (kind === 'video' ? 'videos/' : 'images/') + user.id + '/' + crypto.randomUUID() + '.' + (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg'))
    const clientMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const { error: uploadError } = await supabase.storage.from('messages-private').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (uploadError) return toast.error(uploadError.message)

    const { data, error } = await supabase.rpc('send_message_v3', {
      p_receiver_id: otherUser.id,
      p_content: input.trim(),
      p_reply_to_id: replyTo?.id || null,
      p_media_url: '',
      p_media_type: kind,
      p_media_bucket: 'messages-private',
      p_media_path: path,
      p_view_once: kind === 'image' && onceLimit > 0,
      p_view_once_limit: kind === 'image' ? onceLimit : 0,
      p_client_message_id: clientMessageId,
      p_created_at: createdAt,
    })
    if (error) {
      await supabase.storage.from('messages-private').remove([path])
      return toast.error(error.message)
    }
    setMessages(prev => [...prev, data as Message])
    setInput('')
    setReplyTo(null)
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl)
    setPendingMedia(null)
    setViewOnceLimit(0)
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
    const clientMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const { error: uploadError } = await supabase.storage.from('messages-private').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (uploadError) return toast.error(uploadError.message)

    const { data, error } = await supabase.rpc('send_message_v2', {
      p_receiver_id: otherUser.id,
      p_content: '',
      p_reply_to_id: replyTo?.id || null,
      p_media_url: '',
      p_media_type: 'audio',
      p_media_bucket: 'messages-private',
      p_media_path: path,
      p_view_once: false,
      p_client_message_id: clientMessageId,
      p_created_at: createdAt,
    })
    if (error) {
      await supabase.storage.from('messages-private').remove([path])
      return toast.error(error.message)
    }
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
    const { data, error } = await supabase.rpc('send_message_v2', {
      p_receiver_id: otherUser.id,
      p_content: content,
      p_reply_to_id: replyId,
      p_media_url: '',
      p_media_type: '',
      p_media_bucket: 'messages-private',
      p_media_path: null,
      p_view_once: false,
      p_client_message_id: clientMessageId,
      p_created_at: createdAt,
    })
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
    } else {
      setMessages(prev => prev.filter(message => message.id !== temp.id))
      await cacheMessages(user.id, otherUser.id, nextLocal.filter(message => message.id !== temp.id))
      toast.error('Message was not sent: ' + (error?.message || 'Unknown server error'))
    }
    setSending(false)
  }

  useEffect(() => {
    if (!online || !user || !messages.length) return
    const candidates = messages.filter(message => message.media_type && !message.view_once && !mediaUrls[message.id]).slice(-16)
    if (!candidates.length) return
    let cancelled = false

    void Promise.all(candidates.map(async message => {
      if (message.media_url && message.media_bucket !== 'messages-private') {
        setMediaUrls(current => ({ ...current, [message.id]: message.media_url }))
        return
      }
      const { data, error } = await supabase.functions.invoke('message-media-url', {
        body: { message_id: message.id, expires_in: 3600 },
      })
      if (!cancelled && !error && data?.url) {
        setMediaUrls(current => ({ ...current, [message.id]: String(data.url) }))
      }
    }))

    return () => { cancelled = true }
  }, [mediaUrls, messages, online, user])

  const pendingCount = messages.filter(message => message.id.startsWith('local:')).length
  const pref = preference || (user && otherUser ? fallbackPreference(user.id, otherUser.id) : null)
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
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden yomy-3d-stage">
      <header className="h-16 shrink-0 border-b border-border/60 bg-background/78 backdrop-blur-2xl flex items-center gap-1 px-2 shadow-[0_8px_30px_rgba(0,0,0,.06)] yomy-3d-surface">
        <Button variant="ghost" size="icon" className="size-10 rounded-full" onClick={() => navigate(-1)}><ChevronLeft className="size-5" /></Button>
        <Link to={'/profile/' + otherUser.username} className="flex items-center gap-2 min-w-0 flex-1">
          <div className="relative">
            <Avatar className="size-10"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback>{initials(otherUser)}</AvatarFallback></Avatar>
            {online && <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm truncate">{otherUser.username}</p>
              {otherUser.is_verified && <ShieldCheck className="size-3.5 text-sky-500 shrink-0" />}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{online ? 'Online · synced' : 'Offline · device snapshot'}</p>
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
        <Rose3DWallpaper active={sharedWallpaper === 'roses' || sharedWallpaper === 'petals'} />
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
            const once = message.view_once ? viewOnceInfo(message) : null
            const canOpenOnce = !!once && once.remaining > 0 && !mine && online
            return (
              <div key={message.id} id={'message-' + message.id} className={'flex yomy-message-3d ' + (mine ? 'justify-end' : 'justify-start') + ' group'}>
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
                        {message.media_type === 'image' && message.view_once ? (
                          <button type="button" disabled={!canOpenOnce || viewOnceOpening} onClick={() => void openViewOnceMedia(message)} className={'w-full min-w-56 rounded-2xl border px-4 py-4 text-left transition-all yomy-3d-surface ' + (canOpenOnce ? 'bg-black/5 dark:bg-white/5 hover:scale-[1.01] cursor-pointer' : 'opacity-70 cursor-default')}>
                            <div className="flex items-center gap-3">
                              <div className="size-12 shrink-0 rounded-2xl bg-black/10 dark:bg-white/10 flex items-center justify-center shadow-inner">{once?.remaining ? <Eye className="size-5" /> : <EyeOff className="size-5" />}</div>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm">{once?.remaining ? (once.limit === 1 ? 'View once photo' : 'View twice photo') : 'Photo closed'}</p>
                                <p className="text-[11px] opacity-70 mt-0.5">{mine ? 'Sent • recipient can view it' : once?.remaining === 2 ? 'Two opens available' : once?.remaining === 1 ? 'One open remaining' : 'This photo is closed permanently'}</p>
                              </div>
                              {canOpenOnce && <span className="rounded-full px-2 py-1 text-[10px] font-semibold bg-background/70 border">{viewOnceOpening ? 'Opening…' : 'Open'}</span>}
                            </div>
                          </button>
                        ) : message.media_type === 'image' && (mediaUrls[message.id] || message.media_url) && <button type="button" onClick={() => setMediaViewer({ url: mediaUrls[message.id] || message.media_url, kind: 'image' })} className="group/media relative block overflow-hidden rounded-xl yomy-3d-surface"><img src={mediaUrls[message.id] || message.media_url} alt="" className="rounded-xl max-h-72 max-w-full object-cover mb-1.5 transition-transform duration-200 group-hover/media:scale-[1.015]" loading="lazy" /><span className="absolute right-2 top-2 size-8 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity"><Maximize2 className="size-4" /></span></button>}
                        {message.media_type === 'video' && (mediaUrls[message.id] || message.media_url) && <div className="relative overflow-hidden rounded-xl mb-1.5"><video src={mediaUrls[message.id] || message.media_url} controls playsInline preload="metadata" className="rounded-xl max-h-72 max-w-full" /><button type="button" onClick={() => setMediaViewer({ url: mediaUrls[message.id] || message.media_url, kind: 'video' })} aria-label="Open video" className="absolute right-2 top-2 size-8 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-md"><Maximize2 className="size-4" /></button></div>}
                        {message.media_type === 'audio' && (mediaUrls[message.id] || message.media_url) && <audio src={mediaUrls[message.id] || message.media_url} controls className="w-full min-w-48 h-9 mb-1.5" />}
                        {!message.media_url && message.media_type && !mediaUrls[message.id] && <div className="h-24 w-52 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse mb-1.5" />}
                        {message.content && <p className="text-[15px] whitespace-pre-wrap break-words leading-[1.35]">{renderMessageText(message.content)}</p>}
                        {message.content && firstUrl(message.content) && <LinkPreviewCard url={firstUrl(message.content)} />}
                        {message.view_once && message.media_type !== 'image' && <p className="text-[11px] mt-1 opacity-75 flex items-center gap-1"><Eye className="size-3" />View once</p>}
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
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setReactionFor(reactionFor === message.id ? null : message.id)}><Smile className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(message)}><Reply className="size-4" /></Button>
                    {mine && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void copyMessage(message)}><Copy className="size-4 mr-2" />Copy</DropdownMenuItem>{message.media_type === '' && <DropdownMenuItem onClick={() => { setEditing(message); setInput(message.content) }}><Pencil className="size-4 mr-2" />Edit</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem onClick={() => void deleteForEveryone(message)} className="text-destructive focus:text-destructive"><Trash2 className="size-4 mr-2" />Delete for everyone</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
                  </div>}
                  {reactionFor === message.id && <div className="mt-1 rounded-full border bg-background/95 backdrop-blur-xl px-2 py-1.5 shadow-[0_14px_40px_rgba(0,0,0,.18)] flex gap-1">{['❤️','😂','👍','🔥','😮','😢','🎉','👏'].map(emoji => <button key={emoji} onClick={() => void react(message.id, emoji)} className="size-8 rounded-full hover:bg-muted active:scale-90 transition-transform">{emoji}</button>)}</div>}
                </div>
              </div>
            )
          })}
          <div className="h-3" />
        </div>
      </div>

      {pendingMedia && <div className="shrink-0 border-t bg-card/95 backdrop-blur-xl px-3 py-2.5"><div className="flex items-center gap-3 flex-wrap">
        <div className="relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-2xl border bg-black/5 dark:bg-white/5 shadow-sm yomy-3d-surface">
          {pendingMedia.kind === 'image'
            ? <button type="button" onClick={() => setMediaViewer({ url: pendingMedia.previewUrl, kind: 'image' })} className="block h-full w-full"><img src={pendingMedia.previewUrl} alt="" className="h-full w-full object-cover" /><span className="absolute right-1.5 top-1.5 size-6 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-md"><Maximize2 className="size-3.5" /></span></button>
            : <><video src={pendingMedia.previewUrl} muted playsInline controls className="h-full w-full object-cover" /><button type="button" onClick={() => setMediaViewer({ url: pendingMedia.previewUrl, kind: 'video' })} aria-label="Open video preview" className="absolute right-1.5 top-1.5 size-6 rounded-full bg-black/65 text-white flex items-center justify-center backdrop-blur-md"><Maximize2 className="size-3.5" /></button></>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{pendingMedia.kind === 'image' ? 'Photo preview' : 'Video preview'}</p>
          <p className="text-xs text-muted-foreground truncate">Preview before sending.</p>
        </div>
        {pendingMedia.kind === 'image' && <div className="rounded-2xl border bg-background/75 p-1 flex items-center gap-1 shadow-sm">
          <span className="px-2 text-[10px] font-semibold text-muted-foreground">Open</span>
          {([0,1,2] as ViewOnceLimit[]).map(option => <Button key={option} type="button" variant={viewOnceLimit === option ? 'default' : 'ghost'} size="sm" className="h-8 rounded-xl px-2.5 text-[11px]" onClick={() => setViewOnceLimit(option)}><Eye className="size-3.5 mr-1" />{option === 0 ? 'Normal' : option === 1 ? '1×' : '2×'}</Button>)}
        </div>}
        <Button variant="ghost" size="icon" onClick={() => { URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null); setViewOnceLimit(0) }}><X className="size-5" /></Button>
        <Button size="sm" disabled={!online} onClick={() => void uploadMedia(pendingMedia.file, pendingMedia.kind, pendingMedia.kind === 'image' ? viewOnceLimit : 0)}><Send className="size-4 mr-1" />Send</Button>
      </div></div>

      {replyTo && <div className="shrink-0 border-t bg-card px-4 py-2 flex items-center gap-3"><Reply className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">Replying to {replyTo.sender_id === user?.id ? 'yourself' : otherUser.username}</p><p className="text-xs text-muted-foreground truncate">{replyTo.content || 'Attachment'}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(null)}><X className="size-4" /></Button></div>}

      {editing && <div className="shrink-0 border-t bg-card px-4 py-2 flex items-center gap-3"><Pencil className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">Editing message</p><p className="text-xs text-muted-foreground truncate">{editing.content}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditing(null); setInput('') }}><X className="size-4" /></Button></div>}

      {recording && <div className="shrink-0 border-t bg-card px-4 py-3 flex items-center gap-3"><span className="size-2.5 rounded-full bg-destructive animate-pulse" /><span className="text-sm font-medium">Recording {String(Math.floor(recordingSeconds / 60)).padStart(2,'0')}:{String(recordingSeconds % 60).padStart(2,'0')}</span><div className="flex-1" /><Button size="icon" className="rounded-full" onClick={() => recorderRef.current?.stop()}><Check /></Button></div>}

      {!recording && <div className="shrink-0 border-t bg-background/95 backdrop-blur-xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-end gap-1.5">
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const file=e.target.files?.[0]; if(file && online) { setViewOnceLimit(0); setPendingMedia({ file, kind:file.type.startsWith('video/')?'video':'image', previewUrl:URL.createObjectURL(file) }) } e.currentTarget.value='' }} />
        <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" disabled={!online || !!pendingMedia} onClick={() => fileRef.current?.click()}><ImagePlus className="size-5" /></Button>
        <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" disabled={!online || !!pendingMedia} onClick={() => void startVoice()}><Mic className="size-5" /></Button>
        <Button variant="ghost" size="icon" className="size-10 rounded-full shrink-0" onClick={() => setInput(value => value + ' ❤️')}><Smile className="size-5" /></Button>
        <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendText()} }} placeholder={editing ? 'Edit message…' : online ? 'Message' : 'Message offline…'} className="flex-1 rounded-2xl min-h-10 bg-muted/55 border-transparent focus-visible:border-border" />
        <Button size="icon" className="size-10 rounded-full shrink-0" disabled={!input.trim() || sending} onClick={() => void sendText()}>{editing ? <CheckCheck className="size-5" /> : <Send className="size-5" />}</Button>
      </div>}

      {settingsOpen && pref && <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm max-h-[82vh] overflow-y-auto yomy-3d-surface">
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

      {mediaViewer && <div className="fixed inset-0 z-[140] bg-black/95 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6" onClick={() => setMediaViewer(null)}>
        <div className="relative w-full max-w-5xl max-h-full flex items-center justify-center" onClick={event => event.stopPropagation()}>
          {mediaViewer.kind === 'image'
            ? <img src={mediaViewer.url} alt="" className="max-h-[88dvh] max-w-full object-contain rounded-2xl shadow-2xl" />
            : <video src={mediaViewer.url} controls autoPlay playsInline className="max-h-[88dvh] max-w-full rounded-2xl shadow-2xl" />}
          <Button variant="ghost" className="absolute top-2 right-2 text-white bg-black/35 hover:bg-black/55 rounded-full" size="icon" onClick={() => setMediaViewer(null)}><X className="size-6" /></Button>
        </div>
      </div>}
      {pref?.muted && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-background/90 border px-3 py-1.5 text-[11px] shadow-xl backdrop-blur-xl">Notifications muted for this chat</div>}
    </div>
  )
}
