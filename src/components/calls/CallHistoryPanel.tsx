import { useEffect, useMemo, useState } from 'react'
import { Phone, Video, PhoneOff } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

type CallRow = { id: string; caller_id: string; callee_id: string; kind: 'voice' | 'video'; status: string; created_at: string; answered_at?: string | null; ended_at?: string | null }

function duration(call: CallRow) {
  if (!call.answered_at || !call.ended_at) return ''
  const seconds = Math.max(0, Math.floor((new Date(call.ended_at).getTime() - new Date(call.answered_at).getTime()) / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export default function CallHistoryPanel() {
  const { username } = useParams()
  const { user } = useAuth()
  const [calls, setCalls] = useState<CallRow[]>([])
  const [otherId, setOtherId] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !username) return
    let mounted = true
    const load = async () => {
      const { data: other } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle()
      if (!other?.id) return
      if (mounted) setOtherId(other.id)
      const { data } = await supabase.from('call_sessions').select('id,caller_id,callee_id,kind,status,created_at,answered_at,ended_at').or(`and(caller_id.eq.${user.id},callee_id.eq.${other.id}),and(caller_id.eq.${other.id},callee_id.eq.${user.id})`).order('created_at', { ascending: false }).limit(8)
      if (mounted) setCalls((data || []) as CallRow[])
    }
    void load()
    const channel = supabase.channel(`call-history-${user.id}-${username}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_sessions' }, () => void load())
      .subscribe()
    return () => { mounted = false; void supabase.removeChannel(channel) }
  }, [user, username])

  const visibleCalls = useMemo(() => calls.filter(call => call.caller_id === user?.id && call.callee_id === otherId || call.callee_id === user?.id && call.caller_id === otherId).filter(call => ['ended', 'declined', 'missed', 'failed'].includes(call.status) || !!call.answered_at), [calls, otherId, user?.id])
  if (!visibleCalls.length) return null

  return <div className="fixed left-3 right-3 bottom-[72px] z-30 flex flex-col items-center pointer-events-none">
    <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur shadow-lg overflow-hidden pointer-events-auto">
      {visibleCalls.slice(0, 3).map(call => {
        const answered = !!call.answered_at
        const Icon = call.kind === 'video' ? Video : Phone
        const outgoing = call.caller_id === user?.id
        let label = ''
        if (answered) label = duration(call) || 'Call ended'
        else if (call.status === 'declined') label = outgoing ? 'Declined' : 'Declined'
        else if (call.status === 'failed') label = 'Call failed'
        else label = outgoing ? 'No answer' : 'Missed call'
        return <div key={call.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0">
          <span className={cn('size-9 rounded-full flex items-center justify-center shrink-0', answered ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500')}>
            {answered ? <Icon className="size-4" /> : <PhoneOff className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{call.kind === 'video' ? 'Video call' : 'Voice call'}</p>
            <p className={cn('text-xs', answered ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>{label}</p>
          </div>
          <span className="text-[11px] text-muted-foreground">{new Date(call.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      })}
    </div>
  </div>
}
