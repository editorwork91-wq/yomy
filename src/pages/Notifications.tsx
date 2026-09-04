import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { Heart, UserPlus, MessageCircle, Bell, Check, X, Image, PlaySquare } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { sendLatestActivityPush } from '@/lib/push'

export default function Notifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const fetchNotifications = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase.from('notifications').select('*, actor:profiles!actor_id(id, username, full_name, avatar_url, is_verified), post:posts!post_id(id, media_url, media_type), story:stories!story_id(id, media_url, media_type)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
    if (error) console.error('Notifications load failed:', error.message)
    setNotifications(data || [])
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    setLoading(false)
  }, [user])
  useEffect(() => { void fetchNotifications() }, [fetchNotifications])

  const acceptFollow = async (actorId: string, notificationId: string) => {
    if (!user || actionLoading) return
    setActionLoading(notificationId); setActionMessage(null)
    const { error } = await supabase.rpc('accept_follow_request', { p_follower_id: actorId })
    if (error) { console.error('Accept follow failed:', error.message); setActionMessage(`Could not accept request: ${error.message}`); setActionLoading(null); return }
    setNotifications(prev => prev.filter(n => n.id !== notificationId))
    void sendLatestActivityPush({ targetUserId: actorId, actorId: user.id, type: 'follow' })
    setActionMessage('Follow request accepted'); setActionLoading(null)
  }

  const declineFollow = async (actorId: string, notificationId: string) => {
    if (!user || actionLoading) return
    setActionLoading(notificationId); setActionMessage(null)
    const { error } = await supabase.rpc('reject_follow_request', { p_follower_id: actorId })
    if (error) { console.error('Decline follow failed:', error.message); setActionMessage(`Could not decline request: ${error.message}`); setActionLoading(null); return }
    setNotifications(prev => prev.filter(n => n.id !== notificationId)); setActionMessage('Follow request declined'); setActionLoading(null)
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'like': return <Heart className="size-3 text-red-500 fill-current" />
      case 'comment': case 'comment_like': return <MessageCircle className="size-3 text-blue-500 fill-current" />
      case 'follow': case 'follow_request': return <UserPlus className="size-3 text-green-500 fill-current" />
      case 'post': return <Image className="size-3 text-primary" />
      case 'story': return <PlaySquare className="size-3 text-primary" />
      default: return <Bell className="size-3" />
    }
  }
  const getMessage = (n: Notification) => {
    switch (n.type) {
      case 'like': return 'liked your post'; case 'comment': return 'commented on your post'; case 'comment_like': return 'liked your comment'; case 'follow': return 'started following you'; case 'follow_request': return 'requested to follow you'; case 'mention': return 'mentioned you'; case 'story_reply': return 'replied to your story'; case 'story': return 'added a new story'; case 'post': return 'published a new post'; case 'message': return 'sent you a message'; default: return 'interacted with you'
    }
  }

  return <div className="pb-20"><TopBar title="Notifications"/><div className="max-w-lg mx-auto">{actionMessage && <p className="px-4 py-2 text-center text-xs text-muted-foreground" role="status">{actionMessage}</p>}{loading ? <div className="flex items-center justify-center h-40"><Spinner className="size-6"/></div> : notifications.length === 0 ? <Empty className="mt-12"><EmptyHeader><EmptyMedia variant="icon"><Bell className="size-6"/></EmptyMedia><EmptyTitle>No notifications yet</EmptyTitle><EmptyDescription>Activity from people you follow will show up here.</EmptyDescription></EmptyHeader></Empty> : <div className="divide-y divide-border">{notifications.map(n => <div key={n.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50"><Link to={`/profile/${n.actor?.username}`} className="relative shrink-0"><Avatar className="size-12"><AvatarImage src={n.actor?.avatar_url}/><AvatarFallback>{n.actor?.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar><div className="absolute -bottom-0.5 -right-0.5 bg-card rounded-full size-5 flex items-center justify-center ring-2 ring-card">{getIcon(n.type)}</div></Link><div className="flex-1 min-w-0"><Link to={n.type === 'message' && n.actor?.username ? `/messages/${n.actor.username}` : n.post?.id ? `/?post=${n.post.id}${n.comment_id ? `&comment=${n.comment_id}` : ''}` : n.type === 'story' || n.type === 'story_reply' ? `/notifications?story=${n.story_id || ''}` : `/profile/${n.actor?.username}`}><p className="text-sm"><span className="font-semibold">{n.actor?.username}</span>{' '}<span className="text-muted-foreground">{getMessage(n)}</span></p><p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p></Link></div>{n.type === 'follow_request' && <div className="flex items-center gap-1 shrink-0"><Button size="icon-sm" onClick={() => void acceptFollow(n.actor_id, n.id)} disabled={actionLoading === n.id}><Check className="size-4"/></Button><Button size="icon-sm" variant="outline" onClick={() => void declineFollow(n.actor_id, n.id)} disabled={actionLoading === n.id}><X className="size-4"/></Button></div>}{n.post?.media_url && !['follow_request','follow'].includes(n.type) && <img src={n.post.media_url} alt="" className="size-10 object-cover rounded" loading="lazy"/>}{n.story?.media_url && n.type === 'story' && <img src={n.story.media_url} alt="" className="size-10 object-cover rounded" loading="lazy"/>}</div>)}</div>}</div><BottomNav/></div>
}
