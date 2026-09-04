import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type Reminder = { id: string; title: string; body: string; remind_at: string; status: 'scheduled' | 'fired' | 'cancelled' }

const POLL_MS = 30_000
const MAX_SCHEDULED = 64

export async function scheduleYomyReminder(input: { title: string; body?: string; remindAt: Date | string }): Promise<string | null> {
  const remindAt = new Date(input.remindAt)
  if (!Number.isFinite(remindAt.getTime()) || remindAt.getTime() <= Date.now()) throw new Error('Reminder time must be in the future')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('You must be signed in to schedule a reminder')
  const { data, error } = await supabase.from('yomy_reminders').insert({ user_id: user.id, title: input.title.trim(), body: input.body?.trim() || '', remind_at: remindAt.toISOString() }).select('id').single()
  if (error) throw error
  return data?.id || null
}

export async function cancelYomyReminder(id: string): Promise<void> {
  const { error } = await supabase.from('yomy_reminders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'scheduled')
  if (error) throw error
}

export default function YomyReminderEngine() {
  const { user } = useAuth()
  const timersRef = useRef<Map<string, number>>(new Map())

  const fireDue = useCallback(async () => {
    if (!user) return
    const { error } = await supabase.rpc('fire_due_yomy_reminders')
    if (error) console.warn('Yomy reminder firing failed:', error.message)
  }, [user])

  const scheduleUpcoming = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase.from('yomy_reminders').select('id,title,body,remind_at,status').eq('user_id', user.id).eq('status', 'scheduled').gte('remind_at', new Date().toISOString()).order('remind_at', { ascending: true }).limit(MAX_SCHEDULED)
    if (error) return
    const liveIds = new Set((data || []).map(row => row.id))
    for (const [id, timer] of timersRef.current) {
      if (!liveIds.has(id)) { window.clearTimeout(timer); timersRef.current.delete(id) }
    }
    for (const reminder of (data || []) as Reminder[]) {
      if (timersRef.current.has(reminder.id)) continue
      const delay = Math.max(0, new Date(reminder.remind_at).getTime() - Date.now())
      const timer = window.setTimeout(() => {
        timersRef.current.delete(reminder.id)
        void fireDue()
        window.setTimeout(() => void scheduleUpcoming(), 250)
      }, Math.min(delay, 2_147_000_000))
      timersRef.current.set(reminder.id, timer)
    }
  }, [fireDue, user])

  useEffect(() => {
    if (!user) return
    void fireDue()
    void scheduleUpcoming()
    const interval = window.setInterval(() => { void fireDue(); void scheduleUpcoming() }, POLL_MS)
    const onVisibility = () => { if (document.visibilityState === 'visible') { void fireDue(); void scheduleUpcoming() } }
    window.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('visibilitychange', onVisibility)
      for (const timer of timersRef.current.values()) window.clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [fireDue, scheduleUpcoming, user])

  return null
}
