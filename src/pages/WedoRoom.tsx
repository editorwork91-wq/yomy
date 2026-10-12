import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowLeft, AudioLines, CheckCheck, CircleHelp, Headphones, MessageCircle,
  Mic, MicOff, MonitorUp, PhoneOff, Send, Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useYomyLanguage } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

type WedoRoom = {
  id: string
  created_by: string
  friend_id: string
  title: string
  status: 'active' | 'ended' | 'cancelled'
  created_at: string
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
}
type WedoMessage = {
  id: string
  room_id: string
  sender_id: string
  content: string
  created_at: string
  client_message_id: string | null
}
type SignalPayload = {
  from?: string
  kind?: 'description' | 'candidate' | 'sharing' | 'peer-ready'
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  active?: boolean
}
type PeerWire = {
  peer: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  videoSender: RTCRtpSender
}
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

function userFacingError(error: unknown, rtl: boolean) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/WEDO_FRIENDS_ONLY/.test(message)) return rtl ? 'غرفة Wedo متاحة بين الأصدقاء المتبادلين فقط.' : 'Wedo rooms are available between mutual friends only.'
  if (/WEDO_PEER_SLEEPING/.test(message)) return rtl ? 'صديقك في وضع النوم الآن.' : 'Your friend is in Sleep mode right now.'
  if (/WEDO_ROOM_NOT_FOUND|WEDO_NOT_PARTICIPANT/.test(message)) return rtl ? 'الغرفة غير موجودة أو لا تملك صلاحية دخولها.' : 'This room does not exist or you do not have access.'
  if (/Permission denied|permission|NotAllowedError/i.test(message)) return rtl ? 'اسمح باستخدام الميكروفون أو مشاركة الشاشة من إعدادات الجهاز.' : 'Allow microphone or screen-capture access in your device settings.'
  if (/NotFoundError|DevicesNotFoundError/i.test(message)) return rtl ? 'لم يتم العثور على ميكروفون متاح.' : 'No microphone was found.'
  return message || (rtl ? 'تعذر إكمال العملية.' : 'Something went wrong.')
}

export default function WedoRoomPage() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { language } = useYomyLanguage()
  const rtl = language === 'ar'
  const [room, setRoom] = useState<WedoRoom | null>(null)
  const [friend, setFriend] = useState<{ id: string; username: string; full_name: string; avatar_url: string } | null>(null)
  const [messages, setMessages] = useState<WedoMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [channelReady, setChannelReady] = useState(false)
  const [joining, setJoining] = useState(false)
  const [inSession, setInSession] = useState(false)
  const [micEnabled, setMicEnabled] = useState(true)
  const [screenActive, setScreenActive] = useState(false)
  const [remoteScreenActive, setRemoteScreenActive] = useState(false)
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null)
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null)
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'idle'>('idle')
  const [chatOpen, setChatOpen] = useState(true)
  const [sending, setSending] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const peerWireRef = useRef<PeerWire | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef(new MediaStream())
  const remoteAudioRef = useRef(new MediaStream())
  const remoteVideoElementRef = useRef<HTMLVideoElement>(null)
  const remoteAudioElementRef = useRef<HTMLAudioElement>(null)
  const localPreviewRef = useRef<HTMLVideoElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const pendingSignalsRef = useRef<SignalPayload[]>([])
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const screenAudioSendersRef = useRef<RTCRtpSender[]>([])
  const endedHandledRef = useRef(false)
  const friendRef = useRef<typeof friend>(null)
  const currentUserId = user?.id || ''
  const screenApiAvailable = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices)

  const copy = {
    en: {
      title: 'Wedo!', subtitle: 'A little room to be together.', private: 'Private room · Only you and your friend',
      screen: 'Share screen', stopScreen: 'Stop sharing', micOn: 'Mute mic', micOff: 'Turn mic on', leave: 'End room',
      connect: 'Join room', waiting: 'Waiting for your friend…', connected: 'Live connection', connecting: 'Connecting securely…',
      idle: 'Ready when you are', remoteScreen: 'Your friend is sharing their screen', localScreen: 'You are sharing your screen',
      stageTitle: 'Your shared space', screenUnavailable: 'Screen sharing is unavailable in this app environment. Open the secure YOMY website in a supported browser to share your screen.',
      chat: 'Room chat', chatPlaceholder: 'Send a quick message…', send: 'Send',
      empty: 'Say hello — the room chat will be saved into your personal chat when Wedo ends.',
      return: 'Return to personal chat', saved: 'Room chat saved in your personal conversation.',
      secure: 'Private connection', noScreen: 'Start sharing your screen to show something live',
      elapsed: 'Time together', shareHint: 'Both people can share their screen. The current share can be stopped at any time.',
      screenError: 'Screen sharing could not start. Check browser support and permissions.',
    },
    ar: {
      title: 'Wedo!', subtitle: 'مساحة صغيرة تجمعكم.', private: 'غرفة خاصة · أنت وصديقك فقط',
      screen: 'مشاركة الشاشة', stopScreen: 'إيقاف المشاركة', micOn: 'كتم الميكروفون', micOff: 'تشغيل الميكروفون', leave: 'إنهاء الغرفة',
      connect: 'دخول الغرفة', waiting: 'بانتظار صديقك…', connected: 'اتصال مباشر', connecting: 'جارٍ إنشاء الاتصال…',
      idle: 'الغرفة جاهزة عندما تكون مستعدًا', remoteScreen: 'صديقك يشارك شاشته الآن', localScreen: 'أنت تشارك شاشتك الآن',
      stageTitle: 'مساحتكما المشتركة', screenUnavailable: 'مشاركة الشاشة غير متاحة داخل بيئة التطبيق الحالية. افتح موقع YOMY الآمن في متصفح يدعم مشاركة الشاشة.',
      chat: 'دردشة الغرفة', chatPlaceholder: 'اكتب رسالة سريعة…', send: 'إرسال',
      empty: 'ابدأ الحديث — ستُحفظ دردشة الغرفة في محادثتكما الشخصية عند إنهاء Wedo.',
      return: 'العودة إلى المحادثة الشخصية', saved: 'حُفظت دردشة الغرفة داخل محادثتكما الشخصية.',
      secure: 'اتصال مباشر خاص', noScreen: 'ابدأ مشاركة الشاشة لعرض ما تريده مباشرةً',
      elapsed: 'وقتكما معًا', shareHint: 'يمكن لكليكما مشاركة الشاشة، ويمكن إيقاف المشاركة في أي وقت.',
      screenError: 'تعذرت مشاركة الشاشة. تحقق من دعم المتصفح والأذونات.',
    },
    de: {
      title: 'Wedo!', subtitle: 'Ein kleiner Raum zum Zusammensein.', private: 'Privater Raum · Nur ihr beide',
      screen: 'Bildschirm teilen', stopScreen: 'Freigabe beenden', micOn: 'Mikrofon stumm', micOff: 'Mikrofon aktivieren', leave: 'Raum beenden',
      connect: 'Raum betreten', waiting: 'Warte auf deinen Freund…', connected: 'Live-Verbindung', connecting: 'Verbindung wird aufgebaut…',
      idle: 'Bereit, wenn du es bist', remoteScreen: 'Dein Freund teilt den Bildschirm', localScreen: 'Du teilst deinen Bildschirm',
      stageTitle: 'Euer gemeinsamer Raum', screenUnavailable: 'Bildschirmfreigabe ist hier nicht verfügbar. Öffne YOMY in einem unterstützten Browser.',
      chat: 'Raum-Chat', chatPlaceholder: 'Nachricht schreiben…', send: 'Senden',
      empty: 'Der Raum-Chat wird nach Ende von Wedo in eurem persönlichen Chat gespeichert.',
      return: 'Zum persönlichen Chat', saved: 'Der Raum-Chat wurde gespeichert.', secure: 'Private Verbindung',
      noScreen: 'Teile deinen Bildschirm, um etwas live zu zeigen.', elapsed: 'Zeit zusammen',
      shareHint: 'Beide können ihren Bildschirm teilen.', screenError: 'Bildschirmfreigabe fehlgeschlagen.',
    },
    fr: {
      title: 'Wedo!', subtitle: 'Un petit espace pour être ensemble.', private: 'Salle privée · Vous deux uniquement',
      screen: 'Partager l’écran', stopScreen: 'Arrêter le partage', micOn: 'Couper le micro', micOff: 'Activer le micro', leave: 'Terminer la salle',
      connect: 'Rejoindre', waiting: 'En attente de votre ami…', connected: 'Connexion en direct', connecting: 'Connexion en cours…',
      idle: 'Prêt quand vous l’êtes', remoteScreen: 'Votre ami partage son écran', localScreen: 'Vous partagez votre écran',
      stageTitle: 'Votre espace partagé', screenUnavailable: 'Le partage d’écran n’est pas disponible ici. Ouvrez YOMY dans un navigateur compatible.',
      chat: 'Discussion de la salle', chatPlaceholder: 'Écrire un message…', send: 'Envoyer',
      empty: 'La discussion sera enregistrée dans votre conversation personnelle à la fin de Wedo.',
      return: 'Retour à la discussion personnelle', saved: 'Discussion enregistrée.', secure: 'Connexion privée',
      noScreen: 'Partagez votre écran pour montrer quelque chose.', elapsed: 'Temps ensemble', shareHint: 'Vous pouvez tous les deux partager.',
      screenError: 'Le partage d’écran a échoué.',
    },
    es: {
      title: 'Wedo!', subtitle: 'Un pequeño espacio para estar juntos.', private: 'Sala privada · Solo ustedes dos',
      screen: 'Compartir pantalla', stopScreen: 'Dejar de compartir', micOn: 'Silenciar micro', micOff: 'Activar micro', leave: 'Terminar sala',
      connect: 'Entrar', waiting: 'Esperando a tu amigo…', connected: 'Conexión en directo', connecting: 'Conectando…',
      idle: 'Listo cuando tú quieras', remoteScreen: 'Tu amigo comparte su pantalla', localScreen: 'Estás compartiendo tu pantalla',
      stageTitle: 'Vuestro espacio compartido', screenUnavailable: 'Compartir pantalla no está disponible aquí. Abre YOMY en un navegador compatible.',
      chat: 'Chat de la sala', chatPlaceholder: 'Escribe un mensaje…', send: 'Enviar',
      empty: 'El chat se guardará en la conversación personal cuando termine Wedo.',
      return: 'Volver al chat personal', saved: 'Chat de la sala guardado.', secure: 'Conexión privada',
      noScreen: 'Comparte tu pantalla para mostrar algo en directo.', elapsed: 'Tiempo juntos',
      shareHint: 'Ambos pueden compartir la pantalla.', screenError: 'No se pudo compartir la pantalla.',
    },
  } as const
  const t = copy[language]

  const showError = useCallback((error: unknown) => {
    const message = userFacingError(error, rtl)
    toast.error(message)
  }, [rtl])

  const sendSignal = useCallback(async (payload: Omit<SignalPayload, 'from'>) => {
    const channel = channelRef.current
    if (!channel || !currentUserId) return
    await channel.send({ type: 'broadcast', event: 'signal', payload: { ...payload, from: currentUserId } })
  }, [currentUserId])

  const stopMedia = useCallback(() => {
    micStreamRef.current?.getTracks().forEach(track => track.stop())
    screenStreamRef.current?.getTracks().forEach(track => track.stop())
    micStreamRef.current = null
    screenStreamRef.current = null
    screenAudioSendersRef.current = []
    peerWireRef.current?.peer.close()
    peerWireRef.current = null
    remoteVideoRef.current = new MediaStream()
    remoteAudioRef.current = new MediaStream()
    setRemoteVideoStream(null)
    setRemoteAudioStream(null)
    setScreenActive(false)
    setRemoteScreenActive(false)
    setInSession(false)
    setConnectionState('idle')
  }, [])

  const navigateBack = useCallback(() => {
    const target = friendRef.current
    if (target?.username) navigate('/messages/' + target.username, { replace: true })
    else navigate('/messages', { replace: true })
  }, [navigate])

  useEffect(() => {
    friendRef.current = friend
  }, [friend])

  useEffect(() => {
    if (!roomId || !user) return
    let active = true
    setLoading(true)
    void (async () => {
      const [{ data: roomData, error: roomError }, { data: messageData }] = await Promise.all([
        supabase.from('wedo_rooms').select('*').eq('id', roomId).maybeSingle(),
        supabase.from('wedo_room_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(500),
      ])
      if (!active) return
      if (roomError || !roomData) {
        setLoading(false)
        showError(new Error('WEDO_ROOM_NOT_FOUND'))
        return
      }
      const nextRoom = roomData as unknown as WedoRoom
      setRoom(nextRoom)
      const friendId = nextRoom.created_by === user.id ? nextRoom.friend_id : nextRoom.created_by
      const { data: profileData } = await supabase.from('profiles').select('id,username,full_name,avatar_url').eq('id', friendId).maybeSingle()
      if (!active) return
      if (!profileData) {
        setLoading(false)
        showError(new Error('WEDO_NOT_PARTICIPANT'))
        return
      }
      setFriend(profileData)
      friendRef.current = profileData
      setMessages((messageData || []) as WedoMessage[])
      setLoading(false)
    })()
    return () => { active = false }
  }, [roomId, user?.id, showError])

  const processSignalRef = useRef<(payload: SignalPayload) => Promise<void>>(async () => {})
  processSignalRef.current = async (payload: SignalPayload) => {
    if (!payload || payload.from === currentUserId) return
    if (payload.kind === 'sharing') {
      setRemoteScreenActive(Boolean(payload.active))
      return
    }
    if (payload.kind === 'peer-ready') return
    const wire = peerWireRef.current
    if (!wire) {
      pendingSignalsRef.current.push(payload)
      return
    }
    const peer = wire.peer
    try {
      if (payload.kind === 'description' && payload.description) {
        const description = payload.description
        const offerCollision = description.type === 'offer' &&
          (wire.makingOffer || peer.signalingState !== 'stable')
        wire.ignoreOffer = !wire.polite && offerCollision
        if (wire.ignoreOffer) return
        await peer.setRemoteDescription(description)
        if (description.type === 'offer') {
          await peer.setLocalDescription()
          await sendSignal({ kind: 'description', description: peer.localDescription?.toJSON() })
        }
        if (peer.remoteDescription) {
          for (const candidate of pendingCandidatesRef.current.splice(0)) {
            await peer.addIceCandidate(candidate).catch(() => undefined)
          }
        }
      } else if (payload.kind === 'candidate' && payload.candidate) {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(payload.candidate).catch(error => {
            if (!wire.ignoreOffer) throw error
          })
        } else {
          pendingCandidatesRef.current.push(payload.candidate)
        }
      }
    } catch (error) {
      if (!wire.ignoreOffer) showError(error)
    }
  }

  useEffect(() => {
    if (!roomId || !user) return
    let active = true
    const channel = supabase.channel('wedo-' + roomId, {
      config: { private: true, broadcast: { ack: true, self: false } },
    })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        void processSignalRef.current(payload as SignalPayload)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wedo_room_messages', filter: 'room_id=eq.' + roomId }, payload => {
        const row = payload.new as WedoMessage
        setMessages(current => current.some(message => message.id === row.id) ? current : [...current, row].sort((a,b) => a.created_at.localeCompare(b.created_at)))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wedo_rooms', filter: 'id=eq.' + roomId }, payload => {
        const updated = payload.new as WedoRoom
        setRoom(updated)
        if (updated.status === 'ended' && !endedHandledRef.current) {
          endedHandledRef.current = true
          stopMedia()
          toast.success(t.saved)
          navigateBack()
        }
      })
      .subscribe(status => {
        if (active) setChannelReady(status === 'SUBSCRIBED')
      })
    channelRef.current = channel
    return () => {
      active = false
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [roomId, user?.id, navigateBack, stopMedia, t.saved])

  useEffect(() => {
    const video = remoteVideoElementRef.current
    if (video) {
      video.srcObject = remoteVideoStream
      if (remoteVideoStream) void video.play().catch(() => undefined)
    }
  }, [remoteVideoStream])

  useEffect(() => {
    const audio = remoteAudioElementRef.current
    if (audio) {
      audio.srcObject = remoteAudioStream
      if (remoteAudioStream) void audio.play().catch(() => undefined)
    }
  }, [remoteAudioStream])

  useEffect(() => {
    const video = localPreviewRef.current
    if (video) {
      video.srcObject = screenStreamRef.current
      if (screenStreamRef.current) void video.play().catch(() => undefined)
    }
  }, [screenActive])

  useEffect(() => {
    const tick = () => {
      if (room?.started_at) setElapsed(Math.max(0, Math.floor((Date.now() - new Date(room.started_at).getTime()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [room?.started_at])

  useEffect(() => {
    messageScrollRef.current?.scrollTo({ top: messageScrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const createPeerConnection = useCallback((friendId: string, microphone: MediaStream) => {
    if (peerWireRef.current) return peerWireRef.current
    const peer = new RTCPeerConnection(RTC_CONFIG)
    const wire: PeerWire = {
      peer,
      polite: currentUserId.localeCompare(friendId) > 0,
      makingOffer: false,
      ignoreOffer: false,
      videoSender: peer.addTransceiver('video', { direction: 'sendrecv' }).sender,
    }
    peerWireRef.current = wire
    microphone.getAudioTracks().forEach(track => peer.addTrack(track, microphone))
    peer.ontrack = event => {
      const destination = event.track.kind === 'video' ? remoteVideoRef.current : remoteAudioRef.current
      if (!destination.getTracks().some(track => track.id === event.track.id)) destination.addTrack(event.track)
      if (event.track.kind === 'video') setRemoteVideoStream(new MediaStream(destination.getTracks()))
      else setRemoteAudioStream(new MediaStream(destination.getTracks()))
      event.track.onended = () => {
        if (event.track.kind === 'video') {
          remoteVideoRef.current.removeTrack(event.track)
          setRemoteVideoStream(new MediaStream(remoteVideoRef.current.getTracks()))
        } else {
          remoteAudioRef.current.removeTrack(event.track)
          setRemoteAudioStream(new MediaStream(remoteAudioRef.current.getTracks()))
        }
      }
    }
    peer.onicecandidate = event => {
      if (event.candidate) void sendSignal({ kind: 'candidate', candidate: event.candidate.toJSON() })
    }
    peer.onconnectionstatechange = () => {
      setConnectionState(peer.connectionState)
      if (peer.connectionState === 'failed') toast.error(rtl ? 'تعذر الاتصال المباشر. تحقق من الشبكة وحاول مجددًا.' : 'The direct connection failed. Check your network and retry.')
    }
    peer.onnegotiationneeded = async () => {
      try {
        wire.makingOffer = true
        await peer.setLocalDescription()
        await sendSignal({ kind: 'description', description: peer.localDescription?.toJSON() })
      } catch (error) {
        showError(error)
      } finally {
        wire.makingOffer = false
      }
    }
    return wire
  }, [currentUserId, rtl, sendSignal, showError])

  const startSession = async () => {
    if (!user || !room || !friend || !channelReady || joining || inSession) return
    setJoining(true)
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      micStreamRef.current = microphone
      setMicEnabled(microphone.getAudioTracks().some(track => track.enabled))
      const { error } = await supabase.rpc('start_wedo_room', { p_room_id: room.id })
      if (error) throw error
      createPeerConnection(friend.id, microphone)
      setInSession(true)
      setConnectionState('connecting')
      await sendSignal({ kind: 'peer-ready' })
      for (const signal of pendingSignalsRef.current.splice(0)) await processSignalRef.current(signal)
    } catch (error) {
      stopMedia()
      showError(error)
    } finally {
      setJoining(false)
    }
  }

  const toggleMic = () => {
    const track = micStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMicEnabled(track.enabled)
  }

  const stopScreenShare = async () => {
    const wire = peerWireRef.current
    if (wire) await wire.videoSender.replaceTrack(null).catch(() => undefined)
    screenAudioSendersRef.current.forEach(sender => wire?.peer.removeTrack(sender))
    screenAudioSendersRef.current = []
    screenStreamRef.current?.getTracks().forEach(track => track.stop())
    screenStreamRef.current = null
    setScreenActive(false)
    await sendSignal({ kind: 'sharing', active: false })
  }

  const toggleScreenShare = async () => {
    if (screenActive) {
      await stopScreenShare()
      return
    }
    const wire = peerWireRef.current
    if (!wire || !inSession) return
    if (!screenApiAvailable) {
      toast.error(t.screenUnavailable)
      return
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 24 } },
        audio: true,
      })
      const track = screen.getVideoTracks()[0]
      if (!track) throw new Error('No screen track was provided by this browser.')
      screenStreamRef.current = screen
      await wire.videoSender.replaceTrack(track)
      const addedSenders: RTCRtpSender[] = []
      screen.getAudioTracks().forEach(audioTrack => addedSenders.push(wire.peer.addTrack(audioTrack, screen)))
      screenAudioSendersRef.current = addedSenders
      track.onended = () => { void stopScreenShare() }
      setScreenActive(true)
      await sendSignal({ kind: 'sharing', active: true })
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') return
      showError(error)
      toast.error(t.screenError)
    }
  }

  const sendRoomMessage = async (event: React.FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    if (!user || !room || !content || sending || room.status !== 'active') return
    setSending(true)
    const clientMessageId = crypto.randomUUID()
    try {
      const { data, error } = await supabase.from('wedo_room_messages').insert({
        room_id: room.id, sender_id: user.id, content: content.slice(0, 2000), client_message_id: clientMessageId,
      }).select('*').single()
      if (error) throw error
      if (data) setMessages(current => current.some(message => message.id === data.id) ? current : [...current, data as WedoMessage].sort((a,b) => a.created_at.localeCompare(b.created_at)))
      setDraft('')
    } catch (error) {
      showError(error)
    } finally {
      setSending(false)
    }
  }

  const endRoom = async () => {
    if (!room || endedHandledRef.current) return
    if (!window.confirm(rtl ? 'هل تريد إنهاء غرفة Wedo وحفظ الدردشة؟' : 'End the Wedo room and save its chat?')) return
    try {
      const { error } = await supabase.rpc('end_wedo_room', { p_room_id: room.id })
      if (error) throw error
      endedHandledRef.current = true
      stopMedia()
      toast.success(t.saved)
      navigateBack()
    } catch (error) {
      showError(error)
    }
  }

  const formatDuration = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
  const peerConnected = connectionState === 'connected'
  const role = room && room.created_by === currentUserId ? (rtl ? 'أنت أنشأت الغرفة' : 'You created this room') : (rtl ? 'انضممت بدعوة صديقك' : 'You joined your friend')

  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-[#fff8ce] dark:bg-[#201d11]"><Spinner className="size-8 text-amber-500" /></div>
  if (!user || !room || !friend) return <div className="flex min-h-dvh items-center justify-center bg-[#fff8ce] p-5 text-center dark:bg-[#201d11]"><div className="max-w-sm rounded-3xl border border-amber-300/50 bg-white/75 p-6 shadow-2xl backdrop-blur-2xl dark:bg-stone-900/75"><CircleHelp className="mx-auto mb-3 size-8 text-amber-500" /><h1 className="font-semibold">Wedo!</h1><p className="mt-2 text-sm text-muted-foreground">{rtl ? 'تعذر فتح الغرفة. افتح الدعوة من المحادثة الشخصية.' : 'Could not open this room. Open the invitation from your personal chat.'}</p><Button className="mt-4 rounded-full bg-amber-400 text-stone-950 hover:bg-amber-300" onClick={() => navigate('/messages')}>{t.return}</Button></div></div>

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="wedo-shell min-h-dvh bg-[radial-gradient(ellipse_at_top_left,rgba(255,229,92,.38),transparent_42%),linear-gradient(145deg,#fffbe7,#fff5b7_55%,#ffed8a)] text-stone-900 dark:bg-[radial-gradient(ellipse_at_top_left,rgba(255,216,64,.12),transparent_42%),linear-gradient(145deg,#17160f,#242012_55%,#302812)] dark:text-stone-100">
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-amber-300/35 bg-white/65 px-3 py-2 shadow-[0_8px_30px_rgba(98,75,0,.08)] backdrop-blur-2xl dark:bg-stone-950/55 sm:px-5">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={navigateBack} aria-label={rtl ? 'رجوع' : 'Back'}><ArrowLeft className={rtl ? 'size-5 rotate-180' : 'size-5'} /></Button>
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-amber-300/70 bg-gradient-to-br from-yellow-200 to-amber-400 text-amber-950 shadow-[0_8px_20px_rgba(210,154,0,.22)]"><AudioLines className="size-5" /></div>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="text-lg font-black tracking-tight">Wedo!</h1><span className="rounded-full border border-amber-300/60 bg-amber-200/55 px-2 py-0.5 text-[10px] font-semibold text-amber-950">{t.private}</span></div><p className="truncate text-xs text-stone-600 dark:text-stone-300">{friend.full_name || friend.username} · {role}</p></div>
        <div className="hidden text-right sm:block"><p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{t.elapsed}</p><p className="font-mono text-sm font-bold">{formatDuration(elapsed)}</p></div>
      </header>
      <main className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-[1500px] grid-cols-1 gap-3 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-h-[62vh] flex-col overflow-hidden rounded-[28px] border border-white/65 bg-white/46 shadow-[0_22px_65px_rgba(112,84,0,.14)] backdrop-blur-2xl dark:border-white/10 dark:bg-stone-900/45">
          <div className="flex items-center justify-between gap-3 border-b border-amber-300/30 px-4 py-3 sm:px-5"><div className="flex min-w-0 items-center gap-2"><span className={'size-2.5 rounded-full ' + (peerConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500')} /><div><p className="text-sm font-bold">{t.stageTitle}</p><p className="text-[11px] text-stone-600 dark:text-stone-300">{peerConnected ? t.connected : inSession ? t.connecting : t.idle}</p></div></div>{remoteScreenActive && <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/55 px-3 py-1 text-xs font-semibold text-amber-950"><MonitorUp className="size-3.5" />{t.remoteScreen}</span>}</div>
          <div className="relative m-3 flex min-h-[42vh] flex-1 items-center justify-center overflow-hidden rounded-[22px] border border-amber-300/40 bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,.78),rgba(255,241,159,.38)_45%,rgba(255,224,89,.23))] dark:bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,.05),rgba(255,202,40,.07)_45%,rgba(255,196,0,.04))]">
            {remoteScreenActive && remoteVideoStream ? <video ref={remoteVideoElementRef} autoPlay playsInline muted className="absolute inset-0 size-full bg-black object-contain" /> : <div className="max-w-md px-5 text-center"><div className="mx-auto mb-4 grid size-20 place-items-center rounded-[28px] border border-amber-300/65 bg-gradient-to-br from-yellow-200/80 to-amber-300/75 text-amber-950 shadow-[0_15px_45px_rgba(214,157,0,.16)]"><MonitorUp className="size-9" /></div><h2 className="text-lg font-bold">{remoteScreenActive ? t.remoteScreen : t.noScreen}</h2><p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{t.shareHint}</p></div>}
            {screenActive && <div className="absolute bottom-3 left-3 w-28 overflow-hidden rounded-xl border border-white/70 bg-black/50 shadow-xl sm:w-36"><video ref={localPreviewRef} autoPlay playsInline muted className="aspect-video w-full object-contain" /><p className="px-2 py-1 text-[10px] font-semibold text-white">{rtl ? 'أنت تشارك الشاشة' : 'Your screen'}</p></div>}
          </div>
          <div className="mx-3 mb-3 flex flex-col gap-3 rounded-[22px] border border-amber-300/35 bg-white/55 p-3 backdrop-blur-xl dark:bg-stone-950/40 sm:mx-4 sm:mb-4 sm:p-4">
            {inSession && !peerConnected && <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200"><Headphones className="size-4" />{t.waiting}</div>}
            {!screenApiAvailable && <div className="flex items-start gap-2 rounded-xl border border-amber-300/45 bg-amber-200/35 p-3 text-xs leading-5 text-amber-950 dark:text-amber-100"><CircleHelp className="mt-0.5 size-4 shrink-0" /><span>{t.screenUnavailable}</span></div>}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {!inSession
                ? <Button onClick={() => void startSession()} disabled={joining || !channelReady || room.status !== 'active'} className="h-11 rounded-full bg-amber-400 px-5 font-bold text-stone-950 shadow-md hover:bg-amber-300">{joining ? <Spinner className="mr-2 size-4" /> : <Users className="mr-2 size-4" />}{joining ? t.connecting : t.connect}</Button>
                : <Button variant="outline" onClick={toggleMic} className="h-11 rounded-full border-amber-300/70 bg-white/50 px-4 text-stone-900 hover:bg-amber-100 dark:bg-stone-900/50 dark:text-stone-100">{micEnabled ? <MicOff className="mr-2 size-4" /> : <Mic className="mr-2 size-4" />}{micEnabled ? t.micOn : t.micOff}</Button>}
              <Button onClick={() => void toggleScreenShare()} disabled={!inSession || room.status !== 'active' || !screenApiAvailable} className="h-11 rounded-full bg-stone-900 px-4 text-yellow-200 shadow-md hover:bg-stone-800 disabled:opacity-45 dark:bg-yellow-300 dark:text-stone-950"><MonitorUp className="mr-2 size-4" />{screenActive ? t.stopScreen : t.screen}</Button>
              <Button variant="outline" onClick={() => setChatOpen(v => !v)} className="h-11 rounded-full border-amber-300/70 bg-white/50 px-4 text-stone-900 hover:bg-amber-100 dark:bg-stone-900/50 dark:text-stone-100"><MessageCircle className="mr-2 size-4" />{t.chat}</Button>
              <Button onClick={() => void endRoom()} disabled={room.status !== 'active'} className="h-11 rounded-full bg-rose-600 px-4 text-white shadow-md hover:bg-rose-500"><PhoneOff className="mr-2 size-4" />{t.leave}</Button>
            </div>
          </div>
        </section>
        {chatOpen && <aside className="flex min-h-[50vh] flex-col overflow-hidden rounded-[28px] border border-white/65 bg-white/65 shadow-[0_22px_55px_rgba(112,84,0,.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-stone-900/55 lg:min-h-0">
          <div className="flex items-center gap-2 border-b border-amber-300/35 px-4 py-3"><span className="grid size-8 place-items-center rounded-xl bg-yellow-300/70 text-amber-950"><MessageCircle className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-bold">{t.chat}</h2><p className="text-[10px] text-stone-600 dark:text-stone-300">{messages.length} {rtl ? 'رسائل' : 'messages'}</p></div><span className="rounded-full bg-amber-200/70 px-2 py-1 text-[10px] text-amber-950">{t.title}</span></div>
          <div ref={messageScrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 ? <p className="rounded-2xl border border-amber-300/35 bg-yellow-100/50 p-4 text-center text-xs leading-5 text-stone-600 dark:bg-yellow-900/10 dark:text-stone-300">{t.empty}</p> : messages.map(message => {
              const mine = message.sender_id === user.id
              return <div key={message.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}><div className="max-w-[94%] rounded-[18px] border border-yellow-300/50 bg-yellow-200/75 px-3 py-2 text-stone-950 shadow-sm dark:bg-yellow-200/90"><p className="whitespace-pre-wrap break-words text-[13px] leading-5">{message.content}</p><div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-stone-600"><span>{format(new Date(message.created_at), 'HH:mm')}</span>{mine && <CheckCheck className="size-3 text-amber-700" />}</div></div></div>
            })}
          </div>
          <form onSubmit={event => void sendRoomMessage(event)} className="flex items-center gap-2 border-t border-amber-300/35 bg-white/55 p-3 dark:bg-stone-950/35"><Input value={draft} onChange={event => setDraft(event.target.value)} placeholder={t.chatPlaceholder} maxLength={2000} className="h-11 min-w-0 rounded-full border-amber-300/45 bg-white/70 text-sm focus-visible:ring-amber-400 dark:bg-stone-950/45" disabled={room.status !== 'active'} /><Button type="submit" size="icon" aria-label={t.send} disabled={!draft.trim() || sending || room.status !== 'active'} className="size-11 shrink-0 rounded-full bg-amber-400 text-stone-950 hover:bg-amber-300"><Send className="size-4" /></Button></form>
        </aside>}
      </main>
      <audio ref={remoteAudioElementRef} autoPlay className="hidden" />
      <footer className="pb-3 text-center text-[10px] text-stone-500 dark:text-stone-400">{t.secure} · {t.private}</footer>
    </div>
  )
}
