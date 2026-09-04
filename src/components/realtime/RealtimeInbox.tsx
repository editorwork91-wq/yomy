import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { showYomyLocalNotification } from '@/lib/localNotification'

export default function RealtimeInbox() {
  const { user } = useAuth()
  const location = useLocation()
  const soundRef = useRef<AudioContext | null>(null)
  const notifiedMessageIds = useRef(new Set<string>())

  const ping = () => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = soundRef.current || new AudioCtx()
      soundRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.025
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.055)
    } catch {
      // Optional; browsers may block programmatic audio.
    }
  }

  useEffect(() => {
    if (!user) return

    void supabase.rpc('mark_all_messages_delivered').then(({ error }) => {
      if (error) console.error('queued message delivery reconciliation failed:', error.message)
    })

    const currentChat = location.pathname.match(/^\/messages\/([^/]+)/)?.[1]
    const channel = supabase
      .channel(`realtime-inbox-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        async ({ new: rawMessage }) => {
          const message = rawMessage as {
            id: string
            sender_id: string
            content?: string | null
            media_type?: '' | 'image' | 'video' | 'audio' | null
            deleted_for_everyone?: boolean
          }
          if (message.deleted_for_everyone) return

          const { error: deliveryError } = await supabase.rpc('mark_message_delivered', { p_message_id: message.id })
          if (deliveryError) console.error('message delivery receipt failed:', deliveryError.message)

          const { data: sender } = await supabase.from('profiles').select('username').eq('id', message.sender_id).maybeSingle()
          const senderName = sender?.username || 'Yomy'
          const inCurrentChat = sender?.username === currentChat
          if (inCurrentChat) return

          ping()
          if (!notifiedMessageIds.current.has(message.id)) {
            notifiedMessageIds.current.add(message.id)
            if (notifiedMessageIds.current.size > 500) {
              const oldest = notifiedMessageIds.current.values().next().value
              if (oldest) notifiedMessageIds.current.delete(oldest)
            }

            const body = message.media_type === 'audio'
              ? '🎙️ Voice message'
              : message.media_type === 'video'
                ? '🎬 Video message'
                : message.media_type === 'image'
                  ? '📷 Photo'
                  : (message.content?.trim() || 'New message')
            showYomyLocalNotification(senderName, body, 'message')
          }
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user, location.pathname])

  return null
}
