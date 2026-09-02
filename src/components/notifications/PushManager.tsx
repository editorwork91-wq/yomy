import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { registerPushSubscription } from '@/lib/push'
import { registerNativePush } from '@/lib/nativePush'

export default function PushManager() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    void registerPushSubscription().catch(error => {
      console.warn('Yomy web push registration skipped:', error instanceof Error ? error.message : error)
    })
    void registerNativePush().catch(error => {
      console.warn('Yomy native push registration skipped:', error instanceof Error ? error.message : error)
    })
  }, [user])
  return null
}
