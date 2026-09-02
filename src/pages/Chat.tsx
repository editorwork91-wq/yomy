import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Message, Profile as ProfileType } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useCall } from '@/components/calls/CallProvider'
import { sendPushEvent } from '@/lib/push'
import TopBar from '@/components/layout/TopBar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Send, ImagePlus, Eye, EyeOff, Lock, Mic, Phone, Video, MoreVertical, Trash2, Volume2, Ban, Reply, Copy, Pencil, X, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const QUICK_EMOJIS = ['❤️', '😂', '👍', '🔥', '😮', '😢', '🎉', '👏']

export default function Chat() {
  const { username } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { startCall } = useCall()
  const [otherUser, setOtherUser] = useState<ProfileType | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [showViewOnce, setShowViewOnce] = useState<string | null>(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [viewOnceMode, setViewOnceMode] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null)
  const [showLongPressMenu, setShowLongPressMenu] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTapRef = useRef<Record<string, number>>({})

  const targetUsername = username || searchParams.get('to')

  const fetchOtherUser = useCallback(async () => {
    if (!targetUsername) return
    const { data, error } = await supabase.from('profiles').select('*').eq('username', targetUsername).maybeSingle()
    if (error) {
      toast.error(`تعذر تحميل المستخدم: ${error.message}`)
      return
    }
    if (!data) {
      toast.error('المستخدم غير موجود')
      return
    }
    setOtherUser(data)
  }, [targetUsername])

  const hydrateReplyPreviews = useCallback((rows: Message[]) => {
    const byId = new Map(rows.map(row => [row.id, row]))
    return rows.map(row => ({
      ...row,
      reply_to: row.reply_to_id ? byId.get(row.reply_to_id) : undefined,
    }))
  }, [])

  const fetchMessages = useCallback(async (showLoader = true) => {
    if (!user || !otherUser) return
    if (showLoader) setLoading(true)

    const { data, error } = await supabase
      .from('messages')
      .select(`*, message_reactions(id, user_id, emoji)`)
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUser.id}),and(sender_id.eq.${otherUser.id},receiver_id.eq.${user.id})`)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) {
      if (showLoader) setMessages([])
      if (showLoader) setLoading(false)
      toast.error(`تعذر تحميل الرسائل: ${error.message}`)
      return
    }

    const hydrated = hydrateReplyPreviews((data || []) as Message[])
    setMessages(hydrated)
    if (showLoader) setLoading(false)

    const unseen = hydrated.filter(m => m.receiver_id === user.id && !m.is_seen && !m.deleted_for_everyone)
    if (unseen.length > 0) {
      const { error: seenError } = await supabase.rpc('mark_messages_seen', { p_other_user_id: otherUser.id })
      if (seenError) console.error('mark_messages_seen failed:', seenError.message)
    }

    const { data: muted } = await supabase
      .from('muted_chats')
      .select('id')
      .eq('user_id', user.id)
      .eq('muted_user_id', otherUser.id)
      .maybeSingle()
    setIsMuted(!!muted)
  }, [user, otherUser, hydrateReplyPreviews])

  useEffect(() => { fetchOtherUser() }, [fetchOtherUser])
  useEffect(() => { if (otherUser) fetchMessages() }, [otherUser, fetchMessages])
  useEffect(() => () => {
    recorderRef.current?.stop()
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  useEffect(() => {
    if (!user || !otherUser) return
    const channel = supabase
      .channel(`chat-${user.id}-${otherUser.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${otherUser.id}` },
        async (payload) => {
          if (payload.new.receiver_id !== user.id) return
          const newMsg = payload.new as Message
          const { data, error } = await supabase
            .from('messages')
            .select('*, message_reactions(id, user_id, emoji)')
            .eq('id', newMsg.id)
            .single()
          if (!error && data) {
            setMessages(prev => {
              if (prev.some(m => m.id === data.id)) return prev
              const candidate = data as Message
              const reply = candidate.reply_to_id ? prev.find(m => m.id === candidate.reply_to_id) : undefined
              return [...prev, { ...candidate, reply_to: reply }]
            })
          }
          const { error: seenError } = await supabase.rpc('mark_messages_seen', { p_other_user_id: otherUser.id })
          if (seenError) console.error('mark_messages_seen realtime failed:', seenError.message)
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${otherUser.id}` },
        () => fetchMessages(false)
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${user.id}` },
        () => fetchMessages(false)
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        () => fetchMessages(false)
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        () => fetchMessages(false)
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') return
        if (status === 'CHANNEL_ERROR') toast.error('تعذر الاتصال اللحظي بالمحادثة')
        if (status === 'TIMED_OUT') toast.error('انتهت مهلة اتصال المحادثة، أعد المحاولة')
      })

    return () => { void supabase.removeChannel(channel) }
  }, [user, otherUser, fetchMessages])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const uploadMedia = async (file: File) => {
    if (!user) return
    setUploadingMedia(true)
    try {
      const isVideo = file.type.startsWith('video/')
      const isAudio = file.type.startsWith('audio/')
      const folder = isAudio ? 'audio' : isVideo ? 'videos' : 'images'
      const ext = file.name.split('.').pop() || (isAudio ? 'mp3' : isVideo ? 'mp4' : 'jpg')
      const path = `${folder}/${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('messages').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('messages').getPublicUrl(path)
      await sendMessage('', publicUrl, isAudio ? 'audio' : isVideo ? 'video' : 'image')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingMedia(false)
    }
  }

  const startRecording = async () => {
    if (recording || uploadingMedia) return
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) return toast.error('Audio recording is not supported in this browser')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordingStreamRef.current = stream
      recordingChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = event => { if (event.data.size > 0) recordingChunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })
        stream.getTracks().forEach(track => track.stop())
        recordingStreamRef.current = null
        recorderRef.current = null
        setRecording(false)
        if (blob.size > 0) void uploadMedia(file)
      }
      recorder.start(250)
      setRecording(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not access microphone')
    }
  }

  const stopRecording = () => { recorderRef.current?.stop() }

  const sendMessage = async (content?: string, mediaUrl?: string, mediaType?: '' | 'image' | 'video' | 'audio') => {
    if (!user || !otherUser) return
    const msgContent = content ?? newMessage
    if (!msgContent.trim() && !mediaUrl) return
    setSending(true)
    try {
      const { data: insertedMessage, error } = await supabase.from('messages').insert({
        sender_id: user.id,
        receiver_id: otherUser.id,
        content: msgContent.trim(),
        media_url: mediaUrl || '',
        media_type: mediaType || '',
        is_encrypted: true,
        view_once: viewOnceMode && !!mediaUrl,
        reply_to_id: replyTo?.id || null,
      }).select('id, created_at').single()
      if (error) throw error
      if (insertedMessage) {
        setMessages(prev => prev.some(message => message.id === insertedMessage.id) ? prev : [...prev, {
          id: insertedMessage.id,
          sender_id: user.id,
          receiver_id: otherUser.id,
          content: msgContent.trim(),
          media_url: mediaUrl || '',
          media_type: mediaType || '',
          is_seen: false,
          is_encrypted: true,
          view_once: viewOnceMode && !!mediaUrl,
          view_once_opened: false,
          deleted_at: null,
          deleted_for_everyone: false,
          reply_to_id: replyTo?.id || null,
          edited_at: null,
          is_request: false,
          request_accepted: false,
          created_at: insertedMessage.created_at,
          reply_to: replyTo || undefined,
        }])
        void sendPushEvent({ type: 'message', targetUserId: otherUser.id, title: `Message from ${user.user_metadata?.username || 'Yomy'}`, body: mediaType === 'audio' ? '🎙️ Voice message' : mediaType === 'video' ? '🎬 Video message' : mediaType === 'image' ? '📷 Photo' : (msgContent.trim() || 'New message'), data: { message_id: insertedMessage.id, url: `/messages/${otherUser.username}` } })
        setNewMessage('')
        setViewOnceMode(false)
        setReplyTo(null)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const saveEdit = async (messageId: string, newContent: string) => {
    const content = newContent.trim()
    if (!content) return
    const editedAt = new Date().toISOString()
    const { error } = await supabase.from('messages').update({ content, edited_at: editedAt }).eq('id', messageId).eq('sender_id', user?.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content, edited_at: editedAt } : m))
    setEditingMessage(null)
    toast.success('Message edited')
  }

  const deleteForMe = async (messageId: string) => {
    if (!user) return
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId).eq('sender_id', user.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setMessages(prev => prev.filter(m => m.id !== messageId))
    setShowLongPressMenu(null)
    toast.success('Deleted for you')
  }

  const deleteForEveryone = async (messageId: string) => {
    if (!user) return
    const { error } = await supabase.from('messages').update({ deleted_for_everyone: true, content: '', media_url: '', media_type: '' }).eq('id', messageId).eq('sender_id', user.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deleted_for_everyone: true, content: '', media_url: '', media_type: '' } : m))
    setShowLongPressMenu(null)
    toast.success('Deleted for everyone')
  }

  const addReaction = async (messageId: string, emoji: string) => {
    if (!user) return
    const existing = messages.find(m => m.id === messageId)?.message_reactions?.find(r => r.user_id === user.id && r.emoji === emoji)
    try {
      if (existing) {
        const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji })
        if (error) throw error
      }
      setShowReactionPicker(null)
      setShowLongPressMenu(null)
      await fetchMessages(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update reaction')
    }
  }

  const handleDoubleTap = (msg: Message) => {
    if (!msg.deleted_for_everyone) void addReaction(msg.id, '❤️')
  }

  const handleMessageTap = (msg: Message) => {
    const now = Date.now()
    const lastTap = lastTapRef.current[msg.id] || 0
    if (now - lastTap < 300) handleDoubleTap(msg)
    lastTapRef.current[msg.id] = now
  }

  const toggleMute = async () => {
    if (!user || !otherUser) return
    if (isMuted) {
      const { error } = await supabase.from('muted_chats').delete().eq('user_id', user.id).eq('muted_user_id', otherUser.id)
      if (error) return toast.error(error.message)
      setIsMuted(false)
      toast.success('Unmuted')
    } else {
      const { error } = await supabase.from('muted_chats').insert({ user_id: user.id, muted_user_id: otherUser.id })
      if (error) return toast.error(error.message)
      setIsMuted(true)
      toast.success('Muted')
    }
  }

  const blockUser = async () => {
    if (!user || !otherUser) return
    const { error: blockError } = await supabase.from('blocks').upsert({ blocker_id: user.id, blocked_id: otherUser.id }, { onConflict: 'blocker_id,blocked_id' })
    if (blockError) return toast.error(blockError.message)
    const { error: followError } = await supabase.from('follows').delete().or(`and(follower_id.eq.${user.id},following_id.eq.${otherUser.id}),and(follower_id.eq.${otherUser.id},following_id.eq.${user.id})`)
    if (followError) console.error('follow cleanup failed:', followError.message)
    toast.success('User blocked')
    navigate('/messages')
  }

  const clearChat = async () => {
    if (!user || !otherUser) return
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() })
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUser.id}),and(sender_id.eq.${otherUser.id},receiver_id.eq.${user.id})`)
    if (error) return toast.error(error.message)
    setMessages([])
    toast.success('Chat cleared')
  }

  const openViewOnce = async (msg: Message) => {
    if (!msg.media_url || msg.view_once_opened) return
    const { error } = await supabase.from('messages').update({ view_once_opened: true }).eq('id', msg.id).eq('receiver_id', user?.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setShowViewOnce(msg.media_url)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, view_once_opened: true } : m))
  }

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
    setShowLongPressMenu(null)
  }

  if (!targetUsername) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Select a conversation</p></div>
  }

  if (loading || !otherUser) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>
  }

  return (
    <div className="flex flex-col h-screen">
      <TopBar title="" showBack right={<div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="size-9" onClick={() => void startCall(otherUser, 'voice')}><Phone className="size-5" /></Button><Button variant="ghost" size="icon" className="size-9" onClick={() => void startCall(otherUser, 'video')}><Video className="size-5" /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-9"><MoreVertical className="size-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={toggleMute}><Volume2 className="size-4 mr-2" />{isMuted ? 'Unmute' : 'Mute'} notifications</DropdownMenuItem><DropdownMenuItem onClick={clearChat}><Trash2 className="size-4 mr-2" /> Clear chat</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={blockUser} className="text-destructive focus:text-destructive"><Ban className="size-4 mr-2" /> Block user</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>} />

      <Link to={`/profile/${otherUser.username}`} className="flex items-center gap-3 px-4 py-2 border-b hover:bg-accent/30">
        <Avatar className="size-10"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback>{otherUser.username[0]?.toUpperCase()}</AvatarFallback></Avatar>
        <div className="flex-1 min-w-0"><div className="flex items-center gap-1"><p className="text-sm font-semibold">{otherUser.username}</p>{otherUser.is_verified && <svg className="size-3 text-blue-500 fill-current" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}</div><p className="text-xs text-muted-foreground">{otherUser.full_name || 'Active now'}</p></div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /><span>Encrypted</span></div>
      </Link>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center"><Avatar className="size-20"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback className="text-2xl">{otherUser.username[0]?.toUpperCase()}</AvatarFallback></Avatar><div><p className="font-semibold">{otherUser.username}</p><p className="text-sm text-muted-foreground">{otherUser.full_name || ''}</p></div><Button size="sm" onClick={() => sendMessage('Hi! 👋')}>Say hello</Button></div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.sender_id === user?.id
            const prevMsg = messages[idx - 1]
            const showDate = !prevMsg || new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString()
            const reactions = msg.message_reactions || []
            return (
              <div key={msg.id}>
                {showDate && <div className="flex justify-center my-3"><span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">{format(new Date(msg.created_at), 'MMM d, yyyy')}</span></div>}
                <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[75%] rounded-2xl px-3 py-2 relative', isMe ? 'bg-primary text-primary-foreground' : 'bg-muted', msg.view_once && 'border-2 border-dashed', msg.deleted_for_everyone && 'opacity-60')} onClick={() => handleMessageTap(msg)} onContextMenu={(e) => { e.preventDefault(); setShowLongPressMenu(msg.id) }}>
                    {msg.deleted_for_everyone ? <p className="text-sm italic opacity-60">Message deleted</p> : msg.view_once && msg.media_url && !msg.view_once_opened ? <button onClick={() => openViewOnce(msg)} className="flex items-center gap-2"><Eye className="size-4" /><span className="text-sm">View-once photo</span></button> : msg.view_once && msg.view_once_opened ? <div className="flex items-center gap-2 text-muted-foreground"><EyeOff className="size-4" /><span className="text-sm italic">Media expired</span></div> : <>
                      {msg.reply_to ? <div className={cn('mb-1 px-2 py-1 rounded text-xs opacity-70', isMe ? 'bg-primary-foreground/10' : 'bg-black/10')}><Reply className="size-3 inline mr-1" />{msg.reply_to.content || (msg.reply_to.media_type === 'image' ? '📷 Photo' : msg.reply_to.media_type === 'video' ? '🎬 Video' : '📎 Media')}</div> : msg.reply_to_id ? <div className={cn('mb-1 px-2 py-1 rounded text-xs opacity-70', isMe ? 'bg-primary-foreground/10' : 'bg-black/10')}><Reply className="size-3 inline mr-1" />Reply</div> : null}
                      {msg.media_url && msg.media_type === 'image' && <img src={msg.media_url} alt="" className="rounded-lg max-w-48 max-h-48 object-cover mb-1" />}
                      {msg.media_url && msg.media_type === 'video' && <video src={msg.media_url} controls playsInline className="rounded-lg max-w-48 max-h-48 mb-1" />}
                      {msg.media_url && msg.media_type === 'audio' && <div className="flex items-center gap-2 py-1"><Mic className="size-4" /><audio src={msg.media_url} controls className="h-8 max-w-40" /></div>}
                      {editingMessage?.id === msg.id ? <div className="flex flex-col gap-1"><textarea autoFocus defaultValue={msg.content} className="bg-transparent border rounded px-2 py-1 text-sm outline-none resize-none" rows={2}/><div className="flex gap-1 justify-end"><Button size="xs" variant="ghost" onClick={() => setEditingMessage(null)}>Cancel</Button><Button size="xs" onClick={(e) => { e.stopPropagation(); saveEdit(msg.id, (e.currentTarget.parentElement?.previousElementSibling as HTMLTextAreaElement).value) }}>Save</Button></div></div> : msg.content && <p className="text-sm break-words whitespace-pre-wrap">{msg.content}</p>}
                      {msg.edited_at && !msg.deleted_for_everyone && <span className="text-[10px] opacity-50 ml-1">edited</span>}
                    </>}
                    {!msg.deleted_for_everyone && <div className={cn('flex items-center gap-1 mt-0.5', isMe ? 'justify-end' : 'justify-start')}><span className="text-[10px] opacity-60">{format(new Date(msg.created_at), 'h:mm a')}</span>{isMe && !msg.view_once && <span className="text-[10px] opacity-60">{msg.is_seen ? '✓✓' : '✓'}</span>}</div>}
                    {reactions.length > 0 && !msg.deleted_for_everyone && <div className="flex gap-1 mt-1 flex-wrap">{reactions.map(r => <span key={r.id} className={cn('text-sm rounded-full px-1.5 py-0.5 cursor-pointer', r.user_id === user?.id ? 'bg-primary-foreground/20' : 'bg-black/10')} onClick={(e) => { e.stopPropagation(); void addReaction(msg.id, r.emoji) }}>{r.emoji}</span>)}</div>}
                    {showReactionPicker === msg.id && <div className="absolute -top-10 left-0 right-0 flex justify-center gap-1 bg-card rounded-full px-2 py-1 shadow-lg z-10">{QUICK_EMOJIS.map(emoji => <button key={emoji} className="text-lg hover:scale-125 transition-transform" onClick={(e) => { e.stopPropagation(); void addReaction(msg.id, emoji) }}>{emoji}</button>)}</div>}
                    {showLongPressMenu === msg.id && !msg.deleted_for_everyone && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowLongPressMenu(null)}><div className="bg-card rounded-lg p-2 shadow-xl min-w-[200px]" onClick={(e) => e.stopPropagation()}><button className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded w-full text-sm" onClick={() => { setShowReactionPicker(msg.id); setShowLongPressMenu(null) }}><span className="text-base">😀</span> React</button><button className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded w-full text-sm" onClick={() => { setReplyTo(msg); setShowLongPressMenu(null) }}><Reply className="size-4" /> Reply</button>{msg.content && <button className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded w-full text-sm" onClick={() => void copyMessage(msg.content)}><Copy className="size-4" /> Copy</button>}{isMe && msg.content && <button className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded w-full text-sm" onClick={() => { setEditingMessage(msg); setShowLongPressMenu(null) }}><Pencil className="size-4" /> Edit</button>}<button className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded w-full text-sm" onClick={() => void deleteForMe(msg.id)}><Trash2 className="size-4" /> Delete for me</button>{isMe && <button className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded w-full text-sm text-destructive" onClick={() => void deleteForEveryone(msg.id)}><Trash2 className="size-4" /> Delete for everyone</button>}</div></div>}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {replyTo && <div className="px-4 py-2 bg-muted/50 border-l-4 border-primary flex items-center gap-2"><Reply className="size-4 text-primary shrink-0" /><div className="flex-1 min-w-0"><p className="text-xs text-muted-foreground">Replying to {replyTo.sender_id === user?.id ? 'yourself' : otherUser.username}</p><p className="text-sm truncate">{replyTo.content || '📎 Media'}</p></div><Button variant="ghost" size="icon-sm" onClick={() => setReplyTo(null)}><X className="size-4" /></Button></div>}

      <div className="border-t p-3 pb-safe flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadMedia(f); e.currentTarget.value = '' }} />
        <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => fileRef.current?.click()} disabled={uploadingMedia || recording}>{uploadingMedia ? <Spinner className="size-5" /> : <ImagePlus className="size-5" />}</Button>
        <Button variant={recording ? 'destructive' : 'ghost'} size="icon" className="size-9 shrink-0" onClick={() => recording ? stopRecording() : void startRecording()} disabled={uploadingMedia}>{recording ? <MicOff className="size-5 animate-pulse" /> : <Mic className="size-5" />}</Button>
        <Button variant="ghost" size="icon" className={cn('size-9 shrink-0', viewOnceMode && 'text-primary')} onClick={() => { setViewOnceMode(!viewOnceMode); toast.info(viewOnceMode ? 'View-once off' : 'View-once on - media disappears after viewing') }}>{viewOnceMode ? <Eye className="size-5" /> : <EyeOff className="size-5" />}</Button>
        <Input placeholder={recording ? 'Recording voice…' : 'Message...'} value={newMessage} onChange={e => setNewMessage(e.target.value)} disabled={recording} onKeyDown={e => e.key === 'Enter' && !sending && void sendMessage()} className="flex-1" />
        <Button size="icon" className="size-9 shrink-0" disabled={!newMessage.trim() || sending || recording} onClick={() => void sendMessage()}>{sending ? <Spinner className="size-4" /> : <Send className="size-4" />}</Button>
      </div>

      {showViewOnce && <div className="fixed inset-0 z-50 bg-black flex items-center justify-center" onClick={() => setShowViewOnce(null)}><img src={showViewOnce} alt="" className="max-w-full max-h-full object-contain" /><Button variant="ghost" className="absolute top-4 right-4 text-white" size="icon" onClick={() => setShowViewOnce(null)}><span className="text-2xl">✕</span></Button></div>}
    </div>
  )
}
