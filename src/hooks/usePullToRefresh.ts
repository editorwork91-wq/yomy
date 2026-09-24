import { useEffect, useRef, useState } from 'react'

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<{ y: number; x: number } | null>(null)
  const tracking = useRef(false)
  const distanceRef = useRef(0)

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (refreshing || window.scrollY > 2 || event.touches.length !== 1) return
      const touch = event.touches[0]
      start.current = { y: touch.clientY, x: touch.clientX }
      tracking.current = true
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking.current || !start.current || refreshing) return
      if (window.scrollY > 2) { tracking.current = false; return }
      const touch = event.touches[0]
      const dy = touch.clientY - start.current.y
      const dx = touch.clientX - start.current.x
      if (dy < 4 || Math.abs(dx) > Math.abs(dy)) return
      const next = Math.min(92, Math.max(0, dy * 0.55))
      distanceRef.current = next
      setPullDistance(next)
      if (next > 8) event.preventDefault()
    }
    const onTouchEnd = () => {
      if (!tracking.current) return
      tracking.current = false
      const shouldRefresh = distanceRef.current >= 58
      distanceRef.current = 0
      if (!shouldRefresh) { setPullDistance(0); return }
      setRefreshing(true)
      setPullDistance(72)
      Promise.resolve(onRefresh()).finally(() => {
        setRefreshing(false)
        setPullDistance(0)
      })
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onRefresh, refreshing])

  return { pullDistance, refreshing }
}
