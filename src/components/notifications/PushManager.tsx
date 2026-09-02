import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { registerPushSubscription } from '@/lib/push'

export default function PushManager() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    void registerPushSubscription().catch(error => {
      console.warn('Yomy push registration skipped:', error instanceof Error ? error.message : error)
    })
  }, [user])
  return null
}
