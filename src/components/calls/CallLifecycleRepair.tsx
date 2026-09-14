import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type CallSession = {
  id: string
  caller_id: string
  callee_id: string
  status: string
}

/**
 * Small reliability layer around the existing CallProvider.
 * Database status is authoritative; a terminal status also emits a direct
 * hangup signal so the remote WebRTC UI closes immediately even if realtime
 * UPDATE delivery is delayed.
 */
export default function CallLifecycleRepair() {
  const { user } = useAuth()
  const sentRef = useRef(new Set<string>())

  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`call-lifecycle-repair-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions' }, async payload => {
        const call = payload.new as CallSession
        if (!call?.id || call.caller_id !== user.id && call.callee_id !== user.id) return
        if (!['declined', 'missed', 'failed', 'ended'].includes(call.status)) return

        const key = `${call.id}:${call.status}:${user.id}`
        if (sentRef.current.has(key)) return
        sentRef.current.add(key)

        const recipientId = call.caller_id === user.id ? call.callee_id : call.caller_id
        await supabase.from('call_signals').insert({
          call_id: call.id,
          sender_id: user.id,
          recipient_id: recipientId,
          signal_type: 'hangup',
          payload: { reason: call.status, source: 'call_lifecycle_repair' },
        })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
      sentRef.current.clear()
    }
  }, [user])

  return null
}
