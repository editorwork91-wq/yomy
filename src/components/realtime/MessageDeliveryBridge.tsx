import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export default function MessageDeliveryBridge() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    const markAll = () => {
      if (!navigator.onLine) return
      void supabase.rpc('mark_all_messages_delivered').then(({ error }) => {
        if (error) console.warn('message delivery reconciliation failed:', error.message)
      })
    }

    markAll()
    const onOnline = () => markAll()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') markAll()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)

    const channel = supabase
      .channel(`message-delivery-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        payload => {
          const message = payload.new as { id?: string }
          if (!message.id) return
          void supabase.rpc('mark_message_delivered', { p_message_id: message.id }).then(({ error }) => {
            if (error) console.warn('message delivery receipt failed:', error.message)
          })
        },
      )
      .subscribe()

    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      void supabase.removeChannel(channel)
    }
  }, [user])

  return null
}
