import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { showYomyLocalNotification } from '@/lib/localNotification'

export default function CallNotificationBridge() {
  const { user } = useAuth()
  const notifiedCallIds = useRef(new Set<string>())

  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`call-notifications-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${user.id}` },
        async ({ new: rawCall }) => {
          const call = rawCall as { id: string; caller_id: string; callee_id: string; kind: 'voice' | 'video'; status: string }
          if (call.callee_id !== user.id || call.status !== 'ringing' || notifiedCallIds.current.has(call.id)) return
          notifiedCallIds.current.add(call.id)

          const { data: caller } = await supabase.from('profiles').select('username').eq('id', call.caller_id).maybeSingle()
          const callerName = caller?.username || 'Yomy'
          showYomyLocalNotification(callerName, call.kind === 'video' ? 'Incoming video call' : 'Incoming voice call', 'call')
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [user])

  return null
}
