import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Eraser, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const COLORS = ['#ffffff','#111827','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899']
const SIZES = [4, 8, 14]

export default function ChatDoodleEditor({ onCancel, onDone }: { onCancel: () => void; onDone: (file: File) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const pointsRef = useRef<{x:number;y:number}[]>([])
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[1])
  const [eraser, setEraser] = useState(false)
  const [history, setHistory] = useState<ImageData[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.min(window.innerWidth * 0.92, 900)
    const height = Math.min(window.innerHeight * 0.66, 720)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = 'rgba(8,10,18,.96)'
    ctx.fillRect(0,0,width,height)
  }, [])

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const saveSnapshot = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    try { setHistory(current => [...current.slice(-14), ctx.getImageData(0,0,canvas.width,canvas.height)]) } catch {}
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    saveSnapshot()
    drawingRef.current = true
    pointsRef.current = [point(e)]
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = e.currentTarget
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const p = point(e)
    const prev = pointsRef.current.at(-1)
    if (!prev) return
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = eraser ? 'rgba(0,0,0,1)' : color
    ctx.lineWidth = size
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    pointsRef.current.push(p)
  }

  const end = () => {
    drawingRef.current = false
    pointsRef.current = []
  }

  const undo = () => {
    const snap = history.at(-1)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!snap || !canvas || !ctx) return
    ctx.putImageData(snap,0,0)
    setHistory(current => current.slice(0,-1))
  }

  const done = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      onDone(new File([blob], 'yomy-drawing-' + Date.now() + '.png', { type: 'image/png' }))
    }, 'image/png')
  }

  return (
    <div className="fixed inset-0 z-[160] bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center p-3">
      <div className="w-full max-w-4xl flex items-center justify-between px-1 mb-3">
        <Button variant="ghost" size="icon" className="yomy-icon-button text-white" onClick={onCancel}><X /></Button>
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 p-1.5 backdrop-blur-xl">
          {COLORS.map(item => <button key={item} type="button" aria-label={item} onClick={() => { setColor(item); setEraser(false) }} className={'size-7 rounded-full ring-2 transition-transform active:scale-90 ' + (color === item && !eraser ? 'ring-white scale-110' : 'ring-transparent')} style={{ background: item }} />)}
        </div>
        <Button variant="ghost" size="icon" className="yomy-icon-button text-white" onClick={done}><Check /></Button>
      </div>
      <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="rounded-[28px] border border-white/10 shadow-[0_30px_100px_rgba(0,0,0,.5)] touch-none bg-black" />
      <div className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2 py-1.5 backdrop-blur-xl">
        {SIZES.map(item => <button key={item} onClick={() => { setSize(item); setEraser(false) }} className={'grid size-9 place-items-center rounded-full ' + (size === item && !eraser ? 'bg-white text-black' : 'text-white/75')}><span className="rounded-full bg-current" style={{width:item+4,height:item+4}} /></button>)}
        <button onClick={() => setEraser(value => !value)} className={'grid size-9 place-items-center rounded-full ' + (eraser ? 'bg-white text-black' : 'text-white/75')}><Eraser className="size-4" /></button>
        <button onClick={undo} disabled={!history.length} className="grid size-9 place-items-center rounded-full text-white/75 disabled:opacity-30"><Undo2 className="size-4" /></button>
      </div>
    </div>
  )
}
