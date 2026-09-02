import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '@/lib/supabase'

let listenersInstalled = false

export async function registerNativePush(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false

  const permission = await PushNotifications.checkPermissions()
  const finalPermission = permission.receive === 'granted' ? permission : await PushNotifications.requestPermissions()
  if (finalPermission.receive !== 'granted') return false

  if (!listenersInstalled) {
    listenersInstalled = true
    await PushNotifications.addListener('registration', async token => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'
      const { error } = await supabase.from('native_push_tokens').upsert({
        user_id: user.id,
        platform,
        token: token.value,
        user_agent: navigator.userAgent.slice(0, 512),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,token' })
      if (error) console.warn('native push token save failed:', error.message)
    })

    await PushNotifications.addListener('registrationError', error => {
      console.warn('native push registration failed:', error)
    })

    await PushNotifications.addListener('pushNotificationActionPerformed', event => {
      const url = event.notification.data?.url
      if (typeof url === 'string' && url) window.location.assign(url)
    })
  }

  await PushNotifications.register()
  return true
}
