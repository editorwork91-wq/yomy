import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Post } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import StoryBar from '@/components/stories/StoryBar'
import FedoPreviewStrip from '@/components/fedo/FedoPreviewStrip'
import PostCard from '@/components/posts/PostCard'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Camera } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { cacheFeed, readCachedFeed } from '@/lib/offlineStore'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

export default function Feed() {
  const { user } = useAuth()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const online = useNetworkStatus()
  const PAGE_SIZE = 10
  const fetchPosts = useCallback(async (pageNum: number) => {
    if (!user) return
    if (pageNum === 0) {
      const cached = await readCachedFeed<Post>(user.id)
      if (cached?.length) {
        setPosts(cached)
        setLoading(false)
      }
    }
    if (!online) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data: followData, error: followError } = await supabase.from('follows').select('following_id').eq('follower_id', user.id).eq('status', 'accepted')
    if (followError) console.error('Feed follows failed:', followError.message)
    const followingIds = followData?.map(f => f.following_id) || []
    const feedIds = [user.id, ...followingIds]
    const { data, error } = await supabase.from('posts').select(`*, profiles!user_id(id, username, full_name, avatar_url, is_verified), likes(user_id), comments(id), post_tags(tag), saved_posts!left(post_id)`).in('user_id', feedIds).eq('status', 'published').order('published_at', { ascending: false }).range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)
    if (error) { console.error('Feed posts failed:', error.message); if (pageNum === 0) setPosts([]); setHasMore(false); setLoading(false); return }
    const enriched = (data || []).map(p => ({ ...p, _likes_count: p.likes?.length || 0, _comments_count: p.comments?.length || 0, _liked_by_me: p.likes?.some((l: { user_id: string }) => l.user_id === user.id) || false, _saved_by_me: p.saved_posts?.some((s: { post_id: string }) => s.post_id === p.id) || false, _tags: p.post_tags?.map((t: { tag: string }) => t.tag) || [] }))
    if (pageNum === 0) { setPosts(enriched); await cacheFeed(user.id, enriched) } else setPosts(prev => [...prev, ...enriched])
    setHasMore(enriched.length === PAGE_SIZE); setLoading(false)
  }, [online, user])

  const refreshHome = useCallback(async () => { setPage(0); setHasMore(true); await fetchPosts(0) }, [fetchPosts])
  const { pullDistance, refreshing } = usePullToRefresh(refreshHome)

  useEffect(() => { setPage(0); void fetchPosts(0) }, [fetchPosts])
  useEffect(() => { const handleScroll = () => { if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 300 && hasMore && !loading) { const nextPage = page + 1; setPage(nextPage); void fetchPosts(nextPage) } }; window.addEventListener('scroll', handleScroll); return () => window.removeEventListener('scroll', handleScroll) }, [hasMore, loading, page, fetchPosts])

  return <div className="pb-20 relative"><div className="fixed left-1/2 top-14 z-30 -translate-x-1/2 pointer-events-none transition-opacity" style={{ opacity: pullDistance > 5 ? 1 : 0, transform: `translate(-50%, ${Math.min(36, pullDistance * .45)}px)` }}><div className="rounded-full border bg-background/85 px-3 py-1.5 text-[10px] shadow-lg backdrop-blur-xl">{refreshing ? 'Refreshing…' : pullDistance > 58 ? 'Release to refresh' : 'Pull to refresh'}</div></div><TopBar showLogo/><div className="max-w-lg mx-auto"><StoryBar/><FedoPreviewStrip/><Separator/>{loading && posts.length === 0 ? <div className="flex items-center justify-center h-40"><Spinner className="size-6"/></div> : posts.length === 0 ? <Empty className="mt-12"><EmptyHeader><EmptyMedia variant="icon"><Camera className="size-6"/></EmptyMedia><EmptyTitle>Your feed is empty</EmptyTitle><EmptyDescription>Follow people to see their posts here. <Link to="/explore" className="text-primary">Explore</Link> to find accounts.</EmptyDescription></EmptyHeader></Empty> : <>{posts.map(post => <PostCard key={post.id} post={post} onDeleted={id => setPosts(ps => ps.filter(p => p.id !== id))}/>)}{loading && <div className="flex items-center justify-center h-16"><Spinner className="size-5"/></div>}{!hasMore && posts.length > 0 && <p className="text-center text-sm text-muted-foreground py-8">You're all caught up!</p>}</>}</div></div>
}
