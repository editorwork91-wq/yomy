import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MessageCircle, Heart, MessageSquare, UserPlus, Bell } from 'lucide-react'
import { toast } from 'sonner'
import type { Notification, Profile } from '@/lib/supabase'

type Actor = Pick<Profile, 'username' | 'full_name' | 'avatar_url'>

const notificationText = (type: Notification['type']) => {
  switch (type) {
    case 'like': return 'liked your post'
    case 'comment': return 'commented on your post'
    case 'follow': return 'started following you'
    case 'follow_request': return 'requested to follow you'
    case 'mention': return 'mentioned you'
    case 'story_reply': return 'replied to your story'
    case 'message': return 'sent you a message'
    default: return 'interacted with you'
  }
}

const notificationIcon = (type: Notification['type']) => {
  if (type === 'like') return <Heart className="size-4 fill-current text-red-500" />
  if (type === 'comment' || type === 'message') return <MessageSquare className="size-4 text-primary" />
  if (type === 'follow' || type === 'follow_request') return <UserPlus className="size-4 text-emerald-500" />
  return <Bell className="size-4" />
}

export default function RealtimeInbox() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const soundRef = useRef<AudioContext | null>(null)

  const ping = () => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = soundRef.current || new AudioCtx()
      soundRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.035
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.055)
    } catch {
      // Audio is optional and can be blocked by the browser.
    }
  }

  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`realtime-inbox-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        async ({ new: rawMessage }) => {
          const message = rawMessage as { id: string; sender_id: string; content: string; media_type: string; media_url: string }
          const currentChat = location.pathname.match(/^\/messages\/([^/]+)/)?.[1]

          const { data: sender } = await supabase
            .from('profiles')
            .select('username, full_name, avatar_url')
            .eq('id', message.sender_id)
            .maybeSingle()

          if (!sender || currentChat === sender.username) return
          ping()

          const preview = message.content?.trim()
            || (message.media_type === 'audio' ? '🎤 Voice message' : message.media_type === 'video' ? '🎬 Video' : message.media_url ? '📷 Photo' : 'New message')

          toast.custom((id) => (
            <button
              type="button"
              onClick={() => {
                toast.dismiss(id)
                navigate(`/messages/${sender.username}`)
              }}
              className="w-[min(380px,calc(100vw-24px))] text-left rounded-2xl border bg-background/95 shadow-xl backdrop-blur p-3 flex items-center gap-3 hover:bg-accent transition-colors"
            >
              <Avatar className="size-11 shrink-0">
                <AvatarImage src={sender.avatar_url} />
                <AvatarFallback>{sender.username?.[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{sender.username}</span>
                  <MessageCircle className="size-4 text-primary shrink-0" />
                </div>
                <p className="text-sm text-muted-foreground truncate mt-0.5">{preview}</p>
              </div>
            </button>
          ), { duration: 5000 })
        }
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        async ({ new: rawNotification }) => {
          const n = rawNotification as Notification
          if (n.type === 'message') return

          const { data: actor } = await supabase
            .from('profiles')
            .select('username, full_name, avatar_url')
            .eq('id', n.actor_id)
            .maybeSingle()
          if (!actor) return

          ping()
          const destination = n.type === 'follow' || n.type === 'follow_request' || n.type === 'mention' || n.type === 'story_reply'
            ? `/profile/${actor.username}`
            : n.post_id ? `/` : '/notifications'

          toast.custom((id) => (
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(id)
                await supabase.from('notifications').update({ is_read: true }).eq('id', n.id).eq('user_id', user.id)
                navigate(destination)
              }}
              className="w-[min(380px,calc(100vw-24px))] text-left rounded-2xl border bg-background/95 shadow-xl backdrop-blur p-3 flex items-center gap-3 hover:bg-accent transition-colors"
            >
              <div className="relative shrink-0">
                <Avatar className="size-11">
                  <AvatarImage src={(actor as Actor).avatar_url} />
                  <AvatarFallback>{(actor as Actor).username?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="absolute -right-1 -bottom-1 rounded-full bg-background border p-1">{notificationIcon(n.type)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{(actor as Actor).username}</span>{' '}
                  <span className="text-muted-foreground">{notificationText(n.type)}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Tap to open</p>
              </div>
            </button>
          ), { duration: 4500 })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, navigate, location.pathname])

  return null
}
