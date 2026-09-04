import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { showYomyLocalNotification } from '@/lib/localNotification'

type YomyEvent = {
  id: string
  recipient_id: string
  actor_id: string | null
  event_type: string
  priority: 0 | 1 | 2 | 3
  source_table: 'messages' | 'notifications' | 'call_sessions'
  source_id: string
  entity_id: string | null
  deep_link: string | null
  payload: Record<string, unknown>
  created_at: string
}

type Profile = { id: string; username: string | null }

const CURSOR_KEY = 'yomy:event-engine:last-created-at'
const RECENT_KEY = 'yomy:event-engine:recent-ids'
const MAX_RECENT = 300

function readCursor(): string | null {
  try { return localStorage.getItem(CURSOR_KEY) } catch { return null }
}

function writeCursor(value: string) {
  try { localStorage.setItem(CURSOR_KEY, value) } catch { /* non-fatal */ }
}

function readRecent(): Set<string> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string').slice(-MAX_RECENT) : [])
  } catch {
    return new Set()
  }
}

function persistRecent(ids: Set<string>) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(Array.from(ids).slice(-MAX_RECENT))) } catch { /* non-fatal */ }
}

function messageBody(payload: Record<string, unknown>) {
  const mediaType = String(payload.media_type || '')
  if (mediaType === 'audio') return '🎙️ Voice message'
  if (mediaType === 'video') return '🎬 Video message'
  if (mediaType === 'image') return '📷 Photo'
  return 'New message'
}

function activityCopy(payload: Record<string, unknown>) {
  switch (String(payload.notification_type || '')) {
    case 'like': return 'liked your post'
    case 'comment': return 'commented on your post'
    case 'comment_like': return 'liked your comment'
    case 'follow': return 'started following you'
    case 'follow_request': return 'sent you a follow request'
    case 'mention': return 'mentioned you'
    case 'story_reply': return 'replied to your story'
    case 'story': return 'posted a story'
    case 'post': return 'published a new post'
    default: return 'You have new activity'
  }
}

export default function YomyEventEngine() {
  const { user } = useAuth()
  const location = useLocation()
  const recentIdsRef = useRef<Set<string>>(new Set())
  const senderCacheRef = useRef<Map<string, Profile>>(new Map())
  const cursorRef = useRef<string | null>(null)
  const processingRef = useRef(false)

  const remember = useCallback((event: YomyEvent) => {
    recentIdsRef.current.add(event.id)
    if (recentIdsRef.current.size > MAX_RECENT) {
      const iterator = recentIdsRef.current.values()
      while (recentIdsRef.current.size > MAX_RECENT) {
        const oldest = iterator.next().value as string | undefined
        if (!oldest) break
        recentIdsRef.current.delete(oldest)
      }
    }
    persistRecent(recentIdsRef.current)
    if (!cursorRef.current || event.created_at > cursorRef.current) {
      cursorRef.current = event.created_at
      writeCursor(event.created_at)
    }
  }, [])

  const profileFor = useCallback(async (id: string | null): Promise<Profile | null> => {
    if (!id) return null
    const cached = senderCacheRef.current.get(id)
    if (cached) return cached
    const { data } = await supabase.from('profiles').select('id,username').eq('id', id).maybeSingle()
    if (!data) return null
    const profile = data as Profile
    senderCacheRef.current.set(id, profile)
    return profile
  }, [])

  const isMessageOpen = useCallback((username: string | null) => {
    if (!username) return false
    const match = location.pathname.match(/^\/messages\/([^/]+)$/)
    return match?.[1] === username
  }, [location.pathname])

  const present = useCallback(async (event: YomyEvent) => {
    if (event.recipient_id !== user?.id) return
    if (recentIdsRef.current.has(event.id)) return

    if (event.event_type === 'MESSAGE_NOTIFICATION') {
      remember(event)
      return
    }

    const actor = await profileFor(event.actor_id)
    const actorName = actor?.username || 'Yomy'

    if (event.event_type === 'MESSAGE_CREATED') {
      const { error } = await supabase.rpc('mark_message_delivered', { p_message_id: event.source_id })
      if (error) console.warn('Yomy message delivery reconciliation failed:', error.message)
      remember(event)
      if (isMessageOpen(actor?.username || null)) return
      showYomyLocalNotification(actorName, messageBody(event.payload), 'message')
      return
    }

    if (event.event_type === 'CALL_INCOMING') {
      remember(event)
      const kind = String(event.payload.kind || 'voice')
      showYomyLocalNotification(actorName, kind === 'video' ? 'Incoming video call' : 'Incoming voice call', 'call')
      return
    }

    if (event.source_table === 'notifications') {
      remember(event)
      showYomyLocalNotification(actorName, activityCopy(event.payload), 'message')
      return
    }

    remember(event)
  }, [isMessageOpen, profileFor, remember, user?.id])

  const reconcile = useCallback(async (presentNew: boolean) => {
    if (!user || processingRef.current) return
    processingRef.current = true
    try {
      const storedRecent = readRecent()
      storedRecent.forEach(id => recentIdsRef.current.add(id))
      cursorRef.current = cursorRef.current || readCursor()

      let query = supabase
        .from('notification_events')
        .select('id,recipient_id,actor_id,event_type,priority,source_table,source_id,entity_id,deep_link,payload,created_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: true })
        .limit(200)

      if (cursorRef.current) query = query.gt('created_at', cursorRef.current)

      const { data, error } = await query
      if (error) {
        console.warn('Yomy event reconciliation failed:', error.message)
        return
      }

      const events = (data || []) as YomyEvent[]
      if (!events.length && !cursorRef.current) {
        const { data: latest } = await supabase
          .from('notification_events')
          .select('id,created_at')
          .eq('recipient_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
        if (latest?.[0]?.created_at) {
          cursorRef.current = latest[0].created_at
          writeCursor(latest[0].created_at)
        }
        return
      }

      for (const event of events) {
        if (presentNew) await present(event)
        else remember(event)
      }
    } finally {
      processingRef.current = false
    }
  }, [present, remember, user])

  useEffect(() => {
    if (!user) return
    recentIdsRef.current = readRecent()
    cursorRef.current = readCursor()

    void reconcile(Boolean(cursorRef.current))

    const onOnline = () => void reconcile(true)
    const onVisibility = () => { if (document.visibilityState === 'visible') void reconcile(true) }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)

    const channel = supabase
      .channel(`yomy-event-engine-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notification_events',
        filter: `recipient_id=eq.${user.id}`,
      }, payload => { void present(payload.new as YomyEvent) })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') void reconcile(true)
      })

    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      void supabase.removeChannel(channel)
    }
  }, [present, reconcile, user])

  return null
}
