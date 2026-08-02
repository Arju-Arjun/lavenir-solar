import { precacheAndRoute } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data.json()
  } catch (e) {
    data = { title: 'Notification', body: event.data ? event.data.text() : '' }
  }

  const options = {
    body: data.body || '',
    icon: '/favicon/android-chrome-192x192.png',
    badge: '/favicon/favicon-32x32.png',
    data: { url: data.url || '/' }
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Lavenir Solar', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => client.url === url)
      if (existing && 'focus' in existing) return existing.focus()
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})