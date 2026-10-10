const SHELL_CACHE = 'yomy-shell-v2'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(['/','/index.html'])).catch(() => undefined))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('yomy-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))))
  )
  self.clients.claim()
})

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Yomy', body: event.data?.text() || '' } }
  const title = data.title || 'Yomy'
  const body = data.body || 'You have a new notification'
  const payload = data.data || {}
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: data.icon || '/YOMY-LOGO.jpeg',
    badge: data.badge || '/YOMY-LOGO.jpeg',
    tag: data.tag || 'yomy-notification',
    renotify: true,
    requireInteraction: data.type === 'call',
    data: payload,
    actions: data.type === 'call' ? [{ action: 'open', title: 'Open call' }] : [],
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = data.url || data.deep_link || data.deepLink || '/notifications'
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true })
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

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(SHELL_CACHE).then(cache => cache.put('/index.html', copy))
        }
        return response
      }).catch(() => caches.match('/index.html'))
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(SHELL_CACHE).then(cache => cache.put(request, copy))
      }
      return response
    }))
  )
})
