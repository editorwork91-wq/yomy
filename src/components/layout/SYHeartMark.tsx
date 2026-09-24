import { useState } from 'react'

export default function SYHeartMark() {
  const [active, setActive] = useState(false)
  return (
    <button
      type="button"
      aria-label="Yomy heart mark"
      onClick={() => setActive(value => !value)}
      className="relative size-10 shrink-0 [perspective:700px] active:scale-95"
    >
      <span className="absolute inset-0 transition-transform duration-500 [transform-style:preserve-3d]" style={{ transform: active ? 'rotateY(180deg) rotateX(8deg)' : 'rotateY(0deg) rotateX(0deg)' }}>
        <svg viewBox="0 0 48 48" className="absolute inset-0 size-full overflow-visible drop-shadow-[0_12px_20px_rgba(244,63,94,.30)]" aria-hidden="true">
          <defs>
            <linearGradient id="yomyHeartGradient" x1="8" y1="4" x2="42" y2="45">
              <stop offset="0%" stopColor="#f472b6" />
              <stop offset="48%" stopColor="#f43f5e" />
              <stop offset="100%" stopColor="#fb923c" />
            </linearGradient>
          </defs>
          <path d="M24 42C21 38 7 29 7 17C7 10.5 11.7 6 17.7 6C21 6 23.2 7.9 24 10.1C24.8 7.9 27 6 30.3 6C36.3 6 41 10.5 41 17C41 29 27 38 24 42Z" fill="url(#yomyHeartGradient)" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center pt-1 text-[9px] font-black tracking-[-.12em] text-white drop-shadow-md">
          <span>S</span><span className="-mx-px text-[10px]">Y</span>
        </span>
      </span>
      {active && <span className="absolute -inset-1 rounded-full border border-rose-300/70 animate-ping pointer-events-none" />}
    </button>
  )
}
