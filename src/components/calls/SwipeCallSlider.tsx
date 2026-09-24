import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { ChevronLeft, ChevronRight, Phone, PhoneOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export default function SwipeCallSlider({
  onAnswer,
  onDecline,
  disabled = false,
}: {
  onAnswer: () => Promise<void> | void
  onDecline: () => Promise<void> | void
  disabled?: boolean
}) {
  const [drag, setDrag] = useState(0)
  const [armed, setArmed] = useState<'left' | 'right' | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const lastHaptic = useRef<'left' | 'right' | null>(null)

  const reset = () => {
    dragging.current = false
    setDrag(0)
    setArmed(null)
    lastHaptic.current = null
  }

  const haptic = () => {
    try { navigator.vibrate?.(12) } catch {}
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(0)
    setArmed(null)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const max = Math.max(52, rect.width / 2 - 34)
    const next = Math.max(-max, Math.min(max, event.clientX - (rect.left + rect.width / 2)))
    setDrag(next)
    const threshold = max * 0.72
    const nextArmed = next > threshold ? 'right' : next < -threshold ? 'left' : null
    setArmed(nextArmed)
    if (nextArmed && lastHaptic.current !== nextArmed) {
      lastHaptic.current = nextArmed
      haptic()
    } else if (!nextArmed) {
      lastHaptic.current = null
    }
  }

  const onPointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const side = armed
    reset()
    if (side === 'right') await onAnswer()
    else if (side === 'left') await onDecline()
    else toast.info('Swipe farther to answer or decline')
  }

  const progress = Math.min(1, Math.abs(drag) / 120)
  return (
    <div className="select-none">
      <div className="flex items-center justify-between px-2 mb-2 text-[11px] font-medium text-white/45">
        <span className="flex items-center gap-1"><ChevronLeft className="size-3.5" /> Decline</span>
        <span>Slide to decide</span>
        <span className="flex items-center gap-1">Answer <ChevronRight className="size-3.5" /></span>
      </div>
      <div
        ref={trackRef}
        className="relative h-[76px] rounded-[26px] border border-white/10 bg-white/[0.065] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
      >
        <div className="absolute inset-y-2 left-2 flex items-center">
          <div className={cn("size-12 rounded-full flex items-center justify-center transition-all", armed === 'left' ? "bg-red-500/30 scale-110" : "bg-red-500/15")}>
            <PhoneOff className="size-5 text-red-300" />
          </div>
        </div>
        <div className="absolute inset-y-2 right-2 flex items-center">
          <div className={cn("size-12 rounded-full flex items-center justify-center transition-all", armed === 'right' ? "bg-emerald-500/30 scale-110" : "bg-emerald-500/15")}>
            <Phone className="size-5 text-emerald-300" />
          </div>
        </div>
        <div
          className={cn(
            "absolute top-1/2 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white text-slate-900",
            "flex items-center justify-center shadow-2xl ring-4 ring-white/10 transition-transform duration-100",
            armed === 'right' && "ring-emerald-400/40",
            armed === 'left' && "ring-red-400/40",
          )}
          style={{ transform: `translate(calc(-50% + ${drag}px), -50%)` }}
        >
          {drag >= 0 ? <ChevronRight className="size-6" /> : <ChevronLeft className="size-6" />}
        </div>
        <div className="absolute left-1/2 top-1/2 h-1.5 w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 overflow-hidden pointer-events-none">
          <div className={cn("h-full rounded-full transition-[width]", armed === 'left' ? "bg-red-400" : armed === 'right' ? "bg-emerald-400" : "bg-white/30")} style={{ width: `${progress * 100}%`, marginLeft: drag < 0 ? 'auto' : undefined }} />
        </div>
      </div>
    </div>
  )
}
