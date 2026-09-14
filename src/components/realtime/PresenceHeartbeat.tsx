import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

const HEARTBEAT_MS = 20_000

export default function PresenceHeartbeat() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    const beat = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void supabase.rpc('set_presence_heartbeat').then(({ error }) => {
        if (error) console.warn('presence heartbeat failed:', error.message)
      })
    }

    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    const onOnline = () => beat()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat()
    }

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user])

  return null
}
