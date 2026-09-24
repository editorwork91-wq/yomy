import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw, Wifi } from 'lucide-react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

export default function NetworkStatus() {
  const online = useNetworkStatus()
  const [showBackOnline, setShowBackOnline] = useState(false)

  useEffect(() => {
    if (!online) return
    setShowBackOnline(true)
    const timer = window.setTimeout(() => setShowBackOnline(false), 1800)
    return () => window.clearTimeout(timer)
  }, [online])

  if (online && !showBackOnline) return null

  return (
    <div className="fixed top-14 left-0 right-0 z-[80] pointer-events-none px-3 pt-2">
      <div className="mx-auto flex max-w-lg justify-center">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/92 px-3 py-1.5 text-[11px] shadow-lg backdrop-blur-xl">
          {online ? <Wifi className="size-3.5 text-emerald-500" /> : <CloudOff className="size-3.5 text-amber-500" />}
          <span>{online ? 'Back online — syncing…' : 'Offline — using saved Yomy data'}</span>
          {online && <RefreshCw className="size-3 animate-spin opacity-60" />}
        </div>
      </div>
    </div>
  )
}
