import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '@/lib/supabase'

let listenersInstalled = false
let channelsCreated = false

function navigateInSpa(destination: string) {
  const safeDestination = destination && destination.startsWith('/') ? destination : '/notifications'
  try {
    window.history.pushState({}, '', safeDestination)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    window.location.hash = `#${safeDestination}`
  }
}

function dispatchIncomingCallOpen(callId: string) {
  if (!callId) return false
  window.dispatchEvent(new CustomEvent('yomy-call-action', { detail: { action: 'open', callId } }))
  return true
}

export async function registerNativePush(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false

  try {
    const permission = await PushNotifications.checkPermissions()
    const finalPermission = permission.receive === 'granted' ? permission : await PushNotifications.requestPermissions()
    if (finalPermission.receive !== 'granted') return false

    if (Capacitor.getPlatform() === 'android' && !channelsCreated) {
      try {
        await PushNotifications.createChannel({ id: 'yomy_default', name: 'Yomy', description: 'Yomy notifications', importance: 5, sound: 'default', vibration: true, lights: true })
        await PushNotifications.createChannel({ id: 'yomy_calls', name: 'Yomy Calls', description: 'Incoming Yomy calls', importance: 5, sound: 'default', vibration: true, lights: true })
        channelsCreated = true
      } catch (error) {
        console.warn('native push channel setup skipped:', error)
      }
    }

    if (!listenersInstalled) {
      listenersInstalled = true
      await PushNotifications.addListener('registration', async token => {
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) return
          const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'
          const { error } = await supabase.from('native_push_tokens').upsert({ user_id: user.id, platform, token: token.value, user_agent: navigator.userAgent.slice(0, 512), updated_at: new Date().toISOString() }, { onConflict: 'user_id,token' })
          if (error) console.warn('native push token save failed:', error.message)
        } catch (error) {
          console.warn('native push token persistence skipped:', error instanceof Error ? error.message : error)
        }
      })
      await PushNotifications.addListener('registrationError', error => console.warn('native push registration failed:', error))
      await PushNotifications.addListener('pushNotificationActionPerformed', event => {
        const data = event.notification.data as Record<string, unknown> | undefined
        const callId = typeof data?.call_id === 'string' ? data.call_id : ''
        const eventType = typeof data?.event_type === 'string' ? data.event_type : ''
        if (callId && (eventType === 'CALL_INCOMING' || data?.type === 'call' || data?.call_kind)) {
          dispatchIncomingCallOpen(callId)
          return
        }

        const destination = typeof data?.url === 'string' && data.url
          ? data.url
          : typeof data?.deep_link === 'string' && data.deep_link
            ? data.deep_link
            : typeof data?.deepLink === 'string' && data.deepLink
              ? data.deepLink
              : '/notifications'
        navigateInSpa(destination)
      })
    }

    await PushNotifications.register()
    return true
  } catch (error) {
    console.warn('native push registration unavailable:', error instanceof Error ? error.message : error)
    return false
  }
}
