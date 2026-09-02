self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Yomy', body: event.data?.text() || '' } }
  const title = data.title || 'Yomy'
  const body = data.body || 'You have a new notification'
  const options = {
    body,
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'yomy-notification',
    renotify: true,
    requireInteraction: data.type === 'call',
    data: data.data || {},
    actions: data.type === 'call' ? [{ action: 'open', title: 'Open call' }] : [],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
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
