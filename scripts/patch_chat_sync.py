from pathlib import Path

chat = Path('src/pages/Chat.tsx')
s = chat.read_text()

anchor = "  const lastTapRef = useRef<Record<string, number>>({})\n"
assert anchor in s, 'Chat refs anchor not found'
if 'const messagesRef = useRef<Message[]>([])' not in s:
    s = s.replace(anchor, anchor + "  const messagesRef = useRef<Message[]>([])\n  const reconciliationTimerRef = useRef<number | null>(null)\n")

anchor = "  }, [user, otherUser, hydrateReplyPreviews])\n\n  useEffect(() => { void fetchOtherUser() }, [fetchOtherUser])\n"
assert anchor in s, 'Chat fetch insertion point not found'
if 'const reconcileMissingMessages = useCallback' not in s:
    block = r'''  }, [user, otherUser, hydrateReplyPreviews])

  const reconcileMissingMessages = useCallback(async () => {
    if (!user || !otherUser) return
    const existing = messagesRef.current
    const known = new Set(existing.map(message => message.id))
    let query = supabase
      .from('messages')
      .select('*, message_reactions(id, user_id, emoji)')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUser.id}),and(sender_id.eq.${otherUser.id},receiver_id.eq.${user.id})`)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(50)
    const latestCreatedAt = existing[existing.length - 1]?.created_at
    if (latestCreatedAt) query = query.gt('created_at', latestCreatedAt)
    const { data, error } = await query
    if (error || !data?.length) return
    const fresh = hydrateReplyPreviews((data as Message[]).filter(message => !known.has(message.id)))
    if (!fresh.length) return
    setMessages(prev => {
      const ids = new Set(prev.map(message => message.id))
      const next = [...prev, ...fresh.filter(message => !ids.has(message.id))]
      messagesRef.current = next
      return next
    })
    if (fresh.some(message => message.receiver_id === user.id && !message.is_seen && !message.deleted_for_everyone)) {
      const { error: seenError } = await supabase.rpc('mark_messages_seen', { p_other_user_id: otherUser.id })
      if (seenError) console.warn('message reconciliation seen update failed:', seenError.message)
    }
  }, [hydrateReplyPreviews, otherUser, user])

  useEffect(() => { void fetchOtherUser() }, [fetchOtherUser])
'''
    s = s.replace(anchor, block)

anchor = "  useEffect(() => { if (otherUser) void fetchMessages() }, [otherUser, fetchMessages])\n"
assert anchor in s, 'Chat state sync anchor not found'
if 'messagesRef.current = messages' not in s:
    s = s.replace(anchor, anchor + "  useEffect(() => { messagesRef.current = messages }, [messages])\n")

anchor = "  useEffect(() => () => {\n    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)\n"
assert anchor in s, 'Chat cleanup anchor not found'
if 'window.clearInterval(reconciliationTimerRef.current)' not in s:
    s = s.replace(anchor, "  useEffect(() => () => {\n    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)\n    if (reconciliationTimerRef.current) window.clearInterval(reconciliationTimerRef.current)\n")

anchor = "      .subscribe(status => {\n        if (status === 'CHANNEL_ERROR') console.error('Chat realtime channel error')\n        if (status === 'TIMED_OUT') console.error('Chat realtime channel timed out')\n      })\n    return () => { void supabase.removeChannel(channel) }\n  }, [user, otherUser, fetchMessages])\n"
assert anchor in s, 'Chat realtime block not found'
if 'reconciliationTimerRef.current = window.setInterval' not in s:
    replacement = """      .subscribe(status => {\n        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') console.warn('Chat realtime degraded; reconciliation fallback active')\n      })\n\n    const onOnline = () => void reconcileMissingMessages()\n    const onVisibility = () => { if (document.visibilityState === 'visible') void reconcileMissingMessages() }\n    window.addEventListener('online', onOnline)\n    document.addEventListener('visibilitychange', onVisibility)\n    reconciliationTimerRef.current = window.setInterval(() => void reconcileMissingMessages(), 4000)\n\n    return () => {\n      if (reconciliationTimerRef.current) window.clearInterval(reconciliationTimerRef.current)\n      reconciliationTimerRef.current = null\n      window.removeEventListener('online', onOnline)\n      document.removeEventListener('visibilitychange', onVisibility)\n      void supabase.removeChannel(channel)\n    }\n  }, [user, otherUser, fetchMessages, reconcileMissingMessages])\n"""
    s = s.replace(anchor, replacement)

chat.write_text(s)

notifications = Path('src/pages/Notifications.tsx')
s = notifications.read_text()
old = "<Link to={n.type === 'post' && n.post?.id ? `/?post=${n.post.id}` : `/profile/${n.actor?.username}`}><p className=\"text-sm\"><span className=\"font-semibold\">{n.actor?.username}</span>{' '}<span className=\"text-muted-foreground\">{getMessage(n)}</span></p>"
new = "<Link to={n.type === 'message' && n.actor?.username ? `/messages/${n.actor.username}` : n.post?.id ? `/?post=${n.post.id}${n.comment_id ? `&comment=${n.comment_id}` : ''}` : n.type === 'story' || n.type === 'story_reply' ? `/notifications?story=${n.story_id || ''}` : `/profile/${n.actor?.username}`}><p className=\"text-sm\"><span className=\"font-semibold\">{n.actor?.username}</span>{' '}<span className=\"text-muted-foreground\">{getMessage(n)}</span></p>"
if old in s:
    s = s.replace(old, new)
notifications.write_text(s)
