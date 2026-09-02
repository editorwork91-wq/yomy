import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { sendPushEvent } from '@/lib/push'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

type CallKind = 'voice' | 'video'
type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed'
type Signal = { id: number; call_id: string; sender_id: string; recipient_id: string; signal_type: string; payload: Record<string, unknown> }
type CallSession = { id: string; caller_id: string; callee_id: string; kind: CallKind; status: CallStatus; created_at: string; answered_at?: string | null }
type Peer = { id: string; username: string; full_name: string; avatar_url: string }
type CallContextValue = { startCall: (peer: Peer, kind: CallKind) => Promise<void> }

const CallContext = createContext<CallContextValue | null>(null)
const TURN_URLS = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map(v => v.trim()).filter(Boolean) || []
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...((TURN_URLS.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL)
    ? [{ urls: TURN_URLS, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }]
    : []),
]

function MediaView({ stream, muted }: { stream: MediaStream | null; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className="w-full h-full object-cover rounded-2xl" />
}

export default function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [incoming, setIncoming] = useState<CallSession | null>(null)
  const [active, setActive] = useState<CallSession | null>(null)
  const [peer, setPeer] = useState<Peer | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const activeRef = useRef<CallSession | null>(null)
  const processedSignals = useRef(new Set<number>())
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const timeoutRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    setLocalStream(current => { current?.getTracks().forEach(track => track.stop()); return null })
    setRemoteStream(null)
    setConnected(false)
    setMuted(false)
    setCameraOff(false)
    activeRef.current = null
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
    if (error) console.error('call signal failed:', error.message)
  }, [user])

  const setupPeer = useCallback(async (call: CallSession, caller: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' })
    setLocalStream(stream)
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc
    stream.getTracks().forEach(track => pc.addTrack(track, stream))
    const remote = new MediaStream()
    setRemoteStream(remote)
    pc.ontrack = event => event.streams[0]?.getTracks().forEach(track => { if (!remote.getTracks().some(t => t.id === track.id)) remote.addTrack(track) })
    pc.onicecandidate = event => { if (event.candidate) void sendSignal(call, 'ice-candidate', event.candidate.toJSON()) }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setConnected(true)
      if (pc.connectionState === 'failed') {
        void supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id)
        cleanup(); toast.error('Call connection failed')
      }
    }
    if (caller) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: call.kind === 'video' })
      await pc.setLocalDescription(offer)
      await sendSignal(call, 'offer', offer as unknown as Record<string, unknown>)
    }
    return pc
  }, [cleanup, sendSignal])

  const startCall = useCallback(async (target: Peer, kind: CallKind) => {
    if (!user || activeRef.current || incoming) return
    if (!navigator.mediaDevices?.getUserMedia) return toast.error('Microphone/camera is not available in this browser')
    const { data, error } = await supabase.from('call_sessions').insert({ caller_id: user.id, callee_id: target.id, kind, status: 'ringing' }).select('*').single()
    if (error || !data) return toast.error(error?.message || 'Could not start call')
    const call = data as CallSession
    activeRef.current = call; setActive(call); setPeer(target)
    try {
      await setupPeer(call, true)
      await sendPushEvent({ type: 'call', targetUserId: target.id, title: kind === 'video' ? 'Incoming video call' : 'Incoming call', body: `Someone is calling you on Yomy`, data: { url: `/messages/${target.username}?call=${call.id}`, call_id: call.id } })
      timeoutRef.current = window.setTimeout(async () => {
        if (activeRef.current?.id === call.id) {
          await supabase.from('call_sessions').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', call.id)
          cleanup()
        }
      }, 45000)
    } catch (err) {
      await supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id)
      cleanup(); toast.error(err instanceof Error ? err.message : 'Could not access microphone/camera')
    }
  }, [cleanup, incoming, setupPeer, user])

  const acceptIncoming = useCallback(async () => {
    if (!incoming || !user) return
    const call = incoming
    const callerProfile = await profileFor(call.caller_id)
    if (!callerProfile) return toast.error('Caller profile not found')
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from('call_sessions').update({ status: 'active', answered_at: now, started_at: now }).eq('id', call.id).eq('callee_id', user.id)
      if (error) throw error
      activeRef.current = { ...call, status: 'active' }; setActive({ ...call, status: 'active' }); setIncoming(null); setPeer(callerProfile)
      const pc = await setupPeer(call, false)
      const { data: signals } = await supabase.from('call_signals').select('*').eq('call_id', call.id).order('id')
      const candidates: Signal[] = []
      for (const signal of (signals || []) as Signal[]) {
        if (signal.signal_type === 'offer') {
          processedSignals.current.add(signal.id)
          await pc?.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit)
          const answer = await pc?.createAnswer()
          if (answer && pc) { await pc.setLocalDescription(answer); await sendSignal(call, 'answer', answer as unknown as Record<string, unknown>) }
        } else if (signal.signal_type === 'ice-candidate') candidates.push(signal)
      }
      for (const signal of candidates) { processedSignals.current.add(signal.id); await pc?.addIceCandidate(signal.payload as RTCIceCandidateInit) }
    } catch (err) {
      await supabase.from('call_sessions').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', call.id)
      cleanup(); toast.error(err instanceof Error ? err.message : 'Could not answer call')
    }
  }, [cleanup, incoming, profileFor, sendSignal, setupPeer, user])

  const declineIncoming = useCallback(async () => {
    if (!incoming || !user) return
    await supabase.from('call_sessions').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', incoming.id).eq('callee_id', user.id)
    cleanup()
  }, [cleanup, incoming, user])

  const endCall = useCallback(async () => {
    const call = activeRef.current
    if (call) { await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', call.id); await sendSignal(call, 'hangup', {}) }
    cleanup()
  }, [cleanup, sendSignal])

  useEffect(() => {
    if (!user) return
    let mounted = true
    const loadRinging = async () => {
      const { data } = await supabase.from('call_sessions').select('*').eq('callee_id', user.id).eq('status', 'ringing').order('created_at', { ascending: false }).limit(1)
      if (mounted && data?.[0] && !activeRef.current) { const call = data[0] as CallSession; const p = await profileFor(call.caller_id); if (p) { setIncoming(call); setPeer(p) } }
    }
    void loadRinging()
    const channel = supabase.channel(`calls-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${user.id}` }, async payload => {
        const call = payload.new as CallSession
        if (call.status !== 'ringing' || activeRef.current) return
        const p = await profileFor(call.caller_id); if (p) { setIncoming(call); setPeer(p) }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions' }, payload => {
        const call = payload.new as CallSession
        if (call.id !== activeRef.current?.id) return
        if (['declined','missed','failed','ended'].includes(call.status)) cleanup()
        else if (call.status === 'active') setActive(call)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `recipient_id=eq.${user.id}` }, async payload => {
        const signal = payload.new as Signal
        const call = activeRef.current; const pc = pcRef.current
        if (!call || signal.call_id !== call.id || processedSignals.current.has(signal.id) || !pc) return
        processedSignals.current.add(signal.id)
        try {
          if (signal.signal_type === 'answer') {
            await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit)
            for (const candidate of pendingCandidates.current) await pc.addIceCandidate(candidate)
            pendingCandidates.current = []
          } else if (signal.signal_type === 'ice-candidate') {
            if (pc.remoteDescription) await pc.addIceCandidate(signal.payload as RTCIceCandidateInit)
            else pendingCandidates.current.push(signal.payload as RTCIceCandidateInit)
          } else if (signal.signal_type === 'hangup') cleanup()
        } catch (err) { console.error('signal handling failed:', err) }
      })
      .subscribe()
    return () => { mounted = false; void supabase.removeChannel(channel) }
  }, [cleanup, profileFor, user])

  const toggleMic = () => { const track = localStream?.getAudioTracks()[0]; if (!track) return; track.enabled = !track.enabled; setMuted(!track.enabled) }
  const toggleCamera = () => { const track = localStream?.getVideoTracks()[0]; if (!track) return; track.enabled = !track.enabled; setCameraOff(!track.enabled) }
  const value = useMemo(() => ({ startCall }), [startCall])

  return <CallContext.Provider value={value}>
    {children}
    {incoming && !active && peer && <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-sm rounded-3xl bg-card p-6 text-center shadow-2xl"><Avatar className="size-24 mx-auto mb-4"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-3xl">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar><h2 className="text-xl font-semibold">{peer.username}</h2><p className="text-muted-foreground mb-6">Incoming {incoming.kind === 'video' ? 'video' : 'voice'} call</p><div className="flex justify-center gap-5"><Button variant="destructive" size="lg" className="rounded-full size-14" onClick={() => void declineIncoming()}><PhoneOff /></Button><Button size="lg" className="rounded-full size-14" onClick={() => void acceptIncoming()}>{incoming.kind === 'video' ? <Video /> : <Phone />}</Button></div></div></div>}
    {active && peer && <div className="fixed inset-0 z-[99] bg-black flex flex-col"><div className="flex items-center justify-between p-4 text-white"><div><p className="font-semibold">{peer.username}</p><p className="text-xs opacity-70">{connected ? 'Connected' : 'Connecting…'}</p></div><Avatar className="size-10"><AvatarImage src={peer.avatar_url} /><AvatarFallback>{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div><div className="relative flex-1 flex items-center justify-center p-4">{active.kind === 'video' ? <><MediaView stream={remoteStream} /><div className="absolute top-6 right-6 w-28 aspect-video rounded-xl overflow-hidden border border-white/30"><MediaView stream={localStream} muted /></div></> : <><div className="size-36 rounded-full overflow-hidden"><Avatar className="size-full"><AvatarImage src={peer.avatar_url} /><AvatarFallback className="text-4xl">{peer.username[0]?.toUpperCase()}</AvatarFallback></Avatar></div><div className="absolute w-px h-px overflow-hidden"><MediaView stream={remoteStream} /></div></>}</div><div className="flex justify-center gap-4 p-6"><Button variant={muted ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={toggleMic}>{muted ? <MicOff /> : <Mic />}</Button>{active.kind === 'video' && <Button variant={cameraOff ? 'secondary' : 'outline'} size="icon" className="rounded-full size-12" onClick={toggleCamera}>{cameraOff ? <VideoOff /> : <Video />}</Button>}<Button variant="destructive" size="icon" className="rounded-full size-14" onClick={() => void endCall()}><PhoneOff /></Button></div></div>}
  </CallContext.Provider>
}

export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used inside CallProvider'); return value }
