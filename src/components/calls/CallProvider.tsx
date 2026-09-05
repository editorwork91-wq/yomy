import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Phone, Video, Mic, MicOff, PhoneOff, Volume2, VolumeX, VideoOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { sendPushEvent } from '@/lib/push'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

type CallKind = 'voice' | 'video'
type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed'
type Signal = { id: number; call_id: string; sender_id: string; recipient_id: string; signal_type: string; payload: Record<string, unknown> }
type CallSession = { id: string; caller_id: string; callee_id: string; kind: CallKind; status: CallStatus; created_at: string; answered_at?: string | null; started_at?: string | null }
type Peer = { id: string; username: string; full_name: string; avatar_url: string }
type CallContextValue = { startCall: (peer: Peer, kind: CallKind) => Promise<void> }
type AudioRouteBridge = { setSpeaker: (enabled: boolean) => void }
type NativeNotificationBridge = { stopCall?: () => void; getPendingCallAction?: () => string; clearPendingCallAction?: () => void }

const CALL_RING_TIMEOUT_MS = 60_000
const CallContext = createContext<CallContextValue | null>(null)
const TURN_URLS = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map(v => v.trim()).filter(Boolean) || []
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...((TURN_URLS.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL)
    ? [{ urls: TURN_URLS, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }]
    : []),
]

function getNativeNotifications() { return (window as Window & { YomyNotification?: NativeNotificationBridge }).YomyNotification }
function stopNativeCallNotification() { getNativeNotifications()?.stopCall?.() }
function MediaView({ stream, muted }: { stream: MediaStream | null; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className="w-full h-full object-cover rounded-2xl" />
}
function setNativeSpeaker(enabled: boolean) { const bridge = (window as Window & { YomyAudio?: AudioRouteBridge }).YomyAudio; if (bridge?.setSpeaker) bridge.setSpeaker(enabled) }
function formatDuration(totalSeconds: number) { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0'); const seconds = (totalSeconds % 60).toString().padStart(2, '0'); return `${minutes}:${seconds}` }

export default function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth(); const location = useLocation(); const navigate = useNavigate()
  const [incoming, setIncoming] = useState<CallSession | null>(null); const [active, setActive] = useState<CallSession | null>(null); const [peer, setPeer] = useState<Peer | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null); const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null); const [connected, setConnected] = useState(false)
  const [muted, setMuted] = useState(false); const [cameraOff, setCameraOff] = useState(false); const [speakerOn, setSpeakerOn] = useState(false); const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const pcRef = useRef<RTCPeerConnection | null>(null); const activeRef = useRef<CallSession | null>(null); const processedSignals = useRef(new Set<number>()); const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const remoteAudioRef = useRef<HTMLAudioElement>(null); const timeoutRef = useRef<number | null>(null); const handledNativeActionsRef = useRef(new Set<string>())
  useEffect(() => { if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream }, [remoteStream])

  const cleanup = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current); timeoutRef.current = null; stopNativeCallNotification(); setNativeSpeaker(false); pcRef.current?.close(); pcRef.current = null
    setLocalStream(current => { current?.getTracks().forEach(track => track.stop()); return null }); setRemoteStream(null); setConnected(false); setMuted(false); setCameraOff(false); setSpeakerOn(false); setElapsedSeconds(0)
    activeRef.current = null; setActive(null); setIncoming(null); setPeer(null); processedSignals.current.clear(); pendingCandidates.current = []
  }, [])
  const profileFor = useCallback(async (id: string) => { const { data } = await supabase.from('profiles').select('id,username,full_name,avatar_url').eq('id', id).maybeSingle(); return data as Peer | null }, [])
  const openCallRoute = useCallback((callerProfile: Peer, callId: string) => { const username = callerProfile.username; if (!username) return; const destination = `/messages/${encodeURIComponent(username)}?call=${encodeURIComponent(callId)}`; if (location.pathname !== `/messages/${username}` || location.search !== `?call=${callId}`) navigate(destination, { replace: false }) }, [location.pathname, location.search, navigate])
  const loadIncomingById = useCallback(async (callId: string) => {
    if (!user || !callId) return null; const { data, error } = await supabase.from('call_sessions').select('*').eq('id', callId).eq('callee_id', user.id).maybeSingle(); if (error || !data) return null
    const call = data as CallSession; if (call.status !== 'ringing') return null
    if (Date.now() - new Date(call.created_at).getTime() >= CALL_RING_TIMEOUT_MS) { await supabase.from('call_sessions').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', call.id).eq('callee_id', user.id).eq('status', 'ringing'); return null }
    const callerProfile = await profileFor(call.caller_id); if (!callerProfile) return null; setIncoming(call); setPeer(callerProfile); return { call, callerProfile }
  }, [profileFor, user])
  const sendSignal = useCallback(async (call: CallSession, signalType: string, payload: Record<string, unknown>) => { if (!user) return; const recipientId = call.caller_id === user.id ? call.callee_id : call.caller_id; const { error } = await supabase.from('call_signals').insert({ call_id: call.id, sender_id: user.id, recipient_id: recipientId, signal_type: signalType, payload }); if (error) console.error('call signal failed:', error.message) }, [user])
  const applySpeakerRoute = useCallback((enabled: boolean) => { setNativeSpeaker(enabled); setSpeakerOn(enabled) }, [])
  const setupPeer = useCallback(async (call: CallSession, caller: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' }); setLocalStream(stream); setNativeSpeaker(call.kind === 'video'); setSpeakerOn(call.kind === 'video')
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }); pcRef.current = pc; stream.getTracks().forEach(track => pc.addTrack(track, stream)); const remote = new MediaStream(); setRemoteStream(remote)
    pc.ontrack = event => event.streams[0]?.getTracks().forEach(track => { if (!remote.getTracks().some(t => t.id === track.id)) remote.addTrack(track) })
    pc.onicecandidate = event => { if (event.candidate) void sendSignal(call, 'ice-candidate', event.candidate.toJSON() as unknown as Record<string, unknown>) }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') setConnected(true); if (pc.connectionState === 'failed') { void supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id); cleanup(); toast.error('Call connection failed') } }
    if (caller) { const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: call.kind === 'video' }); await pc.setLocalDescription(offer); await sendSignal(call, 'offer', offer as unknown as Record<string, unknown>) }
    return pc
  }, [cleanup, sendSignal])
  const startCall = useCallback(async (target: Peer, kind: CallKind): Promise<void> => {
    if (!user || activeRef.current || incoming) return; if (!navigator.mediaDevices?.getUserMedia) { toast.error('Microphone/camera is not available in this browser'); return }
    const { data, error } = await supabase.from('call_sessions').insert({ caller_id: user.id, callee_id: target.id, kind, status: 'ringing' }).select('*').single(); if (error || !data) { toast.error(error?.message || 'Could not start call'); return }
    const call = data as CallSession; activeRef.current = call; setActive(call); setPeer(target)
    try {
      await setupPeer(call, true); const callerLabel = String(user.user_metadata?.username || user.user_metadata?.full_name || 'Yomy')
      await sendPushEvent({ type: 'call', targetUserId: target.id, title: callerLabel, body: kind === 'video' ? 'Incoming video call' : 'Incoming voice call', data: { url: `/messages/${callerLabel}?call=${call.id}`, call_id: call.id, call_kind: kind, kind } })
      timeoutRef.current = window.setTimeout(async () => { if (activeRef.current?.id === call.id && activeRef.current?.status === 'ringing') { await supabase.from('call_sessions').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', call.id).eq('status', 'ringing'); cleanup() } }, CALL_RING_TIMEOUT_MS)
    } catch (err) { await supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id); cleanup(); toast.error(err instanceof Error ? err.message : 'Could not access microphone/camera') }
  }, [cleanup, incoming, sendPushEvent, setupPeer, user])
  const acceptCall = useCallback(async (call: CallSession, callerProfile: Peer) => {
    if (!user || call.status !== 'ringing') return; stopNativeCallNotification()
    try {
      const now = new Date().toISOString(); const { data: activated, error: activationError } = await supabase.from('call_sessions').update({ status: 'active', answered_at: now, started_at: now }).eq('id', call.id).eq('callee_id', user.id).eq('status', 'ringing').select('id').maybeSingle(); if (activationError) throw activationError; if (!activated) return
      activeRef.current = { ...call, status: 'active', answered_at: now, started_at: now }; setActive(activeRef.current); setIncoming(null); setPeer(callerProfile); openCallRoute(callerProfile, call.id)
      const pc = await setupPeer(activeRef.current, false); const { data: signals } = await supabase.from('call_signals').select('*').eq('call_id', call.id).order('id'); const candidates: Signal[] = []
      for (const signal of (signals || []) as Signal[]) { if (signal.signal_type === 'offer') { processedSignals.current.add(signal.id); await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await sendSignal(call, 'answer', answer as unknown as Record<string, unknown>) } else if (signal.signal_type === 'ice-candidate') candidates.push(signal) }
      for (const signal of candidates) { processedSignals.current.add(signal.id); await pc.addIceCandidate(signal.payload as RTCIceCandidateInit) }; for (const candidate of pendingCandidates.current) await pc.addIceCandidate(candidate); pendingCandidates.current = []
    } catch (err) { await supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id); cleanup(); toast.error(err instanceof Error ? err.message : 'Could not answer call') }
  }, [cleanup, openCallRoute, sendSignal, setupPeer, user])
  const acceptIncoming = useCallback(async () => { if (!incoming || !peer) return; await acceptCall(incoming, peer) }, [acceptCall, incoming, peer])
  const declineCall = useCallback(async (call: CallSession) => { if (!user || call.status !== 'ringing') return; stopNativeCallNotification(); await supabase.from('call_sessions').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', call.id).eq('callee_id', user.id).eq('status', 'ringing'); cleanup() }, [cleanup, user])
  const declineIncoming = useCallback(async () => { if (incoming) await declineCall(incoming) }, [declineCall, incoming])
  const endCall = useCallback(async () => { const call = activeRef.current; if (call) { await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', call.id); await sendSignal(call, 'hangup', {}) }; cleanup() }, [cleanup, sendSignal])

  useEffect(() => {
    if (!user) return; let mounted = true
    const loadRinging = async () => { const { data } = await supabase.from('call_sessions').select('*').eq('callee_id', user.id).eq('status', 'ringing').order('created_at', { ascending: false }).limit(5); if (!mounted || activeRef.current) return; for (const row of (data || []) as CallSession[]) { const loaded = await loadIncomingById(row.id); if (loaded) break } }
    void loadRinging()
    const channel = supabase.channel(`calls-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${user.id}` }, async payload => { const call = payload.new as CallSession; if (call.status !== 'ringing' || activeRef.current) return; const loaded = await loadIncomingById(call.id); if (loaded && !activeRef.current) openCallRoute(loaded.callerProfile, loaded.call.id) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions' }, payload => { const call = payload.new as CallSession; if (call.id === incoming?.id && ['declined','missed','failed','ended','active'].includes(call.status)) { stopNativeCallNotification(); if (call.status !== 'active') { setIncoming(null); setPeer(null) } }; if (call.id !== activeRef.current?.id) return; if (['declined','missed','failed','ended'].includes(call.status)) cleanup(); else if (call.status === 'active') { activeRef.current = call; setActive(call) } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `recipient_id=eq.${user.id}` }, async payload => { const signal = payload.new as Signal; const call = activeRef.current; const pc = pcRef.current; if (!call || signal.call_id !== call.id || processedSignals.current.has(signal.id) || !pc) return; processedSignals.current.add(signal.id); try { if (signal.signal_type === 'answer') { await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit); for (const candidate of pendingCandidates.current) await pc.addIceCandidate(candidate); pendingCandidates.current = [] } else if (signal.signal_type === 'ice-candidate') { if (pc.remoteDescription) await pc.addIceCandidate(signal.payload as RTCIceCandidateInit); else pendingCandidates.current.push(signal.payload as RTCIceCandidateInit) } else if (signal.signal_type === 'hangup') cleanup() } catch (err) { console.error('signal handling failed:', err) } })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') console.warn('Call realtime degraded; call state reconciliation active') })
    return () => { mounted = false; void supabase.removeChannel(channel) }
  }, [cleanup, incoming?.id, loadIncomingById, openCallRoute, user])

  const handleNativeAction = useCallback(async (action: string, callId: string) => {
    if (!action || !callId || !user) return; const dedupeKey = `${action}:${callId}`; if (handledNativeActionsRef.current.has(dedupeKey)) return; handledNativeActionsRef.current.add(dedupeKey)
    const loaded = await loadIncomingById(callId); if (!loaded) { getNativeNotifications()?.clearPendingCallAction?.(); return }
    if (action === 'open') openCallRoute(loaded.callerProfile, callId); else if (action === 'accept') await acceptCall(loaded.call, loaded.callerProfile); else if (action === 'decline') await declineCall(loaded.call)
    getNativeNotifications()?.clearPendingCallAction?.(); window.setTimeout(() => handledNativeActionsRef.current.delete(dedupeKey), 2000)
  }, [acceptCall, declineCall, loadIncomingById, openCallRoute, user])

  useEffect(() => {
    const bridge = getNativeNotifications(); const processPending = async () => { const pending = bridge?.getPendingCallAction?.() || ''; if (!pending) return; const splitAt = pending.indexOf('|'); if (splitAt <= 0) return; await handleNativeAction(pending.slice(0, splitAt), pending.slice(splitAt + 1)) }
    void processPending(); const onNativeAction = (event: Event) => { const detail = (event as CustomEvent<{ action?: string; callId?: string }>).detail; if (detail?.action && detail.callId) void handleNativeAction(detail.action, detail.callId) }
    window.addEventListener('yomy-call-action', onNativeAction); return () => window.removeEventListener('yomy-call-action', onNativeAction)
  }, [handleNativeAction])

  useEffect(() => { if (!active || active.status !== 'active') { setElapsedSeconds(0); return }; const startAt = new Date(active.started_at || active.answered_at || active.created_at).getTime(); const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startAt) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer) }, [active])
  useEffect(() => { const callId = new URLSearchParams(location.search).get('call'); if (!callId || !user || activeRef.current) return; void loadIncomingById(callId) }, [location.search, loadIncomingById, user])
  const toggleMic = () => { const track = localStream?.getAudioTracks()[0]; if (!track) return; track.enabled = !track.enabled; setMuted(!track.enabled) }
  const toggleCamera = () => { const track = localStream?.getVideoTracks()[0]; if (!track) return; track.enabled = !track.enabled; setCameraOff(!track.enabled) }
  const value = useMemo(() => ({ startCall }), [startCall]); const showIncoming = !!incoming && !active; const showOutgoing = !!active && active.status === 'ringing'; const showActive = !!active && active.status === 'active'
  return <CallContext.Provider value={value}>{children}<audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    {showIncoming && peer && <div className="fixed inset-0 z-[100] bg-[#08110f] text-white overflow-hidden"><div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.10),transparent_36%)]" /><div className="relative min-h-full flex flex-col items-center px-7 pt-20 pb-10"><div className="text-center"><p className="text-sm text-white/55 mb-3">Yomy</p><Avatar className="size-36 mx-auto border-4 border-white/10 shadow-2xl"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl bg-white/10">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar><h2 className="mt-6 text-3xl font-medium tracking-tight">{peer.username}</h2><p className="mt-2 text-base text-white/60">Incoming {incoming.kind === 'video' ? 'video' : 'voice'} call</p><p className="mt-1 text-sm text-white/40">Swipe up to accept</p></div><div className="mt-auto w-full max-w-sm grid grid-cols-2 gap-10 items-end pb-8"><div className="text-center"><Button variant="destructive" size="lg" className="mx-auto rounded-full size-[68px] shadow-xl bg-red-600 hover:bg-red-700" onClick={() => void declineIncoming()}><PhoneOff className="size-7" /></Button><p className="mt-3 text-sm text-white/70">Decline</p></div><div className="text-center"><Button size="lg" className="mx-auto rounded-full size-[68px] shadow-xl bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => void acceptIncoming()}>{incoming.kind === 'video' ? <Video className="size-7" /> : <Phone className="size-7" />}</Button><p className="mt-3 text-sm text-white/70">Answer</p></div></div></div></div>}
    {showOutgoing && peer && <div className="fixed inset-0 z-[99] bg-black text-white flex flex-col items-center justify-center p-7"><Avatar className="size-32 border-4 border-white/10"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl bg-white/10">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar><h2 className="mt-6 text-2xl font-semibold">{peer.username}</h2><p className="mt-2 text-white/60">Calling…</p><div className="mt-auto pb-12"><Button variant="destructive" size="lg" className="rounded-full size-16" onClick={() => void endCall()}><PhoneOff className="size-7" /></Button></div></div>}
    {showActive && peer && <div className="fixed inset-0 z-[99] bg-black flex flex-col text-white"><div className="flex items-center justify-between p-4 pt-6"><div><p className="font-semibold text-lg">{peer.username}</p><p className="text-sm opacity-70">{connected ? formatDuration(elapsedSeconds) : 'Connecting…'}</p></div><Avatar className="size-10"><AvatarImage src={peer.avatar_url} /><AvatarFallback>{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div><div className="relative flex-1 flex items-center justify-center p-4">{active?.kind === 'video' ? <><MediaView stream={remoteStream} /><div className="absolute top-6 right-6 w-28 aspect-video rounded-xl overflow-hidden border border-white/30"><MediaView stream={localStream} muted /></div></> : <div className="size-40 rounded-full overflow-hidden"><Avatar className="size-full"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div>}</div><div className="flex justify-center gap-4 p-6 pb-10"><Button variant={speakerOn ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={() => applySpeakerRoute(!speakerOn)} aria-label={speakerOn ? 'Use earpiece' : 'Use speaker'}>{speakerOn ? <Volume2 /> : <VolumeX />}</Button><Button variant={muted ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={toggleMic}>{muted ? <MicOff /> : <Mic />}</Button>{active.kind === 'video' && <Button variant={cameraOff ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={toggleCamera}>{cameraOff ? <VideoOff /> : <Video />}</Button>}<Button variant="destructive" size="icon" className="rounded-full size-14" onClick={() => void endCall()}><PhoneOff /></Button></div></div>}
  </CallContext.Provider>
}
export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used inside CallProvider'); return value }
