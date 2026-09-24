import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { readQueuedMessages, removeQueuedMessage } from '@/lib/offlineStore'
import { sendPushEvent } from '@/lib/push'

let syncingGlobal = false

export default function MessageSyncEngine() {
  const { user } = useAuth()
  const online = useNetworkStatus()
  const [queued, setQueued] = useState(0)
  const mounted = useRef(true)

  const sync = useCallback(async () => {
    if (!user || !online || syncingGlobal) return
    syncingGlobal = true
    try {
      const items = await readQueuedMessages(user.id)
      if (!items.length) {
        if (mounted.current) setQueued(0)
        return
      }
      if (mounted.current) setQueued(items.length)

      for (let i = 0; i < items.length; i += 4) {
        const batch = items.slice(i, i + 4)
        await Promise.all(batch.map(async item => {
          const { data, error } = await supabase.from('messages').upsert({
            sender_id: user.id,
            receiver_id: item.otherUserId,
            content: item.content,
            media_url: '',
            media_type: '',
            is_encrypted: true,
            view_once: false,
            reply_to_id: item.replyToId,
            created_at: item.createdAt,
            client_message_id: item.clientMessageId,
          }, { onConflict: 'sender_id,client_message_id' }).select('id,receiver_id').single()

          if (!error && data) {
            await removeQueuedMessage(user.id, item.clientMessageId)
            void sendPushEvent({
              type: 'message',
              targetUserId: item.otherUserId,
              title: String(user.user_metadata?.username || 'Yomy'),
              body: item.content,
              data: { message_id: data.id, url: '/messages' },
            })
            window.dispatchEvent(new CustomEvent('yomy-message-synced', {
              detail: { clientMessageId: item.clientMessageId, messageId: data.id, otherUserId: item.otherUserId }
            }))
          }
        }))
      }

      const left = await readQueuedMessages(user.id)
      if (mounted.current) setQueued(left.length)
      window.dispatchEvent(new CustomEvent('yomy-message-queue-changed', { detail: { count: left.length } }))
    } finally {
      syncingGlobal = false
    }
  }, [online, user])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!user) return
    const refreshCount = () => { void readQueuedMessages(user.id).then(items => mounted.current && setQueued(items.length)) }
    refreshCount()
    if (online) void sync()
    const onOnline = () => void sync()
    const onQueueChanged = () => refreshCount()
    window.addEventListener('online', onOnline)
    window.addEventListener('yomy-message-queue-changed', onQueueChanged)
    const timer = window.setInterval(() => { if (navigator.onLine) void sync() }, 2000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('yomy-message-queue-changed', onQueueChanged)
      window.clearInterval(timer)
    }
  }, [online, sync, user])

  return queued > 0 && online ? (
    <div className="fixed left-1/2 top-2 z-[120] -translate-x-1/2 pointer-events-none">
      <div className="rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-[10px] text-muted-foreground shadow-lg backdrop-blur-xl">
        Syncing {queued} message{queued === 1 ? '' : 's'}…
      </div>
    </div>
  ) : null
}
