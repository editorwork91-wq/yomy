import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { sendPushEvent } from '@/lib/push'
import { useAuth } from '@/contexts/AuthContext'
import {
  readQueuedMessages,
  removeQueuedMessage,
  readSyncOperations,
  removeSyncOperation,
} from '@/lib/offlineStore'

function isTransient(error: unknown) {
  const value = error as { message?: string; status?: number } | null
  const message = String(value?.message || '').toLowerCase()
  const status = Number(value?.status || 0)
  return !navigator.onLine || status === 0 || [408, 425, 429].includes(status) || status >= 500 ||
    /failed to fetch|network|timeout|timed out|fetch failed|connection reset|econn|offline|websocket/.test(message)
}

function chatKey(a: string, b: string) {
  return a < b ? { user_low: a, user_high: b } : { user_low: b, user_high: a }
}

export default function OfflineSyncEngine() {
  const { user } = useAuth()
  const runningRef = useRef(false)

  const flush = useCallback(async () => {
    if (!user || !navigator.onLine || runningRef.current) return
    runningRef.current = true
    let changed = false

    try {
      const queuedMessages = await readQueuedMessages(user.id)
      for (const item of queuedMessages) {
        if (!navigator.onLine) break
        const { data, error } = await supabase.from('messages').insert({
          sender_id: user.id,
          receiver_id: item.otherUserId,
          content: item.content,
          media_url: '',
          media_type: '',
          media_bucket: 'messages-private',
          media_path: null,
          is_encrypted: true,
          view_once: false,
          view_once_limit: 0,
          view_once_open_count: 0,
          view_once_opened: false,
          client_message_id: item.clientMessageId,
          reply_to_id: item.replyToId,
          created_at: item.createdAt,
        }).select('*').single()

        let sentMessage = data
        let sendError = error
        if (sendError?.code === '23505') {
          const existing = await supabase.from('messages').select('*').eq('sender_id', user.id).eq('client_message_id', item.clientMessageId).maybeSingle()
          sentMessage = existing.data
          sendError = existing.error
        }

        if (!sendError && sentMessage) {
          await removeQueuedMessage(user.id, item.clientMessageId)
          changed = true
          await sendPushEvent({
            type: 'message',
            targetUserId: item.otherUserId,
            title: user.user_metadata?.username || 'Yomy',
            body: item.content,
            data: { message_id: sentMessage.id, url: '/messages' },
          })
        } else if (sendError && !isTransient(sendError)) {
          await removeQueuedMessage(user.id, item.clientMessageId)
        }
      }

      const operations = await readSyncOperations(user.id)
      for (const operation of operations) {
        if (!navigator.onLine) break
        let error: unknown = null

        if (operation.kind === 'reaction_set') {
          const { messageId, mode, emoji } = operation.payload
          if (mode === 'clear') {
            error = (await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', user.id)).error
          } else if (emoji) {
            error = (await supabase.from('message_reactions').upsert(
              { message_id: messageId, user_id: user.id, emoji },
              { onConflict: 'message_id,user_id' },
            )).error
          }
        } else if (operation.kind === 'chat_shared') {
          error = (await supabase.from('chat_shared_settings').upsert(
            { ...chatKey(user.id, operation.payload.otherUserId), wallpaper: operation.payload.wallpaper, updated_by: user.id },
            { onConflict: 'user_low,user_high' },
          )).error
        } else if (operation.kind === 'chat_personal') {
          const patch = operation.payload.patch
          error = (await supabase.from('chat_preferences').upsert(
            { user_id: user.id, other_user_id: operation.payload.otherUserId, ...patch },
            { onConflict: 'user_id,other_user_id' },
          )).error

          if (!error && typeof patch.muted === 'boolean') {
            const mutedResult = patch.muted
              ? await supabase.from('muted_chats').upsert({ user_id: user.id, muted_user_id: operation.payload.otherUserId })
              : await supabase.from('muted_chats').delete().eq('user_id', user.id).eq('muted_user_id', operation.payload.otherUserId)
            error = mutedResult.error
          }
        }

        if (!error) {
          await removeSyncOperation(user.id, operation.opId)
          changed = true
        } else if (!isTransient(error)) {
          await removeSyncOperation(user.id, operation.opId)
        }
      }
    } finally {
      runningRef.current = false
      if (changed) window.dispatchEvent(new CustomEvent('yomy-sync-complete'))
    }
  }, [user])

  useEffect(() => {
    void flush()
    const onOnline = () => { void flush() }
    const onVisible = () => { if (document.visibilityState === 'visible') void flush() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void flush(), 15000)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [flush])

  return null
}
