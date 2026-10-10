import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { registerPushSubscription } from '@/lib/push'
import { registerNativePush } from '@/lib/nativePush'
import { Capacitor } from '@capacitor/core'

export default function PushManager() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return

      if (Capacitor.isNativePlatform()) {
        void registerNativePush().catch(error => {
          console.warn('Yomy native push registration skipped:', error instanceof Error ? error.message : error)
        })
      } else {
        void registerPushSubscription().catch(error => {
          console.warn('Yomy web push registration skipped:', error instanceof Error ? error.message : error)
        })
      }
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [user])

  return null
}
