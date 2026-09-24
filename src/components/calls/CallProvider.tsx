import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, Phone, Video, Mic, MicOff, PhoneOff, Volume2, VolumeX, VideoOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { sendPushEvent } from '@/lib/push'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

type CallKind = 'voice' | 'video'
type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed'
type Signal = { id: number; call_id: string; sender_id: string; recipient_id: string; signal_type: string; payload: Record<string, unknown> }
type CallSession = { id: string; caller_id: string; callee_id: string; kind: CallKind; status: CallStatus; created_at: string; answered_at?: string | null; started_at?: string | null; ended_at?: string | null }
type Peer = { id: string; username: string; full_name: string; avatar_url: string }
type CallContextValue = { startCall: (peer: Peer, kind: CallKind) => Promise<void> }
type AudioRouteBridge = { setSpeaker: (enabled: boolean) => void }
type NativeNotificationBridge = {
  stopCall?: () => void
  startActiveCall?: (title: string, callId: string, kind: CallKind, route: string) => void
  getPendingCallAction?: () => string
  clearPendingCallAction?: () => void
}

type OutgoingStage = 'connecting' | 'ringing'
const CALL_RING_TIMEOUT_MS = 60_000
const CALL_STATE_POLL_MS = 800
const CallContext = createContext<CallContextValue | null>(null)
const TURN_URLS = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map(v => v.trim()).filter(Boolean) || []
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, ...((TURN_URLS.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) ? [{ urls: TURN_URLS, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : [])]

function nativeNotifications() { return (window as Window & { YomyNotification?: NativeNotificationBridge }).YomyNotification }
function stopNativeCallNotification() { nativeNotifications()?.stopCall?.() }
function startNativeActiveCall(call: CallSession, caller: Peer | null) {
  if (!caller) return
  nativeNotifications()?.startActiveCall?.(caller.username || 'Yomy', call.id, call.kind, `/messages/${encodeURIComponent(caller.username)}`)
}
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
  const [callFocused, setCallFocused] = useState(true)
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
  const iceRecoveryTimerRef = useRef<number | null>(null)

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
    setCallFocused(true)
    if (iceRecoveryTimerRef.current) window.clearTimeout(iceRecoveryTimerRef.current)
    iceRecoveryTimerRef.current = null
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

    let recoveryAttempts = 0
    const recoverIce = async () => {
      if (!caller || recoveryAttempts >= 2 || pcRef.current !== pc || pc.signalingState === 'closed') return
      recoveryAttempts += 1
      try {
        pc.restartIce()
        const offer = await pc.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
          offerToReceiveVideo: call.kind === 'video',
        })
        if (pcRef.current !== pc) return
        await pc.setLocalDescription(offer)
        await sendSignal(call, 'offer', offer as unknown as Record<string, unknown>)
      } catch (error) {
        console.warn('ICE recovery failed:', error instanceof Error ? error.message : error)
      }
    }

    pc.ontrack = event => event.streams[0]?.getTracks().forEach(track => {
      if (!remote.getTracks().some(t => t.id === track.id)) remote.addTrack(track)
    })
    pc.onicecandidate = event => {
      if (event.candidate) void sendSignal(call, 'ice-candidate', event.candidate.toJSON() as unknown as Record<string, unknown>)
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (iceRecoveryTimerRef.current) window.clearTimeout(iceRecoveryTimerRef.current)
        iceRecoveryTimerRef.current = null
        recoveryAttempts = 0
        setConnected(true)
      } else if (pc.connectionState === 'disconnected') {
        setConnected(false)
        if (caller && !iceRecoveryTimerRef.current) {
          iceRecoveryTimerRef.current = window.setTimeout(() => {
            iceRecoveryTimerRef.current = null
            if (pcRef.current === pc && pc.connectionState === 'disconnected') void recoverIce()
          }, 2500)
        }
      } else if (pc.connectionState === 'failed') {
        setConnected(false)
        if (caller) void recoverIce()
      }
    }

    if (caller) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: call.kind === 'video' })
      await pc.setLocalDescription(offer)
      await sendSignal(call, 'offer', offer as unknown as Record<string, unknown>)
    }
    return pc
  }, [sendSignal])
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
    setOutgoingStage('ringing')
    setCallFocused(true)
    try {
      await setupPeer(call, true)
      startNativeActiveCall(call, target)
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
      setCallFocused(true)
      startNativeActiveCall(activeCall, callerProfile)
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
    if (error) console.warn('decline call update failed:', error.message)
    cleanup()
  }, [cleanup, user])

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
            setCallFocused(true)
            startNativeActiveCall(activeCall, peerRef.current)
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
        setCallFocused(true)
        setOutgoingStage('ringing')
        startNativeActiveCall(updated, peerRef.current)
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
      if (action === 'hangup') {
        if (activeRef.current?.id === callId) await endCall()
        else await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId).eq('status', 'active')
      } else {
        const loaded = await loadIncomingById(callId)
        if (loaded) {
          if (action === 'open') openCallRoute(loaded.callerProfile, callId)
          else if (action === 'accept') await acceptCall(loaded.call, loaded.callerProfile)
          else if (action === 'decline') await declineCall(loaded.call)
        }
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
        if (detail.action === 'hangup') {
          if (activeRef.current?.id === detail.callId) await endCall()
          else await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', detail.callId).eq('status', 'active')
        } else {
          const loaded = await loadIncomingById(detail.callId as string)
          if (loaded) {
            if (detail.action === 'open') openCallRoute(loaded.callerProfile, loaded.call.id)
            else if (detail.action === 'accept') await acceptCall(loaded.call, loaded.callerProfile)
            else if (detail.action === 'decline') await declineCall(loaded.call)
          }
        }
        nativeNotifications()?.clearPendingCallAction?.()
        window.setTimeout(() => handledNativeActionsRef.current.delete(key), 2500)
      })()
    }
    window.addEventListener('yomy-call-action', onAction)
    return () => window.removeEventListener('yomy-call-action', onAction)
  }, [acceptCall, declineCall, endCall, loadIncomingById, openCallRoute])

  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(async () => {
      const call = activeRef.current
      const pc = pcRef.current
      if (!call || !pc) return
      const { data } = await supabase.from('call_signals').select('*').eq('call_id', call.id).eq('recipient_id', user.id).order('id', { ascending: true })
      for (const signal of (data || []) as Signal[]) {
        if (processedSignals.current.has(signal.id)) continue
        processedSignals.current.add(signal.id)
        try {
          if (signal.signal_type === 'answer' && call.caller_id === user.id) {
            await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit)
            const now = new Date().toISOString()
            const activeCall = { ...call, status: 'active' as CallStatus, answered_at: call.answered_at || now, started_at: call.started_at || now }
            activeRef.current = activeCall
            setActive(activeCall)
            setCallFocused(true)
            setOutgoingStage('ringing')
            startNativeActiveCall(activeCall, peerRef.current)
            for (const candidate of pendingCandidates.current) await pc.addIceCandidate(candidate)
            pendingCandidates.current = []
          } else if (signal.signal_type === 'offer' && call.callee_id === user.id) {
            await handleOffer(call, signal, pc)
          } else if (signal.signal_type === 'ice-candidate') {
            if (pc.remoteDescription) await pc.addIceCandidate(signal.payload as RTCIceCandidateInit)
            else pendingCandidates.current.push(signal.payload as RTCIceCandidateInit)
          } else if (signal.signal_type === 'hangup' || signal.signal_type === 'decline') {
            cleanup()
          }
        } catch (error) {
          console.warn('signal reconciliation failed:', error instanceof Error ? error.message : error)
        }
      }
    }, 900)
    return () => window.clearInterval(timer)
  }, [cleanup, handleOffer, user])


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

  const minimizeCall = useCallback(() => {
    setCallFocused(false)
    if (peer?.username) navigate('/messages/' + encodeURIComponent(peer.username))
  }, [navigate, peer?.username])

  const restoreCall = useCallback(() => {
    setCallFocused(true)
  }, [])

  const toggleMic = () => { const track = localStream?.getAudioTracks()[0]; if (!track) return; track.enabled = !track.enabled; setMuted(!track.enabled) }
  const toggleCamera = () => { const track = localStream?.getVideoTracks()[0]; if (!track) return; track.enabled = !track.enabled; setCameraOff(!track.enabled) }
  const applySpeakerRoute = (enabled: boolean) => { setNativeSpeaker(enabled); setSpeakerOn(enabled) }
  const value = useMemo(() => ({ startCall }), [startCall])
  const showIncoming = !!incoming && !active
  const showOutgoing = !!active && active.status === 'ringing'
  const showActive = !!active && active.status === 'active'
  const showActiveFull = showActive && callFocused
  const showActiveCompact = showActive && !callFocused

  return <CallContext.Provider value={value}>
    {children}
    <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    {showIncoming && peer && <div className="fixed inset-0 z-[100] bg-[#08110f] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.10),transparent_36%)]" />
      <div className="relative min-h-[100dvh] flex flex-col items-center px-6 sm:px-8 pt-[calc(env(safe-area-inset-top)+48px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <div className="text-center min-w-0 w-full max-w-md">
          <p className="text-xs sm:text-sm text-white/55 mb-3">Yomy</p>
          <Avatar className="size-28 sm:size-36 mx-auto border-4 border-white/10 shadow-2xl"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl sm:text-5xl bg-white/10">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar>
          <h2 className="mt-5 sm:mt-6 text-2xl sm:text-3xl font-medium tracking-tight truncate">{peer.username}</h2>
          <p className="mt-2 text-sm sm:text-base text-white/60">Incoming {incoming?.kind === 'video' ? 'video' : 'voice'} call</p>
          <p className="mt-1 text-xs sm:text-sm text-white/40">Answer or decline</p>
        </div>
        <div className="mt-auto w-full max-w-sm grid grid-cols-2 gap-5 sm:gap-10 items-end pb-4 sm:pb-8">
          <div className="text-center">
            <Button variant="destructive" size="lg" className="mx-auto rounded-full size-16 sm:size-[68px] shadow-xl bg-red-600 hover:bg-red-700" onClick={() => void declineCall(incoming as CallSession)}><PhoneOff className="size-6 sm:size-7" /></Button>
            <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-white/70">Decline</p>
          </div>
          <div className="text-center">
            <Button size="lg" className="mx-auto rounded-full size-16 sm:size-[68px] shadow-xl bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => void acceptCall(incoming as CallSession, peer)}>{incoming?.kind === 'video' ? <Video className="size-6 sm:size-7" /> : <Phone className="size-6 sm:size-7" />}</Button>
            <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-white/70">Answer</p>
          </div>
        </div>
      </div>
    </div>}
    {showOutgoing && peer && <div className="fixed inset-0 z-[99] bg-black text-white flex min-h-[100dvh] flex-col items-center justify-center px-6 py-[calc(env(safe-area-inset-bottom)+28px)]">
      <Avatar className="size-28 sm:size-32 border-4 border-white/10"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl bg-white/10">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar>
      <h2 className="mt-5 text-xl sm:text-2xl font-semibold truncate max-w-[85vw]">{peer.username}</h2>
      <p className="mt-2 text-white/60">{outgoingStage === 'ringing' ? 'Ringing…' : 'Connecting…'}</p>
      <p className="mt-1 text-[11px] sm:text-xs text-white/35 text-center max-w-xs">{outgoingStage === 'ringing' ? 'The other device is being notified' : 'Waiting for the other device'}</p>
      <div className="mt-auto pt-8"><Button variant="destructive" size="lg" className="rounded-full size-16" onClick={() => void endCall()}><PhoneOff className="size-7" /></Button></div>
    </div>}
    {showActiveCompact && peer && <button type="button" onClick={restoreCall} className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+58px)] z-[99] -translate-x-1/2 w-[min(94vw,420px)] rounded-2xl border border-white/10 bg-black/90 px-3 py-2 text-white shadow-2xl backdrop-blur-xl text-left">
      <div className="flex items-center gap-3">
        <Avatar className="size-9 shrink-0"><AvatarImage src={peer.avatar_url} /><AvatarFallback>{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{peer.username}</p><p className="text-[11px] text-white/60">{connected ? 'In call • ' + formatDuration(elapsedSeconds) : 'Reconnecting…'}</p></div>
        <span className="size-2.5 rounded-full bg-emerald-400 animate-pulse" />
      </div>
    </button>}
    {showActiveFull && peer && <div className="fixed inset-0 z-[99] bg-black flex min-h-[100dvh] flex-col text-white">
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="min-w-0"><p className="truncate font-semibold text-lg">{peer.username}</p><p className="text-sm opacity-70">{connected ? formatDuration(elapsedSeconds) : 'Reconnecting audio…'}</p></div>
        <Button variant="ghost" size="icon" className="size-10 rounded-full text-white/80 hover:bg-white/10 hover:text-white" onClick={minimizeCall} aria-label="Minimize call"><ChevronDown className="size-5" /></Button>
      </div>
      <div className="relative min-h-0 flex-1 flex items-center justify-center p-3 sm:p-4">
        {active?.kind === 'video' ? <><MediaView stream={remoteStream} /><div className="absolute right-3 sm:right-5 top-3 sm:top-5 w-[26vw] max-w-32 min-w-24 aspect-video rounded-xl overflow-hidden border border-white/30 shadow-xl"><MediaView stream={localStream} muted /></div></> : <div className="size-32 sm:size-40 rounded-full overflow-hidden"><Avatar className="size-full"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div>}
      </div>
      <div className="flex shrink-0 justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+22px)] pt-4 sm:gap-4">
        <Button variant={speakerOn ? 'secondary' : 'outline'} size="icon" className="size-11 rounded-full sm:size-12" onClick={() => applySpeakerRoute(!speakerOn)} aria-label={speakerOn ? 'Use earpiece' : 'Use speaker'}>{speakerOn ? <Volume2 /> : <VolumeX />}</Button>
        <Button variant={muted ? 'secondary' : 'outline'} size="icon" className="size-11 rounded-full sm:size-12" onClick={toggleMic}>{muted ? <MicOff /> : <Mic />}</Button>
        {active?.kind === 'video' && <Button variant={cameraOff ? 'secondary' : 'outline'} size="icon" className="size-11 rounded-full sm:size-12" onClick={toggleCamera}>{cameraOff ? <VideoOff /> : <Video />}</Button>}
        <Button variant="destructive" size="icon" className="size-13 rounded-full" onClick={() => void endCall()}><PhoneOff /></Button>
      </div>
    </div>}
  </CallContext.Provider>
}

export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used inside CallProvider'); return value }
