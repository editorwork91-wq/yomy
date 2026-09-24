import { Heart, Sparkles, Star } from 'lucide-react'

export type BuiltInSticker = { id: string; name: string; svg: string }

const makeSvg = (body: string, accent = '#ff3b5f') => `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none">
<defs>
  <linearGradient id="g" x1="25" y1="20" x2="155" y2="160" gradientUnits="userSpaceOnUse">
    <stop stop-color="${accent}"/><stop offset="1" stop-color="#ff8aa0"/>
  </linearGradient>
</defs>
${body}
</svg>`

export const BUILT_IN_STICKERS: BuiltInSticker[] = [
  { id:'heart-pulse', name:'Red Heart', svg:makeSvg('<path d="M90 146S28 111 28 68c0-18 14-31 31-31 13 0 24 7 31 18 7-11 18-18 31-18 17 0 31 13 31 31 0 43-62 78-62 78Z" fill="url(#g)"><animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="1s" repeatCount="indefinite" additive="sum"/></path>') },
  { id:'hearts-float', name:'Hearts', svg:makeSvg('<g><path d="M90 140S42 112 42 80c0-12 9-22 21-22 9 0 17 5 22 13 5-8 13-13 22-13 12 0 21 10 21 22 0 32-38 60-38 60Z" fill="url(#g)"/><path d="M31 56S12 44 12 30c0-7 5-12 12-12 5 0 9 3 12 7 3-4 7-7 12-7 7 0 12 5 12 12 0 14-19 26-19 26Z" fill="#ffb0bf"><animate attributeName="opacity" values=".45;1;.45" dur="1.2s" repeatCount="indefinite"/></path><path d="M149 59s-19-12-19-26c0-7 5-12 12-12 5 0 9 3 12 7 3-4 7-7 12-7 7 0 12 5 12 12 0 14-19 26-19 26Z" fill="#ffd0da"><animate attributeName="opacity" values="1;.35;1" dur="1s" repeatCount="indefinite"/></path></g>') },
  { id:'yomy-heart', name:'Y ❤️', svg:makeSvg('<text x="90" y="111" text-anchor="middle" font-family="system-ui,sans-serif" font-size="52" font-weight="800" fill="url(#g)">Y</text><path d="M90 146S43 118 43 88c0-11 8-19 19-19 9 0 17 5 22 14 5-9 13-14 22-14 11 0 19 8 19 19 0 30-35 58-35 58Z" fill="url(#g)" opacity=".82"><animateTransform attributeName="transform" type="scale" values="1;1.07;1" dur="1.1s" repeatCount="indefinite" additive="sum"/></path>') },
  { id:'blue-heart', name:'Cool Heart', svg:makeSvg('<path d="M90 146S28 111 28 68c0-18 14-31 31-31 13 0 24 7 31 18 7-11 18-18 31-18 17 0 31 13 31 31 0 43-62 78-62 78Z" fill="url(#g)"/>', '#4ea6ff').replace('#ff8aa0','#a9d8ff') },
  { id:'kiss', name:'Kiss', svg:makeSvg('<path d="M59 92c12-13 25-20 31-20s19 7 31 20c-8-1-18 4-31 16-13-12-23-17-31-16Z" fill="#ff4770"/><path d="M90 108c-11-10-20-13-28-12 8 14 20 22 28 26 8-4 20-12 28-26-8-1-17 2-28 12Z" fill="#ff7392"><animate attributeName="transform" values="translate(0 0);translate(0 -5);translate(0 0)" dur="1.3s" repeatCount="indefinite"/></path><circle cx="135" cy="47" r="5" fill="#ffb5c4"><animate attributeName="cy" values="47;37;47" dur="1.1s" repeatCount="indefinite"/></circle><circle cx="151" cy="34" r="3.5" fill="#ffd1db"><animate attributeName="cy" values="34;28;34" dur=".9s" repeatCount="indefinite"/></circle>') },
  { id:'sparkle-heart', name:'Sparkle Love', svg:makeSvg('<path d="M90 144S34 112 34 72c0-16 12-28 28-28 12 0 21 6 28 17 7-11 16-17 28-17 16 0 28 12 28 28 0 40-56 72-56 72Z" fill="url(#g)"/><path d="M29 48l4 12 12 4-12 4-4 12-4-12-12-4 12-4 4-12Z" fill="#ffe8ee"><animateTransform attributeName="transform" type="rotate" values="0 29 64;18 29 64;0 29 64" dur="1.2s" repeatCount="indefinite"/></path><path d="M149 121l3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z" fill="#fff" opacity=".9"/></svg>') },
  { id:'love-burst', name:'Love Burst', svg:makeSvg('<g fill="url(#g)"><circle cx="90" cy="90" r="28"><animate attributeName="r" values="25;31;25" dur="1s" repeatCount="indefinite"/></circle><path d="M90 15v28M90 137v28M15 90h28M137 90h28M37 37l20 20M123 123l20 20M143 37l-20 20M57 123l-20 20" stroke="#ffcad5" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values=".3;1;.3" dur="1s" repeatCount="indefinite"/></path><path d="M90 121S58 102 58 79c0-8 6-14 14-14 8 0 14 5 18 12 4-7 10-12 18-12 8 0 14 6 14 14 0 23-32 42-32 42Z" fill="#fff"/></g>') },
]

export function stickerDataUrl(svg: string) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export function stickerFile(svg: string, name: string) {
  return new File([new Blob([svg], { type:'image/svg+xml' })], name + '.svg', { type:'image/svg+xml' })
}

export function BuiltInStickerIcon({ id }: { id: string }) {
  const sticker = BUILT_IN_STICKERS.find(item => item.id === id)
  if (!sticker) return <Heart className="size-6" />
  return <img src={stickerDataUrl(sticker.svg)} alt="" className="size-full object-contain" />
}

export function StickerFallbackIcon() {
  return <Sparkles className="size-5" />
}

export const stickerCategoryIcon = Star
