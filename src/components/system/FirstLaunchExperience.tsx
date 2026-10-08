import { useEffect, useState } from 'react'

const STORAGE_KEY = 'yomy-first-launch-completed'

export default function FirstLaunchExperience() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY))
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    const leaveTimer = window.setTimeout(() => setLeaving(true), 1500)
    const doneTimer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, 'true')
      setVisible(false)
    }, 2050)

    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(doneTimer)
    }
  }, [visible])

  if (!visible) return null

  return (
    <div
      className={`yomy-first-launch fixed inset-0 z-[120] overflow-hidden bg-[#050506] transition-opacity duration-500 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      role="status"
      aria-label="YOMY"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(143,110,255,.20),transparent_24%),radial-gradient(circle_at_28%_64%,rgba(255,90,180,.10),transparent_28%),radial-gradient(circle_at_72%_68%,rgba(80,175,255,.10),transparent_30%)]" />
      <div className="absolute left-1/2 top-1/2 size-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.025] shadow-[0_0_120px_rgba(158,125,255,.18),inset_0_1px_1px_rgba(255,255,255,.18)] backdrop-blur-3xl" />
      <div className="relative flex min-h-dvh items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-6 flex size-24 items-center justify-center rounded-[2rem] border border-white/10 bg-white/[0.035] shadow-[0_24px_80px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-2xl yomy-launch-mark">
            <div className="absolute size-14 rounded-[1.4rem] bg-gradient-to-br from-violet-400/35 via-fuchsia-300/20 to-sky-300/25 blur-xl" />
            <span className="relative text-4xl font-black tracking-[-0.08em] text-white">yomy</span>
          </div>
          <h1 className="text-4xl font-black tracking-[-0.06em] text-white yomy-launch-wordmark">YOMY</h1>
          <p className="mt-2 text-[11px] tracking-[0.35em] text-white/45 uppercase">connect · share · be you</p>
        </div>
      </div>
    </div>
  )
}
