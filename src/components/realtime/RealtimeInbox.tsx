import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cacheConversations, readCachedConversations } from '@/lib/offlineStore'

export default function RealtimeInbox() {
  const { user } = useAuth()
  const location = useLocation()
  const ping = () => {
    try {
      window.dispatchEvent(new CustomEvent('yomy-attention', { detail: { title: 'New message', body: 'You have a new message', url: '/messages', kind: 'message' } }))
    } catch {}
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
          ping()
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user, location.pathname])

  return null
}
