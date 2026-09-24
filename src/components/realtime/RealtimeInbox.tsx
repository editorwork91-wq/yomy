import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cacheConversations, readCachedConversations } from '@/lib/offlineStore'

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

          const { data: sender } = await supabase.from('profiles').select('id,username,full_name,avatar_url,is_verified').eq('id', message.sender_id).maybeSingle()
          const senderName = sender?.username || 'Yomy'
          const inCurrentChat = sender?.username === currentChat

          const cached = (await readCachedConversations<{
            user: { id: string; username: string; full_name: string; avatar_url: string; is_verified: boolean }
            lastMessage: unknown
            unreadCount: number
            archived: boolean
            muted: boolean
          }>(user.id)) || []
          const existingIndex = cached.findIndex(item => item.user.id === message.sender_id)
          const safeMessage = {
            ...message,
            sender: sender || undefined,
            receiver_id: user.id,
          }
          const nextConversation = existingIndex >= 0
            ? cached.map((item, index) => index === existingIndex ? {
                ...item,
                lastMessage: safeMessage,
                unreadCount: inCurrentChat ? item.unreadCount : item.unreadCount + 1,
              } : item)
            : sender ? [{
                user: sender,
                lastMessage: safeMessage,
                unreadCount: inCurrentChat ? 0 : 1,
                archived: false,
                muted: false,
              }, ...cached] : cached
          await cacheConversations(user.id, nextConversation)

          if (inCurrentChat) return
          ping()
          void notifiedMessageIds.current
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user, location.pathname])

  return null
}
