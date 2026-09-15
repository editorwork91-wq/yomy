import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Move, RotateCcw, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = { file: File; onCancel: () => void; onDone: (file: File) => void }

export default function MediaEditor({ file, onCancel, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const image = useMemo(() => {
    if (!sourceUrl) return null
    const img = new Image()
    img.src = sourceUrl
    img.onload = () => {
      imageRef.current = img
      redraw()
    }
    return img
  }, [sourceUrl])

  const redraw = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const size = canvas.clientWidth || 320
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const cover = Math.max(size / img.naturalWidth, size / img.naturalHeight) * zoom
    const width = img.naturalWidth * cover
    const height = img.naturalHeight * cover
    const x = (size - width) / 2 + offset.x
    const y = (size - height) / 2 + offset.y
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, x, y, width, height)
    ctx.strokeStyle = 'rgba(255,255,255,.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, size - 2, size - 2)
    ctx.strokeStyle = 'rgba(255,255,255,.18)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(size / 3, 0); ctx.lineTo(size / 3, size); ctx.moveTo(size * 2 / 3, 0); ctx.lineTo(size * 2 / 3, size); ctx.moveTo(0, size / 3); ctx.lineTo(size, size / 3); ctx.moveTo(0, size * 2 / 3); ctx.lineTo(size, size * 2 / 3); ctx.stroke()
  }

  useEffect(() => {
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { redraw() }, [zoom, offset, image])

  const clampOffset = (next: { x: number; y: number }) => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return next
    const size = canvas.clientWidth || 320
    const cover = Math.max(size / img.naturalWidth, size / img.naturalHeight) * zoom
    const width = img.naturalWidth * cover
    const height = img.naturalHeight * cover
    const maxX = Math.max(0, (width - size) / 2)
    const maxY = Math.max(0, (height - size) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) }
  }

  const finish = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const size = 1080
    const out = document.createElement('canvas')
    out.width = size; out.height = size
    const ctx = out.getContext('2d')
    if (!ctx) return
    const cover = Math.max(size / img.naturalWidth, size / img.naturalHeight) * zoom
    const width = img.naturalWidth * cover
    const height = img.naturalHeight * cover
    const scale = size / (canvas.clientWidth || 320)
    const x = (size - width) / 2 + offset.x * scale
    const y = (size - height) / 2 + offset.y * scale
    ctx.drawImage(img, x, y, width, height)
    out.toBlob(blob => {
      if (!blob) return
      onDone(new File([blob], `yomy-crop-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', .92)
  }

  return <div className="fixed inset-0 z-[120] bg-black/90 text-white flex flex-col">
    <div className="flex items-center justify-between p-4"><Button variant="ghost" onClick={onCancel} className="text-white">Cancel</Button><div className="text-sm font-semibold">Edit photo</div><Button variant="ghost" onClick={finish} className="text-white"><Check className="size-5 mr-1"/>Done</Button></div>
    <div className="flex-1 flex items-center justify-center p-5">
      <div className="w-full max-w-[min(92vw,520px)] aspect-square rounded-2xl overflow-hidden shadow-2xl bg-black relative touch-none" onPointerDown={e => { setDragging(true); dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; e.currentTarget.setPointerCapture(e.pointerId) }} onPointerMove={e => { if (!dragging) return; setOffset(clampOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })) }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
        <canvas ref={canvasRef} className="w-full h-full block" />
        <div className="absolute inset-0 pointer-events-none"><div className="absolute inset-0 ring-[9999px] ring-black/35"/><div className="absolute inset-0 border-2 border-white/70 rounded-2xl"/></div>
      </div>
    </div>
    <div className="px-6 pb-10 space-y-4">
      <div className="flex items-center gap-3"><ZoomIn className="size-4"/><input aria-label="Zoom" type="range" min="1" max="3" step="0.01" value={zoom} onChange={e => setZoom(Number(e.target.value))} className="flex-1"/><span className="text-xs tabular-nums w-10 text-right">{zoom.toFixed(1)}×</span></div>
      <div className="flex items-center justify-center gap-3"><Button variant="outline" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }} className="text-white border-white/20"><RotateCcw className="size-4 mr-2"/>Reset</Button><div className="text-xs text-white/60 flex items-center"><Move className="size-3 mr-1"/>Drag to position • crop is always square</div></div>
    </div>
  </div>
}
