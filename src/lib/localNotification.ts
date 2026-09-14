import { Capacitor } from '@capacitor/core'

type NativeNotificationBridge = {
  show: (title: string, body: string, kind?: 'message' | 'call', url?: string) => void
  showCall?: (title: string, body: string, callId: string, kind: 'voice' | 'video') => void
}

export function showYomyLocalNotification(
  title: string,
  body: string,
  kind: 'message' | 'call' = 'message',
  url?: string,
): boolean {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false

  try {
    if (Capacitor.isNativePlatform()) {
      const bridge = (window as Window & { YomyNotification?: NativeNotificationBridge }).YomyNotification
      if (!bridge) return false
      if (kind === 'call' && bridge.showCall) return false
      if (!bridge.show) return false
      bridge.show(title, body, kind, url)
      return true
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title || 'Yomy', {
        body,
        icon: '/YOMY-LOGO.jpeg',
        badge: '/YOMY-LOGO.jpeg',
        tag: `yomy-${kind}-${Date.now()}`,
      })
      notification.onclick = () => {
        window.focus()
        notification.close()
        if (url) window.location.assign(url)
      }
      return true
    }
  } catch (error) {
    console.warn('Yomy local notification skipped:', error instanceof Error ? error.message : error)
  }

  return false
}

export function showYomyIncomingCallNotification(
  title: string,
  body: string,
  callId: string,
  kind: 'voice' | 'video',
): boolean {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false

  try {
    if (Capacitor.isNativePlatform()) {
      const bridge = (window as Window & { YomyNotification?: NativeNotificationBridge }).YomyNotification
      if (!bridge?.showCall) return false
      bridge.showCall(title, body, callId, kind)
      return true
    }
    return showYomyLocalNotification(title, body, 'call', `/messages?call=${encodeURIComponent(callId)}`)
  } catch (error) {
    console.warn('Yomy incoming call notification skipped:', error instanceof Error ? error.message : error)
    return false
  }
}
