import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { registerPushSubscription } from '@/lib/push'

export default function PushManager() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    // Keep native FCM initialization completely outside the application
    // startup path until the Android runtime is proven stable on-device.
    // Web Push remains available here and is already isolated by its own
    // error handling.
    void registerPushSubscription().catch(error => {
      console.warn('Yomy web push registration skipped:', error instanceof Error ? error.message : error)
    })
  }, [user])

  return null
}
