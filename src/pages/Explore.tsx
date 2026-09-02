import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Post, Profile as ProfileType } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Search, Film, UserPlus, UserCheck } from 'lucide-react'

export default function Explore() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [users, setUsers] = useState<ProfileType[]>([])
  const [loading, setLoading] = useState(true)
  const [searchPosts, setSearchPosts] = useState<Post[]>([])
  const [searching, setSearching] = useState(false)
  const [followStates, setFollowStates] = useState<Record<string, 'accepted' | 'pending' | 'none'>>({})
  const [suggested, setSuggested] = useState<ProfileType[]>([])

  const fetchExplore = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('posts')
      .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified, is_private), likes(user_id), post_tags(tag)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(60)
    if (error) console.error('Explore posts failed:', error.message)
    setPosts((data || []).map(p => ({
      ...p,
      _likes_count: p.likes?.length || 0,
      _liked_by_me: p.likes?.some((l: { user_id: string }) => l.user_id === user?.id) || false,
      _tags: p.post_tags?.map((t: { tag: string }) => t.tag) || [],
    })))
    setLoading(false)
  }, [user])

  const fetchSuggested = useCallback(async () => {
    if (!user) return
    const { data: follows } = await supabase.from('follows').select('following_id,status').eq('follower_id', user.id)
    const followingIds = (follows || []).map(f => f.following_id)
    const states: Record<string, 'accepted' | 'pending' | 'none'> = {}
    ;(follows || []).forEach(f => { states[f.following_id] = f.status })
    setFollowStates(states)
    const excluded = [user.id, ...followingIds]
    const filter = excluded.length ? `(${excluded.join(',')})` : '()'
    const { data: suggestions, error } = await supabase.from('profiles').select('*').not('id', 'in', filter).limit(10)
    if (error) console.error('Suggestions failed:', error.message)
    setSuggested(suggestions || [])
  }, [user])

  useEffect(() => {
    fetchExplore()
    fetchSuggested()
  }, [fetchExplore, fetchSuggested])

  const handleSearch = async () => {
    const term = query.trim()
    if (!term) {
      setUsers([])
      setSearchPosts([])
      return
    }
    setSearching(true)
    const [{ data: userData }, { data: tagPosts }, { data: textPosts }] = await Promise.all([
      supabase.from('profiles').select('*').or(`username.ilike.%${term}%,full_name.ilike.%${term}%`).limit(20),
      supabase.from('post_tags').select('post_id, posts!inner(id, media_url, media_type, status, user_id, profiles!user_id(username, avatar_url))').ilike('tag', `%${term}%`).eq('posts.status', 'published').limit(20),
      supabase.from('posts').select('id, media_url, media_type, status, user_id, profiles!user_id(username, avatar_url)').or(`title.ilike.%${term}%,description.ilike.%${term}%,caption.ilike.%${term}%`).eq('status', 'published').limit(20),
    ])
    setUsers(userData || [])
    const merged: Post[] = []
    const seen = new Set<string>()
    for (const row of tagPosts || []) {
      const p = row.posts as unknown as Post
      if (p?.id && !seen.has(p.id)) { seen.add(p.id); merged.push(p) }
    }
    for (const p of textPosts || []) {
      if (p?.id && !seen.has(p.id)) { seen.add(p.id); merged.push(p as unknown as Post) }
    }
    setSearchPosts(merged)
    setSearching(false)
  }

  const handleFollow = async (targetId: string) => {
    if (!user) return
    const { data, error } = await supabase.rpc('follow_user', { p_target_id: targetId })
    if (error) {
      console.error('Follow failed:', error.message)
      return
    }
    setFollowStates(s => ({ ...s, [targetId]: data as 'accepted' | 'pending' }))
    setSuggested(prev => prev.filter(p => p.id !== targetId))
  }

  return (
    <div className="pb-20">
      <TopBar title="Explore" />
      <div className="max-w-lg mx-auto">
        <div className="px-4 py-3 sticky top-14 bg-background z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Search users..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="pl-9" />
          </div>
        </div>
        {query.trim() ? (
          <div className="px-4">
            {searching ? <div className="flex justify-center py-8"><Spinner className="size-5" /></div> : <>
              {users.length > 0 && <><h2 className="text-sm font-semibold text-muted-foreground mb-2">Users</h2>{users.map(u => <Link key={u.id} to={`/profile/${u.username}`} className="flex items-center gap-3 py-2 px-2 rounded-lg"><Avatar className="size-12"><AvatarImage src={u.avatar_url} /><AvatarFallback>{u.username[0]?.toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0"><p className="text-sm font-medium truncate">{u.username}</p><p className="text-xs text-muted-foreground truncate">{u.full_name || u.bio}</p></div></Link>)}</>}
              {searchPosts.length > 0 && <><h2 className="text-sm font-semibold text-muted-foreground mb-2 mt-4">Posts</h2><div className="grid grid-cols-3 gap-0.5">{searchPosts.map(post => <Link key={post.id} to={`/profile/${post.profiles?.username}`} className="aspect-square relative"><img src={post.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />{post.media_type === 'video' && <Film className="absolute top-1 right-1 size-4 text-white fill-current" />}</Link>)}</div></>}
              {users.length === 0 && searchPosts.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">No results found</p>}
            </>}
          </div>
        ) : (
          <Tabs defaultValue="discover">
            <TabsList className="w-full justify-around rounded-none border-b bg-transparent h-12 p-0"><TabsTrigger value="discover" className="flex-1">Discover</TabsTrigger><TabsTrigger value="suggested" className="flex-1">Suggested</TabsTrigger></TabsList>
            <TabsContent value="discover">
              {loading ? <div className="flex justify-center h-40 items-center"><Spinner className="size-6" /></div> : posts.length === 0 ? <Empty className="mt-12"><EmptyHeader><EmptyTitle>No posts to explore</EmptyTitle><EmptyDescription>Check back later for more content.</EmptyDescription></EmptyHeader></Empty> : <div className="grid grid-cols-3 gap-0.5">{posts.map(post => <Link key={post.id} to={`/profile/${post.profiles?.username}`} className="aspect-square relative"><img src={post.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />{post.media_type === 'video' && <Film className="absolute top-1 right-1 size-4 text-white fill-current" />}</Link>)}</div>}
            </TabsContent>
            <TabsContent value="suggested">
              {suggested.length === 0 ? <Empty className="mt-12"><EmptyHeader><EmptyTitle>No suggestions yet</EmptyTitle><EmptyDescription>Follow more people to get better suggestions.</EmptyDescription></EmptyHeader></Empty> : <div className="px-4 py-2"><h2 className="text-sm font-semibold text-muted-foreground mb-2">Suggested for you</h2>{suggested.map(u => <div key={u.id} className="flex items-center gap-3 py-3"><Link to={`/profile/${u.username}`}><Avatar className="size-12"><AvatarImage src={u.avatar_url} /><AvatarFallback>{u.username[0]?.toUpperCase()}</AvatarFallback></Avatar></Link><div className="flex-1 min-w-0"><Link to={`/profile/${u.username}`}><p className="text-sm font-medium truncate">{u.username}</p></Link><p className="text-xs text-muted-foreground truncate">{u.full_name || 'Suggested for you'}</p></div>{followStates[u.id] === 'accepted' ? <Button variant="secondary" size="sm" disabled><UserCheck className="size-4 mr-1" />Following</Button> : followStates[u.id] === 'pending' ? <Button variant="secondary" size="sm" disabled>Requested</Button> : <Button size="sm" onClick={() => handleFollow(u.id)}><UserPlus className="size-4 mr-1" />Follow</Button>}</div>)}</div>}
            </TabsContent>
          </Tabs>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
