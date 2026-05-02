const APP_CACHE = 'lv-player-app-v1.4'
const APP_ASSETS = ['./', './index.html', './style.css', './app.js', './sw.js', './loading.jpg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('lv-player-app-') && key !== APP_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return
  if (url.pathname.includes('/api/')) return

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request, { cache: 'no-store' })
          .then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone))
            }
            return response
          })
          .catch(() => cached)
        return cached || network
      })
    )
  }
})
