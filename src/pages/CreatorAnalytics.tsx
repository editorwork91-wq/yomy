import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Crown, Eye, Heart, MessageCircle, Play, Share2, Trophy, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import { Spinner } from '@/components/ui/spinner'

type Metric = { views: number; unique_viewers: number; completions: number; watch_ms: number; likes: number; comments: number; shares: number; saves: number; attributed_subscriptions: number }
const emptyMetric: Metric = { views: 0, unique_viewers: 0, completions: 0, watch_ms: 0, likes: 0, comments: 0, shares: 0, saves: 0, attributed_subscriptions: 0 }

function ratio(a: number, b: number) { return b > 0 ? Math.round(a / b * 100) : 0 }

export default function CreatorAnalytics() {
  const { user } = useAuth()
  const [range, setRange] = useState<'today' | 'week' | 'month'>('week')
  const [metric, setMetric] = useState<Metric>(emptyMetric)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const days = range === 'today' ? 1 : range === 'week' ? 7 : 30
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    setLoading(true)
    void (async () => {
      const { data, error } = await supabase.from('content_metrics_daily').select('views,unique_viewers,completions,watch_ms,likes,comments,shares,saves,attributed_subscriptions').eq('user_id', user.id).gte('day', since)
      if (error) console.error('analytics load failed:', error.message)
      const total = (data || []).reduce((acc, row) => ({ views: acc.views + Number(row.views || 0), unique_viewers: acc.unique_viewers + Number(row.unique_viewers || 0), completions: acc.completions + Number(row.completions || 0), watch_ms: acc.watch_ms + Number(row.watch_ms || 0), likes: acc.likes + Number(row.likes || 0), comments: acc.comments + Number(row.comments || 0), shares: acc.shares + Number(row.shares || 0), saves: acc.saves + Number(row.saves || 0), attributed_subscriptions: acc.attributed_subscriptions + Number(row.attributed_subscriptions || 0) }), emptyMetric)
      setMetric(total); setLoading(false)
    })()
  }, [range, user])

  const completionRate = useMemo(() => ratio(metric.completions, metric.views), [metric])
  const engagement = useMemo(() => ratio(metric.likes + metric.comments + metric.shares + metric.saves, Math.max(1, metric.views)), [metric])
  const avgWatch = useMemo(() => metric.views ? Math.round(metric.watch_ms / metric.views / 1000) : 0, [metric])

  return <div className="min-h-screen bg-background pb-16"><TopBar title="Creator analytics" showBack/><main className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
    <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/40 p-1">{(['today','week','month'] as const).map(value => <button key={value} onClick={() => setRange(value)} className={`rounded-xl px-3 py-2 text-sm font-medium transition ${range === value ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{value === 'today' ? 'Today' : value === 'week' ? 'This week' : 'This month'}</button>)}</div>
    {loading ? <div className="h-48 flex items-center justify-center"><Spinner className="size-7"/></div> : <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard icon={<Eye/>} label="Views" value={metric.views}/><MetricCard icon={<Play/>} label="Completion" value={`${completionRate}%`}/><MetricCard icon={<Heart/>} label="Engagement" value={`${engagement}%`}/><MetricCard icon={<Users/>} label="Subscribers" value={metric.attributed_subscriptions}/>
      </div>
      <section className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-3xl border p-5 bg-card [transform:perspective(1000px)_rotateX(1deg)] shadow-xl"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Audience momentum</p><h2 className="text-2xl font-semibold mt-1">{metric.views.toLocaleString()} views</h2></div><div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary"><BarChart3/></div></div><div className="mt-6 h-32 flex items-end gap-2">{Array.from({ length: 18 }).map((_, i) => <div key={i} className="flex-1 rounded-t-lg bg-primary/25" style={{ height: `${20 + ((i * 37) % 80)}%` }}/>)}</div><div className="mt-4 flex justify-between text-xs text-muted-foreground"><span>Lower</span><span>Average watch {avgWatch}s</span><span>Peak</span></div></div>
        <div className="rounded-3xl border p-5 bg-card shadow-xl [transform:perspective(1000px)_rotateY(-2deg)]"><div className="flex items-center gap-3"><div className="size-12 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center"><Crown/></div><div><p className="text-sm text-muted-foreground">Creator rank</p><p className="font-semibold">Momentum tier</p></div></div><div className="mt-7 flex items-center gap-4"><Trophy className="size-10 text-amber-500"/><div><p className="text-3xl font-bold">{Math.max(1, completionRate + engagement)}%</p><p className="text-xs text-muted-foreground">composite content health</p></div></div></div>
      </section>
      <section className="rounded-3xl border bg-card p-5"><h3 className="font-semibold">Content totals</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4"><Mini label="Likes" value={metric.likes} icon={<Heart/>}/><Mini label="Comments" value={metric.comments} icon={<MessageCircle/>}/><Mini label="Shares" value={metric.shares} icon={<Share2/>}/><Mini label="Saves" value={metric.saves} icon={<Trophy/>}/></div></section>
      <p className="text-xs text-muted-foreground">The dashboard aggregates creator-owned metrics only. Phone verification can gate this surface before production activation.</p>
    </>}
  </main></div>
}
function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) { return <div className="rounded-2xl border bg-card p-4"><div className="size-9 rounded-xl bg-muted flex items-center justify-center mb-3">{icon}</div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p></div> }
function Mini({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="rounded-2xl bg-muted/50 p-4"><div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-xs">{label}</span></div><p className="text-lg font-semibold mt-3">{value.toLocaleString()}</p></div> }
