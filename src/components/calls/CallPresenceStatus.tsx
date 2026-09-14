import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

type PresenceStatus = 'unknown' | 'online' | 'offline'

export default function CallPresenceStatus({ peerId, onStatus }: { peerId: string | null; onStatus?: (status: PresenceStatus) => void }) {
  const { user } = useAuth()
  const [status, setStatus] = useState<PresenceStatus>('unknown')
  const lastSeenRef = useRef(0)

  useEffect(() => {
    if (!user || !peerId || peerId === user.id) return
    let mounted = true
    const set = (next: PresenceStatus) => {
      if (!mounted) return
      setStatus(next)
      onStatus?.(next)
    }
    const channel = supabase.channel(`call-presence-${peerId}`)
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const online = Object.values(state).some((entries: unknown) => Array.isArray(entries) && entries.some((entry: any) => entry?.user_id === peerId))
        set(online ? 'online' : 'offline')
      })
      .subscribe(async channelStatus => {
        if (channelStatus !== 'SUBSCRIBED') return
        try {
          await channel.track({ user_id: user.id, at: Date.now() })
        } catch {
          // Presence is an optimization; call signaling remains authoritative.
        }
      })
    const heartbeat = window.setInterval(() => {
      lastSeenRef.current = Date.now()
      void channel.track({ user_id: user.id, at: lastSeenRef.current })
    }, 15_000)
    return () => {
      mounted = false
      window.clearInterval(heartbeat)
      void supabase.removeChannel(channel)
    }
  }, [onStatus, peerId, user])

  void status
  return null
}
