import { Capacitor } from '@capacitor/core'

type NativeNotificationBridge = {
  show: (title: string, body: string, kind?: 'message' | 'call') => void
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
      if (!bridge?.show) return false
      bridge.show(title, body, kind)
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
