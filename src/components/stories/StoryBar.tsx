import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Story, Profile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import StoryViewer from './StoryViewer'
import { useNavigate } from 'react-router-dom'

type StoryGroup = {
  user: Profile
  stories: Story[]
}

export default function StoryBar() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [groups, setGroups] = useState<StoryGroup[]>([])
  const [viewerOpen, setViewerOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState(0)
  const profileIdRef = useRef<string | null>(null)

  const fetchStories = useCallback(async () => {
    if (!profile) return
    profileIdRef.current = profile.id

    const { data } = await supabase
      .from('stories')
      .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified)')
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (!data) return
    if (profileIdRef.current !== profile.id) return

    const { data: viewedData } = await supabase
      .from('story_views')
      .select('story_id')
      .eq('viewer_id', profile.id)

    const viewedIds = new Set(viewedData?.map(v => v.story_id) || [])

    const grouped = new Map<string, StoryGroup>()
    data.forEach(story => {
      const user = story.profiles as unknown as Profile
      if (!grouped.has(user.id)) {
        grouped.set(user.id, { user, stories: [] })
      }
      grouped.get(user.id)!.stories.push({
        ...story,
        _viewed_by_me: viewedIds.has(story.id),
      })
    })

    const groupArray = Array.from(grouped.values())
    groupArray.sort((a, b) => {
      if (a.user.id === profile.id) return -1
      if (b.user.id === profile.id) return 1
      const aAllViewed = a.stories.every(s => s._viewed_by_me)
      const bAllViewed = b.stories.every(s => s._viewed_by_me)
      if (aAllViewed && !bAllViewed) return 1
      if (!aAllViewed && bAllViewed) return -1
      return 0
    })

    setGroups(groupArray)
  }, [profile])

  useEffect(() => {
    fetchStories()
  }, [fetchStories])

  // Realtime: listen for new stories and story deletions
  useEffect(() => {
    const channel = supabase
      .channel('stories-realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'stories' },
        () => fetchStories()
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'stories' },
        () => fetchStories()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchStories])

  const openStory = (idx: number) => {
    setSelectedGroup(idx)
    setViewerOpen(true)
  }

  const ownGroup = groups.find(g => g.user.id === profile?.id)

  return (
    <>
      <div className="flex gap-4 overflow-x-auto py-3 px-4 scrollbar-hide">
        {/* My story */}
        <button
          className="flex flex-col items-center gap-1 shrink-0"
          onClick={() => {
            if (ownGroup) {
              openStory(groups.indexOf(ownGroup))
            } else {
              navigate('/create-story')
            }
          }}
        >
          <div className="relative">
            <Avatar className={cn(
              "size-16 ring-2 p-0.5",
              ownGroup
                ? "ring-transparent bg-gradient-to-tr from-amber-400 via-pink-500 to-violet-600"
                : "ring-border"
            )}>
              <AvatarImage src={profile?.avatar_url} className="rounded-full" />
              <AvatarFallback>{profile?.username?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            {!ownGroup && (
              <div className="absolute bottom-0 right-0 bg-primary rounded-full size-5 flex items-center justify-center ring-2 ring-background">
                <Plus className="size-3 text-primary-foreground" />
              </div>
            )}
          </div>
          <span className="text-xs text-center w-16 truncate text-muted-foreground">
            {ownGroup ? 'Your story' : 'Add story'}
          </span>
        </button>

        {/* Others' stories */}
        {groups
          .filter(g => g.user.id !== profile?.id)
          .map((group) => {
            const realIdx = groups.indexOf(group)
            const allViewed = group.stories.every(s => s._viewed_by_me)
            return (
              <button
                key={group.user.id}
                className="flex flex-col items-center gap-1 shrink-0"
                onClick={() => openStory(realIdx)}
              >
                <Avatar className={cn(
                  "size-16 ring-2 p-0.5",
                  allViewed
                    ? "ring-muted-foreground/30"
                    : "ring-transparent bg-gradient-to-tr from-amber-400 via-pink-500 to-violet-600"
                )}>
                  <AvatarImage src={group.user.avatar_url} className="rounded-full" />
                  <AvatarFallback>{group.user.username[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="text-xs text-center w-16 truncate">{group.user.username}</span>
              </button>
            )
          })}
      </div>

      {viewerOpen && groups.length > 0 && (
        <StoryViewer
          groups={groups}
          initialGroupIndex={selectedGroup}
          onClose={() => { setViewerOpen(false); fetchStories() }}
        />
      )}
    </>
  )
}
