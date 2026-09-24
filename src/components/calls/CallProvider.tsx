import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Phone, Video, Mic, MicOff, PhoneOff, Volume2, VolumeX, VideoOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { sendPushEvent } from '@/lib/push'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'
import SwipeCallSlider from '@/components/calls/SwipeCallSlider'

type CallKind = 'voice' | 'video'
type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed'
type Signal = { id: number; call_id: string; sender_id: string; recipient_id: string; signal_type: string; payload: Record<string, unknown> }
type CallSession = { id: string; caller_id: string; callee_id: string; kind: CallKind; status: CallStatus; created_at: string; answered_at?: string | null; started_at?: string | null; ended_at?: string | null }
type Peer = { id: string; username: string; full_name: string; avatar_url: string }
type CallContextValue = { startCall: (peer: Peer, kind: CallKind) => Promise<void> }
type AudioRouteBridge = { setSpeaker: (enabled: boolean) => void }
type NativeNotificationBridge = { stopCall?: () => void; getPendingCallAction?: () => string; clearPendingCallAction?: () => void }

type OutgoingStage = 'connecting' | 'ringing'
const CALL_RING_TIMEOUT_MS = 60_000
const CALL_STATE_POLL_MS = 800
const CallContext = createContext<CallContextValue | null>(null)
const TURN_URLS = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map(v => v.trim()).filter(Boolean) || []
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, ...((TURN_URLS.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) ? [{ urls: TURN_URLS, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : [])]

function nativeNotifications() { return (window as Window & { YomyNotification?: NativeNotificationBridge }).YomyNotification }
function stopNativeCallNotification() { nativeNotifications()?.stopCall?.() }
function setNativeSpeaker(enabled: boolean) { const bridge = (window as Window & { YomyAudio?: AudioRouteBridge }).YomyAudio; bridge?.setSpeaker?.(enabled) }
function formatDuration(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }

function MediaView({ stream, muted }: { stream: MediaStream | null; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className="w-full h-full object-cover rounded-2xl" />
}

export default function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [incoming, setIncoming] = useState<CallSession | null>(null)
  const [active, setActive] = useState<CallSession | null>(null)
  const [peer, setPeer] = useState<Peer | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [outgoingStage, setOutgoingStage] = useState<OutgoingStage>('connecting')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const activeRef = useRef<CallSession | null>(null)
  const incomingRef = useRef<CallSession | null>(null)
  const peerRef = useRef<Peer | null>(null)
  const processedSignals = useRef(new Set<number>())
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const timeoutRef = useRef<number | null>(null)
  const handledNativeActionsRef = useRef(new Set<string>())

  useEffect(() => { incomingRef.current = incoming }, [incoming])
  useEffect(() => { peerRef.current = peer }, [peer])
  useEffect(() => { if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream }, [remoteStream])

  const cleanup = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    stopNativeCallNotification()
    setNativeSpeaker(false)
    try { pcRef.current?.close() } catch {}
    pcRef.current = null
    setLocalStream(current => { current?.getTracks().forEach(track => track.stop()); return null })
    setRemoteStream(null)
    setConnected(false)
    setMuted(false)
    setCameraOff(false)
    setSpeakerOn(false)
    setElapsedSeconds(0)
    setOutgoingStage('connecting')
    activeRef.current = null
    incomingRef.current = null
    peerRef.current = null
    setActive(null)
    setIncoming(null)
    setPeer(null)
    processedSignals.current.clear()
    pendingCandidates.current = []
  }, [])

  const profileFor = useCallback(async (id: string) => {
    const { data } = await supabase.from('profiles').select('id,username,full_name,avatar_url').eq('id', id).maybeSingle()
    return data as Peer | null
  }, [])

  const sendSignal = useCallback(async (call: CallSession, signalType: string, payload: Record<string, unknown>) => {
    if (!user) return
    const recipientId = call.caller_id === user.id ? call.callee_id : call.caller_id
    const { error } = await supabase.from('call_signals').insert({ call_id: call.id, sender_id: user.id, recipient_id: recipientId, signal_type: signalType, payload })
    if (error) console.warn('call signal failed:', error.message)
  }, [user])

  const openCallRoute = useCallback((callerProfile: Peer, callId: string) => {
    if (!callerProfile.username) return
    const destination = `/messages/${encodeURIComponent(callerProfile.username)}?call=${encodeURIComponent(callId)}`
    if (location.pathname !== `/messages/${callerProfile.username}` || location.search !== `?call=${callId}`) navigate(destination)
  }, [location.pathname, location.search, navigate])

  const setupPeer = useCallback(async (call: CallSession, caller: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone/camera is not available')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' })
    setLocalStream(stream)
    setNativeSpeaker(false)
    setSpeakerOn(false)
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc
    stream.getTracks().forEach(track => pc.addTrack(track, stream))
    const remote = new MediaStream()
    setRemoteStream(remote)
    pc.ontrack = event => event.streams[0]?.getTracks().forEach(track => { if (!remote.getTracks().some(t => t.id === track.id)) remote.addTrack(track) })
    pc.onicecandidate = event => { if (event.candidate) void sendSignal(call, 'ice-candidate', event.candidate.toJSON() as unknown as Record<string, unknown>) }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setConnected(true)
      if (pc.connectionState === 'failed') {
        void supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id).eq('status', 'active')
        cleanup()
        toast.error('Call connection failed')
      }
    }
    if (caller) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: call.kind === 'video' })
      await pc.setLocalDescription(offer)
      await sendSignal(call, 'offer', offer as unknown as Record<string, unknown>)
    }
    return pc
  }, [cleanup, sendSignal])

  const loadIncomingById = useCallback(async (callId: string) => {
    if (!user || !callId) return null
    const { data, error } = await supabase.from('call_sessions').select('*').eq('id', callId).eq('callee_id', user.id).maybeSingle()
    if (error || !data) return null
    const call = data as CallSession
    if (call.status !== 'ringing') return null
    if (Date.now() - new Date(call.created_at).getTime() >= CALL_RING_TIMEOUT_MS) {
      await supabase.from('call_sessions').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', call.id).eq('callee_id', user.id).eq('status', 'ringing')
      return null
    }
    const callerProfile = await profileFor(call.caller_id)
    if (!callerProfile) return null
    setIncoming(call)
    setPeer(callerProfile)
    await sendSignal(call, 'ringing_ack', { received_at: new Date().toISOString() })
    return { call, callerProfile }
  }, [profileFor, sendSignal, user])

  const startCall = useCallback(async (target: Peer, kind: CallKind): Promise<void> => {
    if (!user || activeRef.current || incomingRef.current) return
    if (!navigator.onLine) { toast.error('Calls need an internet connection'); return }
    const { data, error } = await supabase.from('call_sessions').insert({ caller_id: user.id, callee_id: target.id, kind, status: 'ringing' }).select('*').single()
    if (error || !data) { toast.error(error?.message || 'Could not start call'); return }
    const call = data as CallSession
    activeRef.current = call
    setActive(call)
    setPeer(target)
    setOutgoingStage('connecting')
    try {
      await setupPeer(call, true)
      const callerLabel = String(user.user_metadata?.username || user.user_metadata?.full_name || 'Yomy')
      await sendPushEvent({ type: 'call', targetUserId: target.id, title: callerLabel, body: kind === 'video' ? 'Incoming video call' : 'Incoming voice call', data: { call_id: call.id, call_kind: kind, kind, event_type: 'CALL_INCOMING', push_title: callerLabel, push_body: kind === 'video' ? 'Incoming video call' : 'Incoming voice call', url: `/messages/${callerLabel}?call=${call.id}` } })
      timeoutRef.current = window.setTimeout(async () => {
        if (activeRef.current?.id === call.id && activeRef.current.status === 'ringing') {
          await supabase.from('call_sessions').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', call.id).eq('status', 'ringing')
          cleanup()
        }
      }, CALL_RING_TIMEOUT_MS)
    } catch (err) {
      await supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id).eq('status', 'ringing')
      cleanup()
      toast.error(err instanceof Error ? err.message : 'Could not start call')
    }
  }, [cleanup, sendPushEvent, setupPeer, user])

  const handleOffer = useCallback(async (call: CallSession, signal: Signal, pc: RTCPeerConnection) => {
    if (call.caller_id === user?.id || signal.signal_type !== 'offer') return
    await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await sendSignal(call, 'answer', answer as unknown as Record<string, unknown>)
  }, [sendSignal, user?.id])

  const acceptCall = useCallback(async (call: CallSession, callerProfile: Peer) => {
    if (!user || call.status !== 'ringing') return
    stopNativeCallNotification()
    try {
      const now = new Date().toISOString()
      const { data: activated, error: activationError } = await supabase.from('call_sessions').update({ status: 'active', answered_at: now, started_at: now }).eq('id', call.id).eq('callee_id', user.id).eq('status', 'ringing').select('id').maybeSingle()
      if (activationError) throw activationError
      if (!activated) return
      const activeCall = { ...call, status: 'active' as CallStatus, answered_at: now, started_at: now }
      activeRef.current = activeCall
      setActive(activeCall)
      setIncoming(null)
      setPeer(callerProfile)
      openCallRoute(callerProfile, call.id)
      const pc = await setupPeer(activeCall, false)
      const { data: signals } = await supabase.from('call_signals').select('*').eq('call_id', call.id).order('id')
      for (const signal of (signals || []) as Signal[]) {
        processedSignals.current.add(signal.id)
        if (signal.signal_type === 'offer') await handleOffer(activeCall, signal, pc)
        else if (signal.signal_type === 'ice-candidate') {
          if (pc.remoteDescription) await pc.addIceCandidate(signal.payload as RTCIceCandidateInit)
          else pendingCandidates.current.push(signal.payload as RTCIceCandidateInit)
        }
      }
      for (const candidate of pendingCandidates.current) await pc.addIceCandidate(candidate)
      pendingCandidates.current = []
    } catch (err) {
      await supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id)
      cleanup()
      toast.error(err instanceof Error ? err.message : 'Could not answer call')
    }
  }, [cleanup, handleOffer, openCallRoute, setupPeer, user])

  const declineCall = useCallback(async (call: CallSession) => {
    if (!user || call.status !== 'ringing') return
    stopNativeCallNotification()
    const { error } = await supabase.from('call_sessions').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', call.id).eq('callee_id', user.id).eq('status', 'ringing')
    await sendSignal(call, 'decline', { declined_at: new Date().toISOString() })
    if (error) console.warn('decline call update failed:', error.message)
    cleanup()
  }, [cleanup, sendSignal, user])

  const endCall = useCallback(async () => {
    const call = activeRef.current
    if (!call) return
    const nextStatus: CallStatus = call.status === 'ringing' ? 'ended' : 'ended'
    await supabase.from('call_sessions').update({ status: nextStatus, ended_at: new Date().toISOString() }).eq('id', call.id).eq('status', call.status)
    await sendSignal(call, 'hangup', { ended_at: new Date().toISOString() })
    cleanup()
  }, [cleanup, sendSignal])

  useEffect(() => {
    if (!user) return
    let mounted = true
    const loadRinging = async () => {
      if (!navigator.onLine) return
      const { data } = await supabase.from('call_sessions').select('*').eq('callee_id', user.id).eq('status', 'ringing').order('created_at', { ascending: false }).limit(5)
      if (!mounted || activeRef.current) return
      for (const row of (data || []) as CallSession[]) {
        const loaded = await loadIncomingById(row.id)
        if (loaded) break
      }
    }
    void loadRinging()
    const onOnline = () => { void loadRinging() }
    window.addEventListener('online', onOnline)
    const channel = supabase.channel(`calls-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${user.id}` }, async payload => {
        const call = payload.new as CallSession
        if (call.status !== 'ringing' || activeRef.current) return
        await loadIncomingById(call.id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions' }, payload => {
        const call = payload.new as CallSession
        if (incomingRef.current?.id === call.id && call.status !== 'ringing') {
          stopNativeCallNotification()
          if (call.status !== 'active') { setIncoming(null); incomingRef.current = null; setPeer(current => current && current.id === call.caller_id ? null : current) }
        }
        if (activeRef.current?.id !== call.id) return
        if (call.status === 'active') {
          activeRef.current = call
          setActive(call)
          setOutgoingStage('ringing')
        } else if (['declined', 'missed', 'failed', 'ended'].includes(call.status)) cleanup()
      })
      .subscribe()
    return () => { mounted = false; window.removeEventListener('online', onOnline); void supabase.removeChannel(channel) }
  }, [cleanup, loadIncomingById, user])

  useEffect(() => {
    if (!user) return
    const channel = supabase.channel(`call-signals-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `recipient_id=eq.${user.id}` }, async payload => {
        const signal = payload.new as Signal
        if (processedSignals.current.has(signal.id)) return
        const call = activeRef.current
        const pc = pcRef.current
        if (!call || signal.call_id !== call.id) return
        processedSignals.current.add(signal.id)
        try {
          if (signal.signal_type === 'ringing_ack' && call.status === 'ringing') setOutgoingStage('ringing')
          else if (signal.signal_type === 'answer' && call.caller_id === user.id && pc) {
            await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit)
            const now = new Date().toISOString()
            const activeCall = { ...call, status: 'active' as CallStatus, answered_at: call.answered_at || now, started_at: call.started_at || now }
            activeRef.current = activeCall
            setActive(activeCall)
            setOutgoingStage('ringing')
            for (const candidate of pendingCandidates.current) await pc.addIceCandidate(candidate)
            pendingCandidates.current = []
          } else if (signal.signal_type === 'offer' && call.callee_id === user.id && pc) await handleOffer(call, signal, pc)
          else if (signal.signal_type === 'ice-candidate' && pc) {
            if (pc.remoteDescription) await pc.addIceCandidate(signal.payload as RTCIceCandidateInit)
            else pendingCandidates.current.push(signal.payload as RTCIceCandidateInit)
          } else if (signal.signal_type === 'decline' || signal.signal_type === 'hangup') cleanup()
        } catch (err) { console.warn('signal handling failed:', err instanceof Error ? err.message : err) }
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [cleanup, handleOffer, user])

  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(async () => {
      if (!navigator.onLine) return
      const call = activeRef.current
      if (!call) return
      const { data } = await supabase.from('call_sessions').select('status,answered_at,started_at,ended_at').eq('id', call.id).maybeSingle()
      if (!data) return
      const nextStatus = data.status as CallStatus
      if (nextStatus === 'active' && call.status !== 'active') {
        const updated = { ...call, ...data, status: 'active' as CallStatus }
        activeRef.current = updated
        setActive(updated)
        setOutgoingStage('ringing')
      } else if (['declined', 'missed', 'failed', 'ended'].includes(nextStatus)) cleanup()
    }, CALL_STATE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [cleanup, user])

  useEffect(() => {
    const bridge = nativeNotifications()
    const processPending = async () => {
      const pending = bridge?.getPendingCallAction?.() || ''
      if (!pending) return
      const splitAt = pending.indexOf('|')
      if (splitAt <= 0) return
      const action = pending.slice(0, splitAt)
      const callId = pending.slice(splitAt + 1)
      const key = `${action}:${callId}`
      if (handledNativeActionsRef.current.has(key)) return
      handledNativeActionsRef.current.add(key)
      const loaded = await loadIncomingById(callId)
      if (loaded) {
        if (action === 'open') openCallRoute(loaded.callerProfile, callId)
        else if (action === 'accept') await acceptCall(loaded.call, loaded.callerProfile)
        else if (action === 'decline') await declineCall(loaded.call)
      }
      bridge?.clearPendingCallAction?.()
      window.setTimeout(() => handledNativeActionsRef.current.delete(key), 2500)
    }
    void processPending()
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; callId?: string }>).detail
      if (!detail?.action || !detail.callId) return
      const key = `${detail.action}:${detail.callId}`
      if (handledNativeActionsRef.current.has(key)) return
      handledNativeActionsRef.current.add(key)
      void (async () => {
        const loaded = await loadIncomingById(detail.callId as string)
        if (loaded) {
          if (detail.action === 'open') openCallRoute(loaded.callerProfile, loaded.call.id)
          else if (detail.action === 'accept') await acceptCall(loaded.call, loaded.callerProfile)
          else if (detail.action === 'decline') await declineCall(loaded.call)
        }
        nativeNotifications()?.clearPendingCallAction?.()
        window.setTimeout(() => handledNativeActionsRef.current.delete(key), 2500)
      })()
    }
    window.addEventListener('yomy-call-action', onAction)
    return () => window.removeEventListener('yomy-call-action', onAction)
  }, [acceptCall, declineCall, loadIncomingById, openCallRoute])

  useEffect(() => {
    const callId = new URLSearchParams(location.search).get('call')
    if (!callId || !user || activeRef.current) return
    void loadIncomingById(callId)
  }, [loadIncomingById, location.search, user])

  useEffect(() => {
    if (!active || active.status !== 'active') { setElapsedSeconds(0); return }
    const startAt = new Date(active.started_at || active.answered_at || active.created_at).getTime()
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  const toggleMic = () => { const track = localStream?.getAudioTracks()[0]; if (!track) return; track.enabled = !track.enabled; setMuted(!track.enabled) }
  const toggleCamera = () => { const track = localStream?.getVideoTracks()[0]; if (!track) return; track.enabled = !track.enabled; setCameraOff(!track.enabled) }
  const applySpeakerRoute = (enabled: boolean) => { setNativeSpeaker(enabled); setSpeakerOn(enabled) }
  const value = useMemo(() => ({ startCall }), [startCall])
  const showIncoming = !!incoming && !active
  const showOutgoing = !!active && active.status === 'ringing'
  const showActive = !!active && active.status === 'active'

  return <CallContext.Provider value={value}>
    {children}
    <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    {showIncoming && peer && <div className="fixed inset-0 z-[100] bg-[#06100e] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(57,211,147,0.16),transparent_28%),radial-gradient(circle_at_15%_85%,rgba(45,130,255,0.10),transparent_26%)]" />
      <div className="absolute -top-32 left-1/2 size-80 -translate-x-1/2 rounded-full border border-white/5 animate-pulse" />
      <div className="relative min-h-full flex flex-col items-center px-6 pt-[max(48px,env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 backdrop-blur-xl">
          <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold tracking-[0.18em] text-white/70">YOMY • SECURE CALL</span>
        </div>
        <div className="mt-16 text-center">
          <div className="relative mx-auto size-36">
            <div className="absolute -inset-3 rounded-full border border-emerald-300/10 animate-pulse" />
            <div className="absolute -inset-6 rounded-full border border-white/5" />
            <Avatar className="relative size-36 border-4 border-white/10 shadow-2xl">
              <AvatarImage src={peer.avatar_url} />
              <AvatarFallback className="bg-gradient-to-br from-white/15 to-white/5 text-4xl font-semibold text-white">{peer.username[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
          </div>
          <h2 className="mt-8 text-4xl font-semibold tracking-[-0.03em]">{peer.username}</h2>
          <p className="mt-2 text-base text-white/60">{incoming?.kind === 'video' ? 'Incoming video call' : 'Incoming voice call'}</p>
          <p className="mt-2 text-xs text-white/35">Your call controls are waiting below</p>
        </div>
        <div className="mt-auto w-full max-w-md pb-5">
          <SwipeCallSlider
            onAnswer={() => acceptCall(incoming as CallSession, peer)}
            onDecline={() => declineCall(incoming as CallSession)}
          />
        </div>
      </div>
    </div>}
    {showOutgoing && peer && <div className="fixed inset-0 z-[99] bg-black text-white flex flex-col items-center justify-center p-7"><Avatar className="size-32 border-4 border-white/10"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl bg-white/10">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar><h2 className="mt-6 text-2xl font-semibold">{peer.username}</h2><p className="mt-2 text-white/60">{outgoingStage === 'ringing' ? 'Ringing…' : 'Connecting…'}</p><p className="mt-1 text-xs text-white/35">{outgoingStage === 'ringing' ? 'The other device received the call' : 'Waiting for the other device'}</p><div className="mt-auto pb-12"><Button variant="destructive" size="lg" className="rounded-full size-16" onClick={() => void endCall()}><PhoneOff className="size-7" /></Button></div></div>}
    {showActive && peer && <div className="fixed inset-0 z-[99] bg-black flex flex-col text-white"><div className="flex items-center justify-between p-4 pt-6"><div><p className="font-semibold text-lg">{peer.username}</p><p className="text-sm opacity-70">{connected ? formatDuration(elapsedSeconds) : 'Connecting audio…'}</p></div><Avatar className="size-10"><AvatarImage src={peer.avatar_url} /><AvatarFallback>{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div><div className="relative flex-1 flex items-center justify-center p-4">{active?.kind === 'video' ? <><MediaView stream={remoteStream} /><div className="absolute top-6 right-6 w-28 aspect-video rounded-xl overflow-hidden border border-white/30"><MediaView stream={localStream} muted /></div></> : <div className="size-40 rounded-full overflow-hidden"><Avatar className="size-full"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div>}</div><div className="flex justify-center gap-4 p-6 pb-10"><Button variant={speakerOn ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={() => applySpeakerRoute(!speakerOn)} aria-label={speakerOn ? 'Use earpiece' : 'Use speaker'}>{speakerOn ? <Volume2 /> : <VolumeX />}</Button><Button variant={muted ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={toggleMic}>{muted ? <MicOff /> : <Mic />}</Button>{active?.kind === 'video' && <Button variant={cameraOff ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={toggleCamera}>{cameraOff ? <VideoOff /> : <Video />}</Button>}<Button variant="destructive" size="icon" className="rounded-full size-14" onClick={() => void endCall()}><PhoneOff /></Button></div></div>}
  </CallContext.Provider>
}

export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used inside CallProvider'); return value }
