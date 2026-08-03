import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

precacheAndRoute(self.__WB_MANIFEST)

// Offline SPA fallback: any full-page navigation (hard refresh, direct URL,
// or an unknown route triggering a real request) falls back to the
// precached index.html instead of failing with no network. Once index.html
// loads, App.jsx's own routing (and its NotFound component) takes over.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

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