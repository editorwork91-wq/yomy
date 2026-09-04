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
type ActivityBucket = { count: number; actorNames: string[]; timer: number }

const CURSOR_KEY = 'yomy:event-engine:last-created-at'
const RECENT_KEY = 'yomy:event-engine:recent-ids'
const MAX_RECENT = 500
const AGGREGATE_WINDOW_MS = 3000

function readCursor(): string | null {
  try { return localStorage.getItem(CURSOR_KEY) } catch { return null }
}
function writeCursor(value: string) { try { localStorage.setItem(CURSOR_KEY, value) } catch {} }
function readRecent(): Set<string> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string').slice(-MAX_RECENT) : [])
  } catch { return new Set() }
}
function persistRecent(ids: Set<string>) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(Array.from(ids).slice(-MAX_RECENT))) } catch {}
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
function isAggregatable(type: string) {
  return type === 'LIKE_CREATED' || type === 'COMMENT_LIKE_CREATED' || type === 'POST_ACTIVITY' || type === 'STORY_CREATED'
}
function aggregationKey(event: YomyEvent) {
  return `${event.event_type}:${event.entity_id || event.source_id}`
}
function activitySummary(type: string, count: number, names: string[]) {
  const primary = names[0] || 'Someone'
  if (count <= 1) return `${primary} ${type === 'POST_ACTIVITY' ? 'published a new post' : 'interacted with you'}`
  const extra = count - 1
  const noun = type === 'LIKE_CREATED' ? 'likes' : type === 'COMMENT_LIKE_CREATED' ? 'comment likes' : 'new activities'
  return `${primary}${extra > 0 ? ` + ${extra}` : ''} ${noun}`
}

export default function YomyEventEngine() {
  const { user } = useAuth()
  const location = useLocation()
  const recentIdsRef = useRef<Set<string>>(new Set())
  const senderCacheRef = useRef<Map<string, Profile>>(new Map())
  const cursorRef = useRef<string | null>(null)
  const processingRef = useRef(false)
  const bucketsRef = useRef<Map<string, ActivityBucket>>(new Map())
  const timersRef = useRef<Set<number>>(new Set())

  const remember = useCallback((event: YomyEvent) => {
    recentIdsRef.current.add(event.id)
    while (recentIdsRef.current.size > MAX_RECENT) {
      const oldest = recentIdsRef.current.values().next().value as string | undefined
      if (!oldest) break
      recentIdsRef.current.delete(oldest)
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

  const flushBucket = useCallback(async (key: string) => {
    const bucket = bucketsRef.current.get(key)
    if (!bucket) return
    bucketsRef.current.delete(key)
    const [eventType] = key.split(':', 1)
    const title = bucket.actorNames[0] || 'Yomy'
    const body = activitySummary(eventType, bucket.count, bucket.actorNames)
    showYomyLocalNotification(title, body, 'message', '/notifications')
  }, [])

  const queueActivity = useCallback(async (event: YomyEvent, actorName: string) => {
    const key = aggregationKey(event)
    const existing = bucketsRef.current.get(key)
    if (existing) {
      existing.count += 1
      if (actorName && !existing.actorNames.includes(actorName) && existing.actorNames.length < 4) existing.actorNames.push(actorName)
      return
    }
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer)
      void flushBucket(key)
    }, AGGREGATE_WINDOW_MS)
    timersRef.current.add(timer)
    bucketsRef.current.set(key, { count: 1, actorNames: actorName ? [actorName] : [], timer })
  }, [flushBucket])

  const present = useCallback(async (event: YomyEvent) => {
    if (event.recipient_id !== user?.id || recentIdsRef.current.has(event.id)) return
    if (event.event_type === 'MESSAGE_NOTIFICATION') { remember(event); return }

    const actor = await profileFor(event.actor_id)
    const actorName = actor?.username || 'Yomy'
    remember(event)

    if (event.event_type === 'MESSAGE_CREATED') {
      const { error } = await supabase.rpc('mark_message_delivered', { p_message_id: event.source_id })
      if (error) console.warn('Yomy message delivery reconciliation failed:', error.message)
      if (isMessageOpen(actor?.username || null)) return
      showYomyLocalNotification(actorName, messageBody(event.payload), 'message', event.deep_link || '/messages')
      return
    }

    if (event.event_type === 'CALL_INCOMING') {
      const kind = String(event.payload.kind || 'voice')
      showYomyLocalNotification(actorName, kind === 'video' ? 'Incoming video call' : 'Incoming voice call', 'call', event.deep_link || '/messages')
      return
    }

    if (isAggregatable(event.event_type)) {
      await queueActivity(event, actorName)
      return
    }

    if (event.source_table === 'notifications') {
      showYomyLocalNotification(actorName, activityCopy(event.payload), 'message', event.deep_link || '/notifications')
      return
    }
  }, [isMessageOpen, profileFor, queueActivity, remember, user?.id])

  const reconcile = useCallback(async (presentNew: boolean) => {
    if (!user || processingRef.current) return
    processingRef.current = true
    try {
      readRecent().forEach(id => recentIdsRef.current.add(id))
      cursorRef.current = cursorRef.current || readCursor()
      let query = supabase.from('notification_events')
        .select('id,recipient_id,actor_id,event_type,priority,source_table,source_id,entity_id,deep_link,payload,created_at')
        .eq('recipient_id', user.id).order('created_at', { ascending: true }).limit(200)
      if (cursorRef.current) query = query.gt('created_at', cursorRef.current)
      const { data, error } = await query
      if (error) { console.warn('Yomy event reconciliation failed:', error.message); return }
      const events = (data || []) as YomyEvent[]
      if (!events.length && !cursorRef.current) {
        const { data: latest } = await supabase.from('notification_events').select('id,created_at').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(1)
        if (latest?.[0]?.created_at) { cursorRef.current = latest[0].created_at; writeCursor(latest[0].created_at) }
        return
      }
      for (const event of events) {
        if (presentNew) await present(event); else remember(event)
      }
    } finally { processingRef.current = false }
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
    const channel = supabase.channel(`yomy-event-engine-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_events', filter: `recipient_id=eq.${user.id}` }, payload => { void present(payload.new as YomyEvent) })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') void reconcile(true) })
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      timersRef.current.forEach(timer => window.clearTimeout(timer))
      timersRef.current.clear()
      bucketsRef.current.clear()
      void supabase.removeChannel(channel)
    }
  }, [present, reconcile, user])

  return null
}
