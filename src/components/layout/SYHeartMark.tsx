import { useState } from 'react'

export default function SYHeartMark() {
  const [active, setActive] = useState(false)
  return (
    <button
      type="button"
      aria-label="Yomy heart mark"
      onClick={() => setActive(value => !value)}
      className="relative size-9 shrink-0 [perspective:500px] active:scale-95"
    >
      <span className={'absolute inset-0 flex items-center justify-center rounded-[14px] bg-gradient-to-br from-fuchsia-500 via-rose-500 to-orange-400 text-white shadow-[0_10px_28px_rgba(244,63,94,.28)] transition-transform duration-500 ' + (active ? '[transform:rotateY(180deg)_rotateX(10deg)]' : '[transform:rotateY(0deg)_rotateX(0deg)]')}>
        <span className="text-[10px] font-black tracking-[-.12em] drop-shadow-sm">S</span>
        <span className="mx-[-1px] text-[11px]">♥</span>
        <span className="text-[10px] font-black tracking-[-.12em] drop-shadow-sm">Y</span>
      </span>
      {active && <span className="absolute -inset-1 rounded-[16px] border border-rose-300/60 animate-ping pointer-events-none" />}
    </button>
  )
}
