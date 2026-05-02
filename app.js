const params = new URLSearchParams(location.search)

const CONFIG = {
  store: params.get('store') || 'goobne',
  deviceId: params.get('deviceId') || '',
  apiBase: (params.get('apiBase') || 'https://localvision-cms.pages.dev').replace(/\/$/, ''),
  refreshMs: Number(params.get('refresh') || 600000),
  heartbeatMs: Number(params.get('heartbeat') || 30000),
  cacheMax: Number(params.get('cacheMax') || 20),
  prefetchAhead: Number(params.get('prefetchAhead') || 2),
  restart: params.get('restart') || '',
  restartMode: params.get('restartMode') || 'reload',
  restartJitterSec: Number(params.get('restartJitterSec') || 0),
  fit: params.get('fit') || 'cover',
  debug: params.get('debug') === '1',
}

const CACHE_NAME = 'lv-media-cache-v1.2'
const META_KEY = 'lv-media-cache-meta-v1.2'
const handledCommandKey = `lv-handled-command-${CONFIG.deviceId || CONFIG.store}`

const state = {
  leftItems: [],
  rightItems: [],
  leftIndex: 0,
  rightIndex: 0,
  leftTimer: null,
  rightTimer: null,
  lastRestartKey: '',
  lastSync: '',
  lastHeartbeat: '',
  clickCount: 0,
  clickTimer: null,
  objectUrls: {
    left: '',
    right: '',
  },
  cacheStatus: '-',
  isSyncing: false,
}

const els = {
  leftZone: document.getElementById('leftZone'),
  rightZone: document.getElementById('rightZone'),
  statusPill: document.getElementById('statusPill'),
  debugPanel: document.getElementById('debugPanel'),
  reloadBtn: document.getElementById('reloadBtn'),
  syncBtn: document.getElementById('syncBtn'),
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  dbgStore: document.getElementById('dbgStore'),
  dbgDevice: document.getElementById('dbgDevice'),
  dbgApi: document.getElementById('dbgApi'),
  dbgLeft: document.getElementById('dbgLeft'),
  dbgRight: document.getElementById('dbgRight'),
  dbgSync: document.getElementById('dbgSync'),
  dbgHeartbeat: document.getElementById('dbgHeartbeat'),
  dbgCache: document.getElementById('dbgCache'),
  dbgStatus: document.getElementById('dbgStatus'),
}

function setStatus(message) {
  els.statusPill.textContent = message
  els.dbgStatus.textContent = message
}

function updateDebug() {
  els.dbgStore.textContent = CONFIG.store
  els.dbgDevice.textContent = CONFIG.deviceId || '미지정'
  els.dbgApi.textContent = CONFIG.apiBase
  els.dbgLeft.textContent = String(state.leftItems.length)
  els.dbgRight.textContent = String(state.rightItems.length)
  els.dbgSync.textContent = state.lastSync || '-'
  els.dbgHeartbeat.textContent = state.lastHeartbeat || '-'
  els.dbgCache.textContent = state.cacheStatus
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  try {
    await navigator.serviceWorker.register('./sw.js')
  } catch (error) {
    console.warn('Service Worker registration failed:', error.message)
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }

  return data
}

async function fetchPlayerConfig() {
  const url = `${CONFIG.apiBase}/api/player-config?store=${encodeURIComponent(CONFIG.store)}&t=${Date.now()}`
  return fetchJson(url)
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return []

  return items
    .filter((item) => item && item.status === '사용중')
    .map((item) => ({
      ...item,
      duration: Number(item.duration || 10),
      url: item.url || '',
      type: item.type || guessType(item.url || item.fileName || ''),
      cacheUrl: makeCacheUrl(item.url || ''),
    }))
    .filter((item) => item.url)
}

function guessType(value) {
  const lower = String(value).toLowerCase()
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) return 'video'
  return 'image'
}

function lightItem(item) {
  return {
    id: item.id,
    url: item.url,
    duration: item.duration,
    status: item.status,
    sortOrder: item.sortOrder,
  }
}

function playlistSignature(items) {
  return JSON.stringify(items.map(lightItem))
}

function samePlaylist(a, b) {
  return playlistSignature(a) === playlistSignature(b)
}

function makeCacheUrl(rawUrl) {
  if (!rawUrl) return ''

  try {
    const url = new URL(rawUrl)
    if (url.pathname.includes('/api/media')) return rawUrl

    const index = url.pathname.indexOf('/stores/')
    if (index >= 0) {
      const key = url.pathname.slice(index + 1)
      return `${CONFIG.apiBase}/api/media?key=${encodeURIComponent(key)}`
    }

    return rawUrl
  } catch {
    return rawUrl
  }
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

function touchMeta(url) {
  const meta = loadMeta()
  meta[url] = {
    lastUsed: Date.now(),
  }
  saveMeta(meta)
}

async function getMediaCache() {
  return caches.open(CACHE_NAME)
}

async function getCachedMediaBlobUrl(item) {
  const requestUrl = item.cacheUrl || item.url
  const cache = await getMediaCache()
  let response = await cache.match(requestUrl)

  if (!response) {
    response = await fetch(requestUrl, { cache: 'reload' })

    if (!response.ok) {
      throw new Error(`media fetch failed ${response.status}`)
    }

    await cache.put(requestUrl, response.clone())
  }

  touchMeta(requestUrl)

  const blob = await response.clone().blob()
  return URL.createObjectURL(blob)
}

async function prefetchItem(item) {
  if (!item?.url) return false

  const requestUrl = item.cacheUrl || item.url

  try {
    const cache = await getMediaCache()
    const cached = await cache.match(requestUrl)
    if (cached) {
      touchMeta(requestUrl)
      return true
    }

    const response = await fetch(requestUrl, { cache: 'reload' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    await cache.put(requestUrl, response.clone())
    touchMeta(requestUrl)
    return true
  } catch (error) {
    console.warn('prefetch failed:', requestUrl, error.message)
    return false
  }
}

async function prefetchAround(side, items, index = 0) {
  if (!items.length) return

  const list = []
  const max = Math.min(CONFIG.prefetchAhead + 1, items.length)

  for (let i = 0; i < max; i += 1) {
    list.push(items[(index + i) % items.length])
  }

  await Promise.allSettled(list.map((item) => prefetchItem(item)))
  await cleanupMediaCache([...state.leftItems, ...state.rightItems, ...items])
  updateCacheStatus()
}

async function preparePlaylist(items) {
  if (!items.length) return true

  const first = items[0]
  const ok = await prefetchItem(first)
  return ok
}

async function cleanupMediaCache(activeItems = []) {
  const cache = await getMediaCache()
  const keys = await cache.keys()
  const meta = loadMeta()
  const activeUrls = new Set(
    activeItems
      .map((item) => item.cacheUrl || item.url)
      .filter(Boolean)
  )

  for (const request of keys) {
    if (!activeUrls.has(request.url) && keys.length > CONFIG.cacheMax) {
      await cache.delete(request)
      delete meta[request.url]
    }
  }

  const nextKeys = await cache.keys()
  if (nextKeys.length > CONFIG.cacheMax) {
    const sorted = nextKeys
      .map((request) => ({
        request,
        lastUsed: meta[request.url]?.lastUsed || 0,
      }))
      .sort((a, b) => a.lastUsed - b.lastUsed)

    const removeCount = nextKeys.length - CONFIG.cacheMax
    for (const item of sorted.slice(0, removeCount)) {
      await cache.delete(item.request)
      delete meta[item.request.url]
    }
  }

  saveMeta(meta)
}

async function updateCacheStatus() {
  try {
    const cache = await getMediaCache()
    const keys = await cache.keys()
    state.cacheStatus = `${keys.length}/${CONFIG.cacheMax}`
    updateDebug()
  } catch {
    state.cacheStatus = '-'
  }
}

async function clearMediaCache() {
  await caches.delete(CACHE_NAME)
  localStorage.removeItem(META_KEY)
  state.cacheStatus = 'cleared'
  updateDebug()
  setStatus('미디어 캐시를 삭제했습니다')
}

async function syncConfig() {
  if (state.isSyncing) return
  state.isSyncing = true

  try {
    setStatus('CMS 재생목록 확인중...')
    const data = await fetchPlayerConfig()

    const nextLeft = normalizeItems(data.playlists?.left)
    const nextRight = normalizeItems(data.playlists?.right)

    handleRemoteCommand(data.devices || [])

    const leftChanged = !samePlaylist(state.leftItems, nextLeft)
    const rightChanged = !samePlaylist(state.rightItems, nextRight)

    if (leftChanged) {
      setStatus('좌측 새 콘텐츠 준비중...')
      await preparePlaylist(nextLeft)
      state.leftItems = nextLeft
      state.leftIndex = 0
      startPlayback('left')
    }

    if (rightChanged) {
      setStatus('우측 새 콘텐츠 준비중...')
      await preparePlaylist(nextRight)
      state.rightItems = nextRight
      state.rightIndex = 0
      startPlayback('right')
    }

    if (!leftChanged && !state.leftTimer) startPlayback('left')
    if (!rightChanged && !state.rightTimer) startPlayback('right')

    await prefetchAround('left', state.leftItems, state.leftIndex)
    await prefetchAround('right', state.rightItems, state.rightIndex)

    state.lastSync = new Date().toLocaleString('ko-KR')
    setStatus('CMS 재생목록 동기화 완료')
    updateDebug()
  } catch (error) {
    console.error(error)
    setStatus(`CMS 확인 실패, 기존 재생 유지: ${error.message}`)
    updateDebug()
  } finally {
    state.isSyncing = false
  }
}


function handleRemoteCommand(devices) {
  if (!CONFIG.deviceId) return

  const myDevice = devices.find((device) => device.id === CONFIG.deviceId)
  if (!myDevice) return

  if (myDevice.lastCommand === 'refresh' && myDevice.commandAt) {
    const handled = localStorage.getItem(handledCommandKey)
    if (handled !== myDevice.commandAt) {
      localStorage.setItem(handledCommandKey, myDevice.commandAt)
      setStatus('CMS 새로고침 명령 수신')
      setTimeout(() => location.reload(), 600)
    }
  }
}

async function sendHeartbeat() {
  if (!CONFIG.deviceId) return

  try {
    const now = new Date().toLocaleString('ko-KR')
    await fetchJson(`${CONFIG.apiBase}/api/devices`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: CONFIG.deviceId,
        online: true,
        lastSeen: now,
      }),
    })

    state.lastHeartbeat = now
    updateDebug()
  } catch (error) {
    console.warn('Heartbeat failed:', error.message)
  }
}

function getZone(side) {
  return side === 'left' ? els.leftZone : els.rightZone
}

function getItems(side) {
  return side === 'left' ? state.leftItems : state.rightItems
}

function getIndex(side) {
  return side === 'left' ? state.leftIndex : state.rightIndex
}

function setIndex(side, value) {
  if (side === 'left') state.leftIndex = value
  if (side === 'right') state.rightIndex = value
}

function clearSideTimer(side) {
  if (side === 'left' && state.leftTimer) {
    clearTimeout(state.leftTimer)
    state.leftTimer = null
  }

  if (side === 'right' && state.rightTimer) {
    clearTimeout(state.rightTimer)
    state.rightTimer = null
  }
}

function setSideTimer(side, callback, ms) {
  clearSideTimer(side)

  if (side === 'left') {
    state.leftTimer = setTimeout(callback, ms)
  } else {
    state.rightTimer = setTimeout(callback, ms)
  }
}

function emptyMarkup(side) {
  const title = side === 'left' ? 'LocalVision' : 'LV'
  const sub = side === 'left'
    ? '좌측 매장 콘텐츠가 없습니다'
    : '우측 공통 콘텐츠가 없습니다'

  return `
    <div class="empty ${side === 'right' ? 'small' : ''}">
      <strong>${title}</strong>
      <span>${sub}</span>
    </div>
  `
}

function releaseObjectUrl(side) {
  if (state.objectUrls[side]) {
    URL.revokeObjectURL(state.objectUrls[side])
    state.objectUrls[side] = ''
  }
}

function startPlayback(side) {
  clearSideTimer(side)

  const items = getItems(side)
  const zone = getZone(side)

  if (!items.length) {
    releaseObjectUrl(side)
    zone.innerHTML = emptyMarkup(side)
    return
  }

  const currentIndex = getIndex(side) % items.length
  setIndex(side, currentIndex)
  playItem(side, items[currentIndex])
}

async function playItem(side, item) {
  const zone = getZone(side)

  if (!item?.url) {
    zone.innerHTML = emptyMarkup(side)
    scheduleNext(side, item?.duration || 10)
    return
  }

  try {
    const objectUrl = await getCachedMediaBlobUrl(item)
    releaseObjectUrl(side)
    state.objectUrls[side] = objectUrl

    if (item.type === 'video') {
      playVideo(side, item, objectUrl)
    } else {
      playImage(side, item, objectUrl)
    }

    const currentIndex = getIndex(side)
    prefetchAround(side, getItems(side), currentIndex + 1)
  } catch (error) {
    console.warn('play item failed:', item.url, error.message)
    playDirectFallback(side, item)
  }
}

function applyFit(element) {
  element.className = `media fade-in ${CONFIG.fit === 'contain' ? 'contain' : ''}`
}

function playImage(side, item, src) {
  const zone = getZone(side)
  const img = document.createElement('img')
  applyFit(img)
  img.src = src
  img.alt = item.title || 'LocalVision image'

  img.onload = () => {
    zone.replaceChildren(img)
    scheduleNext(side, item.duration || 10)
  }

  img.onerror = () => {
    zone.innerHTML = emptyMarkup(side)
    scheduleNext(side, 5)
  }
}

function playVideo(side, item, src) {
  const zone = getZone(side)
  const video = document.createElement('video')

  applyFit(video)
  video.src = src
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  video.onloadeddata = () => {
    zone.replaceChildren(video)
    video.play().catch(() => {})
  }

  video.onended = () => {
    next(side)
  }

  video.onerror = () => {
    zone.innerHTML = emptyMarkup(side)
    scheduleNext(side, 5)
  }

  video.onloadedmetadata = () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setSideTimer(side, () => next(side), (video.duration + 2) * 1000)
    }
  }

  const safetyMs = Math.max(60, Number(item.duration || 0) || 1800) * 1000
  setSideTimer(side, () => next(side), safetyMs)
}

function playDirectFallback(side, item) {
  if (item.type === 'video') {
    playVideo(side, item, item.url)
  } else {
    playImage(side, item, item.url)
  }
}

function scheduleNext(side, durationSeconds) {
  const ms = Math.max(3, Number(durationSeconds || 10)) * 1000
  setSideTimer(side, () => next(side), ms)
}

function next(side) {
  const items = getItems(side)
  if (!items.length) return

  const nextIndex = (getIndex(side) + 1) % items.length
  setIndex(side, nextIndex)
  playItem(side, items[nextIndex])
}

function setupDailyRestart() {
  if (!CONFIG.restart) return

  const jitterMs = CONFIG.restartJitterSec > 0
    ? Math.floor(Math.random() * CONFIG.restartJitterSec * 1000)
    : 0

  setInterval(() => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const key = `${now.toISOString().slice(0, 10)}-${CONFIG.restart}`

    if (`${hh}:${mm}` === CONFIG.restart && state.lastRestartKey !== key) {
      state.lastRestartKey = key

      setTimeout(() => {
        if (CONFIG.restartMode === 'reload') {
          location.reload()
        }
      }, jitterMs)
    }
  }, 15000)
}

function setupDebugToggle() {
  if (CONFIG.debug) {
    els.debugPanel.hidden = false
  }

  document.body.addEventListener('click', () => {
    state.clickCount += 1
    clearTimeout(state.clickTimer)
    state.clickTimer = setTimeout(() => {
      state.clickCount = 0
    }, 1300)

    if (state.clickCount >= 5) {
      els.debugPanel.hidden = !els.debugPanel.hidden
      state.clickCount = 0
    }
  })

  els.reloadBtn.addEventListener('click', () => {
    location.reload()
  })

  els.syncBtn.addEventListener('click', () => {
    syncConfig()
    sendHeartbeat()
  })

  els.clearCacheBtn.addEventListener('click', () => {
    clearMediaCache()
  })
}

window.addEventListener('error', (event) => {
  setStatus(`오류: ${event.message}`)
})

window.addEventListener('unhandledrejection', (event) => {
  setStatus(`오류: ${event.reason?.message || event.reason}`)
})

async function boot() {
  await registerServiceWorker()
  setupDebugToggle()
  setupDailyRestart()
  updateDebug()
  await updateCacheStatus()
  await syncConfig()
  await sendHeartbeat()

  setInterval(syncConfig, CONFIG.refreshMs)
  setInterval(sendHeartbeat, CONFIG.heartbeatMs)
}

boot()
