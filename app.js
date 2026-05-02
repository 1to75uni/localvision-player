const params = new URLSearchParams(location.search)

const CONFIG = {
  store: params.get('store') || 'goobne',
  deviceId: params.get('deviceId') || '',
  apiBase: (params.get('apiBase') || 'https://localvision-cms.pages.dev').replace(/\/$/, ''),
  refreshMs: Number(params.get('refresh') || 3600000),
  heartbeatMs: Number(params.get('heartbeat') || 30000),
  cacheMax: Number(params.get('cacheMax') || 60),
  restart: params.get('restart') || '',
  restartMode: params.get('restartMode') || 'reload',
  restartJitterSec: Number(params.get('restartJitterSec') || 0),
  fit: params.get('fit') || 'cover',
  videoMode: params.get('videoMode') || 'cache',
  bundleMode: params.get('bundleMode') || 'cache',
  cacheAll: params.get('cacheAll') !== '0',
  activateWhenCached: params.get('activateWhenCached') !== '0',
  debug: params.get('debug') === '1',
}

const MEDIA_CACHE = 'lv-media-bundle-v1.4'
const META_KEY = 'lv-media-bundle-meta-v1.4'
const PLAYLIST_KEY = `lv-playlist-bundle-v1.4-${CONFIG.store}`
const handledCommandKey = `lv-handled-command-${CONFIG.deviceId || CONFIG.store}`

const state = {
  leftItems: [],
  rightItems: [],
  leftIndex: 0,
  rightIndex: 0,
  leftTimer: null,
  rightTimer: null,
  leftWatchdog: null,
  rightWatchdog: null,
  objectUrls: { left: '', right: '' },
  playToken: { left: 0, right: 0 },
  lastSync: '',
  lastHeartbeat: '',
  bundleStatus: '-',
  cacheStatus: '-',
  lastRestartKey: '',
  isSyncing: false,
  clickCount: 0,
  clickTimer: null,
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
  dbgBundle: document.getElementById('dbgBundle'),
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
  els.dbgBundle.textContent = state.bundleStatus
  els.dbgCache.textContent = state.cacheStatus
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  try { await navigator.serviceWorker.register('./sw.js') } catch (error) {}
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { ...(options.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function fetchPlayerConfig() {
  return fetchJson(`${CONFIG.apiBase}/api/player-config?store=${encodeURIComponent(CONFIG.store)}&t=${Date.now()}`)
}

function guessType(value) {
  const lower = String(value || '').toLowerCase()
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.includes('.mp4?')) return 'video'
  return 'image'
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
      cacheKey: item.url || '',
    }))
    .filter((item) => item.url)
}

function lightItems(items) {
  return items.map((item) => ({
    id: item.id,
    url: item.url,
    type: item.type,
    duration: item.duration,
    status: item.status,
    sortOrder: item.sortOrder,
  }))
}

function playlistSignature(items) {
  return JSON.stringify(lightItems(items))
}

function bundleSignature(left, right) {
  return JSON.stringify({
    left: lightItems(left),
    right: lightItems(right),
  })
}

function loadSavedBundle() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYLIST_KEY) || 'null')
    if (!saved) return false
    if (!Array.isArray(saved.left) || !Array.isArray(saved.right)) return false

    state.leftItems = saved.left
    state.rightItems = saved.right
    state.leftIndex = Number(saved.leftIndex || 0)
    state.rightIndex = Number(saved.rightIndex || 0)
    state.bundleStatus = `saved ${saved.savedAt || ''}`
    updateDebug()
    return state.leftItems.length > 0 || state.rightItems.length > 0
  } catch {
    return false
  }
}

function saveBundle(left, right) {
  localStorage.setItem(PLAYLIST_KEY, JSON.stringify({
    left,
    right,
    sig: bundleSignature(left, right),
    savedAt: new Date().toISOString(),
  }))
}

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') } catch { return {} }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta || {}))
}

function touchMeta(url, patch = {}) {
  const meta = loadMeta()
  meta[url] = {
    ...(meta[url] || {}),
    ...patch,
    lastUsed: Date.now(),
  }
  saveMeta(meta)
}

async function getMediaCache() {
  return caches.open(MEDIA_CACHE)
}

async function isCached(url) {
  const cache = await getMediaCache()
  return !!(await cache.match(url))
}

async function ensureCached(item, index, total) {
  if (!item?.url) return false

  const cache = await getMediaCache()
  const hit = await cache.match(item.url)
  if (hit) {
    touchMeta(item.url, { type: item.type, side: item.side })
    return true
  }

  state.bundleStatus = `다운로드 ${index}/${total}`
  setStatus(`미디어 다운로드중 ${index}/${total}`)
  updateDebug()

  const response = await fetch(item.url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`media ${response.status}`)
  await cache.put(item.url, response.clone())
  touchMeta(item.url, { type: item.type, side: item.side })
  return true
}

async function ensureBundleCached(left, right) {
  const bundle = [
    ...left.map((item) => ({ ...item, side: 'left' })),
    ...right.map((item) => ({ ...item, side: 'right' })),
  ].filter((item) => item.url)

  const unique = []
  const seen = new Set()
  for (const item of bundle) {
    if (!seen.has(item.url)) {
      seen.add(item.url)
      unique.push(item)
    }
  }

  if (!unique.length) return true

  for (let i = 0; i < unique.length; i += 1) {
    await ensureCached(unique[i], i + 1, unique.length)
  }

  await pruneCache(unique.map((item) => item.url))
  state.bundleStatus = `완료 ${unique.length}개`
  updateDebug()
  return true
}

async function pruneCache(activeUrls = []) {
  const cache = await getMediaCache()
  const keys = await cache.keys()
  const meta = loadMeta()
  const keep = new Set(activeUrls)

  if (keys.length <= CONFIG.cacheMax) {
    state.cacheStatus = `${keys.length}/${CONFIG.cacheMax}`
    updateDebug()
    return
  }

  const removable = keys
    .map((request) => ({
      request,
      url: request.url,
      keep: keep.has(request.url),
      lastUsed: meta[request.url]?.lastUsed || 0,
    }))
    .filter((entry) => !entry.keep)
    .sort((a, b) => a.lastUsed - b.lastUsed)

  let count = keys.length
  for (const entry of removable) {
    if (count <= CONFIG.cacheMax) break
    await cache.delete(entry.request)
    delete meta[entry.url]
    count -= 1
  }

  saveMeta(meta)
  state.cacheStatus = `${count}/${CONFIG.cacheMax}`
  updateDebug()
}

async function updateCacheStatus() {
  try {
    const cache = await getMediaCache()
    const keys = await cache.keys()
    state.cacheStatus = `${keys.length}/${CONFIG.cacheMax}`
  } catch {
    state.cacheStatus = '-'
  }
  updateDebug()
}

async function clearMediaCache() {
  await caches.delete(MEDIA_CACHE)
  localStorage.removeItem(META_KEY)
  state.cacheStatus = 'cleared'
  state.bundleStatus = 'cleared'
  updateDebug()
  setStatus('미디어 캐시를 삭제했습니다')
}

async function getCachedBlobUrl(item) {
  const cache = await getMediaCache()
  let response = await cache.match(item.url)

  if (!response) {
    if (!navigator.onLine) throw new Error('offline cache miss')
    await ensureCached(item, 1, 1)
    response = await cache.match(item.url)
  }

  if (!response) throw new Error('cache miss')

  touchMeta(item.url, { type: item.type })
  const blob = await response.clone().blob()
  return URL.createObjectURL(blob)
}

async function syncConfig(reason = 'scheduled') {
  if (state.isSyncing) return
  state.isSyncing = true

  try {
    setStatus('CMS 재생목록 확인중...')
    const data = await fetchPlayerConfig()

    handleRemoteCommand(data.devices || [])

    const nextLeft = normalizeItems(data.playlists?.left)
    const nextRight = normalizeItems(data.playlists?.right)

    if (!nextLeft.length && !nextRight.length) {
      throw new Error('playlist empty')
    }

    const changed = bundleSignature(nextLeft, nextRight) !== bundleSignature(state.leftItems, state.rightItems)

    if (!changed && state.leftItems.length + state.rightItems.length > 0) {
      state.lastSync = new Date().toLocaleString('ko-KR')
      state.bundleStatus = '변경 없음'
      setStatus('CMS 확인 완료: 변경 없음')
      updateDebug()
      return
    }

    if (CONFIG.bundleMode === 'cache' && CONFIG.activateWhenCached) {
      await ensureBundleCached(nextLeft, nextRight)
    }

    state.leftItems = nextLeft
    state.rightItems = nextRight
    state.leftIndex = 0
    state.rightIndex = 0

    saveBundle(nextLeft, nextRight)

    startPlayback('left')
    window.setTimeout(() => startPlayback('right'), 500)

    state.lastSync = new Date().toLocaleString('ko-KR')
    setStatus('새 재생목록 적용 완료')
    updateDebug()
  } catch (error) {
    console.warn(error)
    if (!state.leftItems.length && !state.rightItems.length) {
      const ok = loadSavedBundle()
      if (ok) {
        startPlayback('left')
        window.setTimeout(() => startPlayback('right'), 500)
        setStatus('오프라인: 저장된 재생목록 사용')
      } else {
        setStatus(`재생목록 확인 실패: ${error.message}`)
      }
    } else {
      setStatus(`CMS 확인 실패, 기존 재생 유지: ${error.message}`)
    }
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
      body: JSON.stringify({ id: CONFIG.deviceId, online: true, lastSeen: now }),
    })
    state.lastHeartbeat = now
    updateDebug()
  } catch (error) {}
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
  else state.rightIndex = value
}

function clearSideTimer(side) {
  const key = side === 'left' ? 'leftTimer' : 'rightTimer'
  if (state[key]) clearTimeout(state[key])
  state[key] = null
}

function setSideTimer(side, callback, ms) {
  clearSideTimer(side)
  if (side === 'left') state.leftTimer = setTimeout(callback, ms)
  else state.rightTimer = setTimeout(callback, ms)
}

function clearWatchdog(side) {
  const key = side === 'left' ? 'leftWatchdog' : 'rightWatchdog'
  if (state[key]) clearTimeout(state[key])
  state[key] = null
}

function setWatchdog(side, callback, ms) {
  clearWatchdog(side)
  if (side === 'left') state.leftWatchdog = setTimeout(callback, ms)
  else state.rightWatchdog = setTimeout(callback, ms)
}

function emptyMarkup(side) {
  const title = side === 'left' ? 'LocalVision' : 'LV'
  const sub = side === 'left' ? '좌측 매장 콘텐츠가 없습니다' : '우측 공통 콘텐츠가 없습니다'
  return `<div class="empty ${side === 'right' ? 'small loading' : ''}">
    <strong>${title}</strong><span>${sub}</span>
  </div>`
}

function releaseObjectUrl(side) {
  if (state.objectUrls[side]) {
    URL.revokeObjectURL(state.objectUrls[side])
    state.objectUrls[side] = ''
  }
}

function startPlayback(side) {
  clearSideTimer(side)
  clearWatchdog(side)

  const items = getItems(side)
  const zone = getZone(side)

  if (!items.length) {
    zone.innerHTML = emptyMarkup(side)
    return
  }

  const currentIndex = getIndex(side) % items.length
  setIndex(side, currentIndex)
  playItem(side, items[currentIndex])
}

async function playItem(side, item) {
  if (!item?.url) return scheduleNext(side, 5)

  state.playToken[side] += 1
  const token = state.playToken[side]

  try {
    const src = CONFIG.videoMode === 'cache' || item.type !== 'video'
      ? await getCachedBlobUrl(item)
      : item.url

    if (token !== state.playToken[side]) {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src)
      return
    }

    releaseObjectUrl(side)
    if (src.startsWith('blob:')) state.objectUrls[side] = src

    if (item.type === 'video') playVideo(side, item, src, token)
    else playImage(side, item, src, token)
  } catch (error) {
    console.warn('play failed', side, error.message)
    setStatus(`${side} 캐시 없음, 다음 콘텐츠 대기`)
    scheduleNext(side, 5)
  }
}

function applyFit(element) {
  element.className = `media fade-in ${CONFIG.fit === 'contain' ? 'contain' : ''}`
}

function swapWhenReady(side, element, token) {
  if (token !== state.playToken[side]) return
  getZone(side).replaceChildren(element)
}

function playImage(side, item, src, token) {
  const img = document.createElement('img')
  applyFit(img)
  img.src = src
  img.alt = item.title || 'LocalVision image'

  img.onload = () => {
    if (token !== state.playToken[side]) return
    swapWhenReady(side, img, token)
    scheduleNext(side, item.duration || 10)
  }

  img.onerror = () => scheduleNext(side, 5)
}

function playVideo(side, item, src, token) {
  const video = document.createElement('video')
  applyFit(video)
  video.src = src
  video.autoplay = false
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.controls = false

  let swapped = false
  let started = false

  const reveal = () => {
    if (swapped || token !== state.playToken[side]) return
    swapped = true

    try { video.currentTime = 0 } catch {}

    swapWhenReady(side, video, token)

    const delay = side === 'right' ? 200 : 0
    setTimeout(() => {
      video.play().then(() => {
        started = true
        clearWatchdog(side)
      }).catch(() => {
        setTimeout(() => video.play().catch(() => {}), 300)
      })
    }, delay)
  }

  video.onloadeddata = reveal
  video.oncanplay = reveal

  video.onended = () => next(side)
  video.onerror = () => scheduleNext(side, 5)

  video.onloadedmetadata = () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setSideTimer(side, () => next(side), Math.ceil(video.duration + 2) * 1000)
    }
  }

  setWatchdog(side, () => {
    if (!started) next(side)
  }, 15000)

  const safetyMs = Math.max(60, Number(item.duration || 0) || 1800) * 1000
  setSideTimer(side, () => next(side), safetyMs)

  try { video.load() } catch {}
}

function scheduleNext(side, durationSeconds) {
  setSideTimer(side, () => next(side), Math.max(3, Number(durationSeconds || 10)) * 1000)
}

function next(side) {
  clearWatchdog(side)
  const items = getItems(side)
  if (!items.length) return
  const nextIndex = (getIndex(side) + 1) % items.length
  setIndex(side, nextIndex)
  playItem(side, items[nextIndex])
}

function setupDailyRestart() {
  if (!CONFIG.restart) return
  const jitterMs = CONFIG.restartJitterSec > 0 ? Math.floor(Math.random() * CONFIG.restartJitterSec * 1000) : 0

  setInterval(() => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const key = `${now.toISOString().slice(0, 10)}-${CONFIG.restart}`

    if (`${hh}:${mm}` === CONFIG.restart && state.lastRestartKey !== key) {
      state.lastRestartKey = key
      setTimeout(() => {
        if (CONFIG.restartMode === 'reload') location.reload()
      }, jitterMs)
    }
  }, 15000)
}

function setupDebugToggle() {
  if (CONFIG.debug) els.debugPanel.hidden = false

  document.body.addEventListener('click', () => {
    state.clickCount += 1
    clearTimeout(state.clickTimer)
    state.clickTimer = setTimeout(() => { state.clickCount = 0 }, 1300)
    if (state.clickCount >= 5) {
      els.debugPanel.hidden = !els.debugPanel.hidden
      state.clickCount = 0
    }
  })

  els.reloadBtn.addEventListener('click', () => location.reload())
  els.syncBtn.addEventListener('click', () => syncConfig('manual'))
  els.clearCacheBtn.addEventListener('click', () => clearMediaCache())
}

async function boot() {
  await registerServiceWorker()
  setupDebugToggle()
  setupDailyRestart()
  await updateCacheStatus()

  if (loadSavedBundle()) {
    startPlayback('left')
    window.setTimeout(() => startPlayback('right'), 500)
    setStatus('저장된 캐시 재생 시작')
  }

  await syncConfig('startup')
  await sendHeartbeat()

  setInterval(() => syncConfig('hourly'), CONFIG.refreshMs)
  setInterval(sendHeartbeat, CONFIG.heartbeatMs)
  setInterval(updateDebug, 2000)
}

window.addEventListener('error', (event) => setStatus(`오류: ${event.message}`))
window.addEventListener('unhandledrejection', (event) => setStatus(`오류: ${event.reason?.message || event.reason}`))

boot()
