const APP_CACHE = 'lv-player-app-v1-6-8-url-operation-core'
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
  // API 요청은 절대 캐시하지 않습니다. heartbeat/app-config/playlist는 항상 최신 네트워크 값이어야 합니다.
  if (url.pathname.includes('/api/')) return

  if (url.origin === location.origin && event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(APP_CACHE).then((cache) => {
              cache.put('./index.html', clone.clone()).catch(() => {})
              cache.put(event.request, clone).catch(() => {})
            })
          }
          return response
        })
        .catch(async () =>
          (await caches.match('./index.html')) ||
          (await caches.match('./')) ||
          caches.match(event.request, { ignoreSearch: true })
        )
    )
    return
  }

  if (url.origin === location.origin) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone).catch(() => {}))
          }
          return response
        })
        .catch(async () =>
          (await caches.match(event.request)) ||
          caches.match(event.request, { ignoreSearch: true })
        )
    )
  }
})
