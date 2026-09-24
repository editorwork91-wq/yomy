import { useEffect, useState } from 'react'

type Accent = { a: string; b: string; glow: string }

function hashColor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return { a: `hsl(${hue} 72% 48%)`, b: `hsl(${(hue + 42) % 360} 68% 62%)`, glow: `hsl(${hue} 80% 55% / .24)` }
}

export function useAvatarAccent(url: string | null | undefined, seed: string) {
  const [accent, setAccent] = useState<Accent>(() => hashColor(seed))
  useEffect(() => {
    if (!url || typeof Image === 'undefined') return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 24
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 100) continue
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++
        }
        if (!count || cancelled) return
        const rr = Math.round(r / count), gg = Math.round(g / count), bb = Math.round(b / count)
        const toHsl = (r0: number, g0: number, b0: number) => {
          const max = Math.max(r0,g0,b0)/255, min = Math.min(r0,g0,b0)/255, d=max-min
          let h=0
          if (d) {
            if (max===r0/255) h=((g0-b0)/255/d)%6
            else if (max===g0/255) h=(b0/255-(r0/255))/d+2
            else h=(r0/255-(g0/255))/d+4
            h=Math.round(h*60); if(h<0) h+=360
          }
          const l=(max+min)/2, s=d ? d/(1-Math.abs(2*l-1)) : 0
          return [h,Math.round(s*100),Math.round(l*100)] as const
        }
        const [h,s,l]=toHsl(rr,gg,bb)
        if (!cancelled) setAccent({ a: `hsl(${h} ${Math.max(42,s)}% ${Math.min(64,Math.max(36,l))}%)`, b: `hsl(${(h+38)%360} ${Math.max(45,s)}% ${Math.min(78,Math.max(52,l+18))}%)`, glow: `hsl(${h} ${Math.max(50,s)}% 55% / .25)` })
      } catch {}
    }
    img.src = url
    return () => { cancelled = true }
  }, [seed, url])
  return accent
}
