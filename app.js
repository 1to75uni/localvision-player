const params = new URLSearchParams(location.search)

const CONFIG = {
  store: params.get('store') || 'goobne',
  deviceId: params.get('deviceId') || '',
  apiBase: (params.get('apiBase') || 'https://localvision-cms.pages.dev').replace(/\/$/, ''),
  refreshMs: Number(params.get('refresh') || 60000),
  heartbeatMs: Number(params.get('heartbeat') || 30000),
  restart: params.get('restart') || '',
  restartMode: params.get('restartMode') || 'reload',
  fit: params.get('fit') || 'cover',
  debug: params.get('debug') === '1',
}

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
  lastCommandAt: '',
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
  dbgStore: document.getElementById('dbgStore'),
  dbgDevice: document.getElementById('dbgDevice'),
  dbgApi: document.getElementById('dbgApi'),
  dbgLeft: document.getElementById('dbgLeft'),
  dbgRight: document.getElementById('dbgRight'),
  dbgSync: document.getElementById('dbgSync'),
  dbgHeartbeat: document.getElementById('dbgHeartbeat'),
  dbgStatus: document.getElementById('dbgStatus'),
}

const handledCommandKey = `lv-handled-command-${CONFIG.deviceId || CONFIG.store}`

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
    }))
}

function guessType(value) {
  const lower = String(value).toLowerCase()
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) return 'video'
  return 'image'
}

function samePlaylist(a, b) {
  return JSON.stringify(a.map(lightItem)) === JSON.stringify(b.map(lightItem))
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

async function syncConfig() {
  try {
    setStatus('CMS 데이터 동기화 중...')
    const data = await fetchPlayerConfig()

    const nextLeft = normalizeItems(data.playlists?.left)
    const nextRight = normalizeItems(data.playlists?.right)

    const leftChanged = !samePlaylist(state.leftItems, nextLeft)
    const rightChanged = !samePlaylist(state.rightItems, nextRight)

    state.leftItems = nextLeft
    state.rightItems = nextRight
    state.lastSync = new Date().toLocaleString('ko-KR')

    handleRemoteCommand(data.devices || [])

    if (leftChanged) {
      state.leftIndex = 0
      startPlayback('left')
    }

    if (rightChanged) {
      state.rightIndex = 0
      startPlayback('right')
    }

    if (!leftChanged && !state.leftTimer) startPlayback('left')
    if (!rightChanged && !state.rightTimer) startPlayback('right')

    setStatus('CMS 데이터 동기화 완료')
    updateDebug()
  } catch (error) {
    console.error(error)
    setStatus(`동기화 실패: ${error.message}`)
    updateDebug()
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

function startPlayback(side) {
  clearSideTimer(side)

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

function playItem(side, item) {
  const zone = getZone(side)

  if (!item?.url) {
    zone.innerHTML = emptyMarkup(side)
    scheduleNext(side, item?.duration || 10)
    return
  }

  if (item.type === 'video') {
    playVideo(side, item)
  } else {
    playImage(side, item)
  }
}

function applyFit(element) {
  element.className = `media fade-in ${CONFIG.fit === 'contain' ? 'contain' : ''}`
}

function playImage(side, item) {
  const zone = getZone(side)
  const img = document.createElement('img')
  applyFit(img)
  img.src = item.url
  img.alt = item.title || 'LocalVision image'

  img.onload = () => {
    zone.replaceChildren(img)
    scheduleNext(side, item.duration || 10)
  }

  img.onerror = () => {
    console.warn('Image load failed:', item.url)
    zone.innerHTML = emptyMarkup(side)
    scheduleNext(side, 5)
  }
}

function playVideo(side, item) {
  const zone = getZone(side)
  const video = document.createElement('video')

  applyFit(video)
  video.src = item.url
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
    console.warn('Video load failed:', item.url)
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

  setInterval(() => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const key = `${now.toISOString().slice(0, 10)}-${CONFIG.restart}`

    if (`${hh}:${mm}` === CONFIG.restart && state.lastRestartKey !== key) {
      state.lastRestartKey = key
      if (CONFIG.restartMode === 'reload') {
        location.reload()
      }
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
}

window.addEventListener('error', (event) => {
  setStatus(`오류: ${event.message}`)
})

window.addEventListener('unhandledrejection', (event) => {
  setStatus(`오류: ${event.reason?.message || event.reason}`)
})

setupDebugToggle()
setupDailyRestart()
updateDebug()
syncConfig()
sendHeartbeat()

setInterval(syncConfig, CONFIG.refreshMs)
setInterval(sendHeartbeat, CONFIG.heartbeatMs)
