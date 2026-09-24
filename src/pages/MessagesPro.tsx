import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, Inbox, Plus, Search, WifiOff } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Message, Note, Profile as ProfileType } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { cacheConversations, readCachedConversations } from '@/lib/offlineStore'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

type Conversation = {
  user: ProfileType
  lastMessage: Message | null
  unreadCount: number
  archived: boolean
  muted: boolean
}

export default function MessagesPro() {
  const { user } = useAuth()
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ProfileType[]>([])

  const fetchInbox = useCallback(async () => {
    if (!user) return
    const cached = await readCachedConversations<Conversation>(user.id)
    if (cached?.length) {
      setConversations(cached)
      setLoading(false)
    }
    if (!online) {
      setLoading(false)
      return
    }

    const [messageResult, prefResult] = await Promise.all([
      supabase.from('messages').select('*, sender:profiles!sender_id(id,username,full_name,avatar_url,is_verified), receiver:profiles!receiver_id(id,username,full_name,avatar_url,is_verified)').or('sender_id.eq.' + user.id + ',receiver_id.eq.' + user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(500),
      supabase.from('chat_preferences').select('*').eq('user_id', user.id),
    ])
    if (messageResult.error || !messageResult.data) {
      setLoading(false)
      return
    }

    const prefMap = new Map<string, { archived: boolean; muted: boolean }>(
      (prefResult.data || []).map(row => [row.other_user_id, { archived: row.archived, muted: row.muted }])
    )
    const map = new Map<string, Conversation>()
    const unread = new Map<string, number>()

    for (const raw of messageResult.data as Message[]) {
      const partnerId = raw.sender_id === user.id ? raw.receiver_id : raw.sender_id
      const partner = (raw.sender_id === user.id ? raw.receiver : raw.sender) as unknown as ProfileType
      if (!partner) continue

      if (raw.receiver_id === user.id && !raw.is_seen && !raw.deleted_for_everyone) {
        unread.set(partnerId, (unread.get(partnerId) || 0) + 1)
      }
      if (!map.has(partnerId)) {
        map.set(partnerId, {
          user: partner,
          lastMessage: raw,
          unreadCount: 0,
          archived: prefMap.get(partnerId)?.archived || false,
          muted: prefMap.get(partnerId)?.muted || false,
        })
      }
    }

    const next = Array.from(map.values())
      .map(c => ({ ...c, unreadCount: unread.get(c.user.id) || 0 }))
      .sort((a, b) => new Date(b.lastMessage?.created_at || 0).getTime() - new Date(a.lastMessage?.created_at || 0).getTime())

    setConversations(next)
    await cacheConversations(user.id, next)
    setLoading(false)
  }, [online, user])

  const fetchNotes = useCallback(async () => {
    if (!user || !online) return
    const { data } = await supabase
      .from('notes')
      .select('*, profiles!user_id(id,username,full_name,avatar_url,is_verified)')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20)
    setNotes((data || []) as Note[])
  }, [online, user])

  useEffect(() => {
    void fetchInbox()
    void fetchNotes()
  }, [fetchInbox, fetchNotes])

  useEffect(() => {
    if (!user) return
    if (!online) return
    const channel = supabase.channel('inbox-pro:' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + user.id }, () => void fetchInbox())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + user.id }, () => void fetchInbox())
      .subscribe()
    const onOnline = () => void fetchInbox()
    const onSync = () => void fetchInbox()
    const onChatSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ otherUserId?: string; patch?: { archived?: boolean; muted?: boolean } }>).detail
      if (!detail?.otherUserId || !detail.patch) return
      setConversations(prev => prev.map(item => item.user.id === detail.otherUserId ? {
        ...item,
        archived: typeof detail.patch?.archived === 'boolean' ? detail.patch.archived : item.archived,
        muted: typeof detail.patch?.muted === 'boolean' ? detail.patch.muted : item.muted,
      } : item))
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('yomy-sync-complete', onSync)
    window.addEventListener('yomy-chat-settings-changed', onChatSettings)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('yomy-sync-complete', onSync)
      window.removeEventListener('yomy-chat-settings-changed', onChatSettings)
      void supabase.removeChannel(channel)
    }
  }, [fetchInbox, online, user])

  const searchPeople = async () => {
    const value = search.trim()
    if (!online || !value) {
      setResults([])
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .or('username.ilike.%' + value + '%,full_name.ilike.%' + value + '%')
      .neq('id', user?.id || '')
      .limit(12)
    setResults((data || []) as ProfileType[])
  }

  const archivedCount = conversations.filter(item => item.archived).length
  const visible = useMemo(
    () => conversations.filter(item => item.archived === showArchived),
    [conversations, showArchived]
  )

  return (
    <div className="yomy-glass-page min-h-screen pb-20">
      <TopBar title="Messages" right={<Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate('/messages/new')}><Plus className="size-5" /></Button>} />
      {!online && <div className="px-4 py-2 border-b border-amber-500/20 bg-amber-500/10 text-[11px] flex items-center gap-2"><WifiOff className="size-3.5 text-amber-600" /><span>Offline mode • conversations are available from this device</span></div>}

      <div className="max-w-lg mx-auto">
        {notes.length > 0 && <div className="px-4 py-3 border-b border-border"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Notes</p><div className="flex gap-4 overflow-x-auto scrollbar-hide">{notes.map(note => <Link key={note.id} to={'/profile/' + note.profiles?.username} className="w-16 shrink-0 text-center"><Avatar className="size-12 mx-auto"><AvatarImage src={note.profiles?.avatar_url} /><AvatarFallback>{note.profiles?.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar><p className="text-[11px] truncate mt-1">{note.content}</p></Link>)}</div></div>}

        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchPeople() }} placeholder="Search people…" className="pl-9 rounded-2xl bg-muted/55 border-transparent" />
          </div>
          {results.length > 0 && <div className="mt-2 rounded-2xl border border-border/45 yomy-ios-panel overflow-hidden">{results.map(p => <Link key={p.id} to={'/messages/' + p.username} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"><Avatar className="size-10"><AvatarImage src={p.avatar_url} /><AvatarFallback>{p.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0"><p className="text-sm font-medium">{p.username}</p><p className="text-xs text-muted-foreground truncate">{p.full_name}</p></div></Link>)}</div>}
        </div>

        {archivedCount > 0 && <button onClick={() => setShowArchived(value => !value)} className="w-full flex items-center gap-3 px-4 py-3 border-y border-border bg-card/60 hover:bg-muted/40 transition-colors"><div className="size-10 rounded-full bg-muted flex items-center justify-center"><Archive className="size-5" /></div><div className="flex-1 text-left"><p className="text-sm font-semibold">{showArchived ? 'Back to chats' : 'Archived'}</p><p className="text-xs text-muted-foreground">{archivedCount} archived chat{archivedCount === 1 ? '' : 's'}</p></div><span className="text-muted-foreground">›</span></button>}

        {loading && conversations.length === 0
          ? <div className="h-56 flex items-center justify-center"><Spinner className="size-6" /></div>
          : visible.length === 0
            ? <div className="py-20 text-center text-muted-foreground"><div className="size-14 rounded-full bg-muted mx-auto flex items-center justify-center"><Inbox className="size-6" /></div><p className="mt-3 text-sm font-medium">{showArchived ? 'No archived chats' : 'No conversations yet'}</p><p className="mt-1 text-xs">{showArchived ? 'Chats you archive appear here.' : 'Search for a person above to start chatting.'}</p></div>
            : <div className="yomy-ios-panel overflow-hidden">{visible.map(conv => <Link key={conv.user.id} to={'/messages/' + conv.user.username} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/45 active:bg-muted/65 transition-colors">
              <div className="relative"><Avatar className="size-12"><AvatarImage src={conv.user.avatar_url} /><AvatarFallback>{conv.user.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar>{conv.unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{conv.unreadCount}</span>}</div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className={'text-sm truncate ' + (conv.unreadCount ? 'font-semibold' : 'font-medium')}>{conv.user.username}</p>{conv.muted && <span className="text-[10px]">🔕</span>}</div><p className={'text-[13px] truncate mt-0.5 ' + (conv.unreadCount ? 'text-foreground' : 'text-muted-foreground')}>{conv.lastMessage?.sender_id === user?.id ? 'You: ' : ''}{conv.lastMessage?.deleted_for_everyone ? 'Message deleted' : conv.lastMessage?.message_type === 'poll' ? '📊 Poll' : conv.lastMessage?.view_once ? '📷 Photo' : conv.lastMessage?.media_type === 'audio' ? '🎤 Voice message' : conv.lastMessage?.media_type === 'video' ? '🎬 Video' : conv.lastMessage?.media_type === 'file' ? '📎 File' : conv.lastMessage?.content || ''}</p></div>
              <span className="text-[10px] text-muted-foreground shrink-0">{conv.lastMessage && formatDistanceToNow(new Date(conv.lastMessage.created_at), { addSuffix: false })}</span>
            </Link>)}</div>
        }
      </div>
      <BottomNav />
    </div>
  )
}
