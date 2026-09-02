import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { registerPushSubscription } from '@/lib/push'
import { registerNativePush } from '@/lib/nativePush'

export default function PushManager() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    // Never put native push/FCM initialization on the critical startup path.
    // Some Android devices/ROMs can take a moment to initialize Google Play
    // Services/Firebase. The app itself must remain usable even if push setup
    // is unavailable or rejected by the OS.
    void registerPushSubscription().catch(error => {
      console.warn('Yomy web push registration skipped:', error instanceof Error ? error.message : error)
    })

    const timer = window.setTimeout(() => {
      void registerNativePush().catch(error => {
        console.warn('Yomy native push registration skipped:', error instanceof Error ? error.message : error)
      })
    }, 4000)

    return () => window.clearTimeout(timer)
  }, [user])

  return null
}
