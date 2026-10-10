import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, ChevronRight, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'

type Attention = {
  title: string
  body: string
  url: string
  kind: 'message' | 'call'
}

const DISMISSED_UNREAD_PREFIX = 'yomy:attention:unread:'

function readDismissed(userId: string) {
  try { return localStorage.getItem(DISMISSED_UNREAD_PREFIX + userId) || '' } catch { return '' }
}

function writeDismissed(userId: string, value: string) {
  try { localStorage.setItem(DISMISSED_UNREAD_PREFIX + userId, value) } catch {}
}

export default function AttentionCenter() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [attention, setAttention] = useState<Attention | null>(null)
  const [unreadSummary, setUnreadSummary] = useState<string | null>(null)
  const [dragX, setDragX] = useState(0)
  const timerRef = useRef<number | null>(null)
  const dragRef = useRef<{ startX: number; active: boolean }>({ startX: 0, active: false })

  const clearAttention = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
    setAttention(null)
    setDragX(0)
  }, [])

  const scheduleClear = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(clearAttention, 5200)
  }, [clearAttention])

  const refreshUnread = useCallback(async () => {
    if (!user || !navigator.onLine) return
    const { data, error } = await supabase
      .from('notifications')
      .select('id,created_at')
      .eq('user_id', user.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return

    const latest = data?.[0]
    if (!latest) {
      setUnreadSummary(null)
      return
    }

    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    const unreadCount = count || 1
    const fingerprint = String(latest.id) + ':' + String(unreadCount)
    if (readDismissed(user.id) === fingerprint) return

    const summary = unreadCount + ' unread notification' + (unreadCount === 1 ? '' : 's')
    setUnreadSummary(summary)
    window.setTimeout(() => setUnreadSummary(current => current === summary ? null : current), 5200)
  }, [user])

  useEffect(() => {
    if (!user) return
    void refreshUnread()
    const onOnline = () => void refreshUnread()
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshUnread() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshUnread, user])

  useEffect(() => {
    const onAttention = (event: Event) => {
      if (!user || document.visibilityState !== 'visible') return
      const detail = (event as CustomEvent<Partial<Attention>>).detail
      if (!detail?.title || !detail?.body) return
      const targetPath = (detail.url || '').split('?')[0]
      if (targetPath && location.pathname === targetPath) return

      clearAttention()
      setUnreadSummary(null)
      setAttention({
        title: detail.title,
        body: detail.body,
        url: detail.url || '/notifications',
        kind: detail.kind === 'call' ? 'call' : 'message',
      })
      scheduleClear()
      void refreshUnread()
    }

    window.addEventListener('yomy-attention', onAttention)
    return () => window.removeEventListener('yomy-attention', onAttention)
  }, [clearAttention, location.pathname, refreshUnread, scheduleClear, user])

  const dismissUnreadSummary = async () => {
    if (!user || !unreadSummary) return
    const { data } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(1)
    const countMatch = unreadSummary.match(/^(\d+)/)
    writeDismissed(user.id, String(data?.[0]?.id || '') + ':' + (countMatch?.[1] || '1'))
    setUnreadSummary(null)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    dragRef.current = { startX: event.clientX, active: true }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragRef.current.active) return
    setDragX(event.clientX - dragRef.current.startX)
  }

  const onPointerUp = () => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    if (Math.abs(dragX) > 90) clearAttention()
    else setDragX(0)
  }

  if (!user) return null

  return (
    <>
      {attention && (
        <div
          className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 right-3 z-[130] flex justify-center pointer-events-none"
          style={{ transform: 'translate3d(' + dragX + 'px,0,0)' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="pointer-events-auto w-full max-w-md rounded-[1.35rem] border border-white/15 bg-background/82 backdrop-blur-2xl shadow-[0_20px_70px_rgba(0,0,0,.28)] ring-1 ring-black/5 overflow-hidden">
            <div className="flex items-center gap-3 px-3.5 py-3">
              <button
                className="min-w-0 flex-1 flex items-center gap-3 text-left active:scale-[.99] transition-transform"
                onClick={() => { const url = attention.url; clearAttention(); navigate(url) }}
              >
                <div className="size-10 shrink-0 rounded-2xl bg-primary/12 flex items-center justify-center shadow-inner">
                  <Bell className="size-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{attention.title}</p>
                  <p className="text-[12px] text-muted-foreground truncate mt-0.5">{attention.body}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full" onClick={clearAttention} aria-label="Dismiss">
                <X className="size-4" />
              </Button>
            </div>
            <div className="h-0.5 bg-gradient-to-r from-primary/60 via-primary/20 to-transparent" />
          </div>
        </div>
      )}

      {unreadSummary && !attention && (
        <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 right-3 z-[129] flex justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-md rounded-[1.25rem] border border-white/15 bg-background/78 backdrop-blur-2xl shadow-[0_18px_60px_rgba(0,0,0,.22)] flex items-center gap-3 px-3.5 py-3">
            <div className="size-9 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Bell className="size-4 text-primary" />
            </div>
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => { void dismissUnreadSummary(); navigate('/notifications') }}
            >
              <p className="text-sm font-semibold">You have something to catch up on</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{unreadSummary} · tap to review</p>
            </button>
            <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => void dismissUnreadSummary()} aria-label="Dismiss">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
