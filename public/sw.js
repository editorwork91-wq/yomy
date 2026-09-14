self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Yomy', body: event.data?.text() || '' } }
  const title = data.title || 'Yomy'
  const body = data.body || 'You have a new notification'
  const payload = data.data || {}
  const options = {
    body,
    icon: data.icon || '/YOMY-LOGO.jpeg',
    badge: data.badge || '/YOMY-LOGO.jpeg',
    tag: data.tag || 'yomy-notification',
    renotify: true,
    requireInteraction: data.type === 'call',
    data: payload,
    actions: data.type === 'call' ? [{ action: 'open', title: 'Open call' }] : [],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = data.url || data.deep_link || data.deepLink || '/notifications'
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url)
  })())
})
