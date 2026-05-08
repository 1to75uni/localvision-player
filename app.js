const params = new URLSearchParams(location.search)

const LAST_GOOD_STORE_KEY = 'lv-last-good-store'
const LAST_GOOD_API_BASE_KEY = 'lv-last-good-api-base'
const rawStore = String(params.get('store') || '').trim()
const rawApiBase = String(params.get('apiBase') || '').trim().replace(/\/$/, '')
const lastGoodStore = String(localStorage.getItem(LAST_GOOD_STORE_KEY) || '').trim()
const lastGoodApiBase = String(localStorage.getItem(LAST_GOOD_API_BASE_KEY) || '').trim().replace(/\/$/, '')

const CONFIG = {
  store: rawStore || lastGoodStore,
  appId: params.get('id') || params.get('appId') || '',
  deviceId: params.get('deviceId') || '',
  apiBase: rawApiBase || lastGoodApiBase,
  refreshMs: Number(params.get('refresh') || 900000),
  heartbeatMs: Number(params.get('heartbeat') || 300000),
  commandPollMs: Number(params.get('commandPoll') || params.get('commandPollMs') || 300000),
  appConfigPollMs: Number(params.get('appConfigPoll') || params.get('configPoll') || 1800000),
  noticePollMs: Number(params.get('noticePoll') || params.get('noticePollMs') || 60000),
  playerStatePollMs: Number(params.get('playerStatePoll') || params.get('statePoll') || params.get('contentCheck') || 900000),
  cacheMax: Number(params.get('cacheMax') || 20),
  restart: params.get('restart') || '',
  restartMode: params.get('restartMode') || 'reload',
  restartJitterSec: Number(params.get('restartJitterSec') || 0),
  fit: params.get('fit') || 'cover',
  videoMode: params.get('videoMode') || 'cache',
  bundleMode: params.get('bundleMode') || 'cache',
  cacheVia: params.get('cacheVia') || 'api',
  cacheAll: params.get('cacheAll') !== '0',
  activateWhenCached: params.get('activateWhenCached') !== '0',
  debug: params.get('debug') === '1',
  appShell: params.get('appShell') === '1' || params.get('native') === '1' || params.get('appCore') === '1',
  appVersion: params.get('appVersion') || '',
}


function kstString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = String(kst.getUTCFullYear()).padStart(4, '0')
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mi = String(kst.getUTCMinutes()).padStart(2, '0')
  const ss = String(kst.getUTCSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function nowUtcIso() {
  return new Date().toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const MEDIA_CACHE = 'lv-media-bundle-v1-7-1'
const META_KEY = 'lv-media-bundle-meta-v1-7-1'
const PLAYLIST_KEY = `lv-playlist-bundle-v1-7-1-${CONFIG.store || CONFIG.appId}`
const handledCommandKey = `lv-handled-command-${CONFIG.deviceId || CONFIG.store || 'unknown'}`
const bootIssues = []
if (!rawStore) {
  if (lastGoodStore) {
    bootIssues.push({ level: 'warning', code: 'LV-STORE-RECOVERED', message: `URL에 store가 없어 마지막 정상 매장 코드(${lastGoodStore})로 복구했습니다.` })
  } else if (CONFIG.appId) {
    bootIssues.push({ level: 'warning', code: 'LV-STORE-FROM-APP-ID', message: `URL에 store가 없어 app-config(${CONFIG.appId})에서 최신 Player URL을 확인합니다.` })
  } else {
    bootIssues.push({ level: 'fatal', code: 'LV-STORE-MISSING', title: '매장 코드가 없습니다.', message: 'CMS에서 복사한 TV용 URL에 store=매장코드를 포함해 주세요.' })
  }
}
if (!rawApiBase) {
  if (lastGoodApiBase) {
    bootIssues.push({ level: 'warning', code: 'LV-API-RECOVERED', message: `URL에 apiBase가 없어 마지막 정상 CMS 주소로 복구했습니다.` })
  } else {
    bootIssues.push({ level: 'fatal', code: 'LV-API-MISSING', title: 'CMS 주소가 없습니다.', message: 'CMS에서 복사한 TV용 URL에 apiBase=CMS주소를 포함해 주세요.' })
  }
}
let statusHideTimer = null

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
  errorReportTimes: {},
  activeNoticeId: '',
  noticeVisible: false,
  noticeTimer: null,
  noticeErrorIds: {},
  playbackFailureCount: 0,
  lastPlaybackFailureAt: 0,
  recoveryReloadPending: false,
  intervalsStarted: false,
  mediaFailures: {},
  sessionBlacklist: {},
}


const RECOVERY_KEY = `lv-player-recovery-${CONFIG.store || CONFIG.appId || 'unknown'}`

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

function showStatusTemporarily(ms = 5000) {
  if (!els.statusPill) return
  els.statusPill.classList.remove('is-hidden')
  if (statusHideTimer) clearTimeout(statusHideTimer)
  statusHideTimer = setTimeout(() => {
    els.statusPill.classList.add('is-hidden')
  }, ms)
}

function setStatus(message) {
  if (els.statusPill) els.statusPill.textContent = message
  if (els.dbgStatus) els.dbgStatus.textContent = message
  showStatusTemporarily(5000)
}

function createPlayerError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function shouldReportError(key, minMs = 60000) {
  const now = Date.now()
  const last = state.errorReportTimes[key] || 0
  if (now - last < minMs) return false
  state.errorReportTimes[key] = now
  return true
}

async function reportPlayerError(errorCode, message, extra = {}, level = 'error') {
  if (!CONFIG.apiBase) return
  const key = `${errorCode}:${extra.side || ''}:${extra.fileName || extra.cacheUrl || extra.sourceUrl || extra.url || ''}:${message}`
  if (!shouldReportError(key)) return

  const timeUtc = nowUtcIso()
  const timeKst = kstString(timeUtc)

  try {
    await fetch(`${CONFIG.apiBase}/api/player-errors`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        store: CONFIG.store || rawStore || lastGoodStore || '',
        deviceId: CONFIG.deviceId || '',
        errorCode,
        message,
        level,
        time: timeUtc,
        timeUtc,
        timeKst,
        href: location.href,
        userAgent: navigator.userAgent,
        extra: {
          ...extra,
          timeUtc,
          timeKst,
          apiBase: CONFIG.apiBase,
          playerVersion: 'v1.7.1-api-diet',
        },
      }),
    })
  } catch (error) {}
}


function readRecoveryMeta() {
  try { return JSON.parse(localStorage.getItem(RECOVERY_KEY) || '{}') } catch { return {} }
}

function writeRecoveryMeta(meta) {
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify(meta || {})) } catch {}
}

async function requestRecoveryReload(errorCode, message, extra = {}) {
  if (state.recoveryReloadPending) return true
  const now = Date.now()
  const cooldownMs = 5 * 60 * 1000
  const windowMs = 60 * 60 * 1000
  const maxReloadsPerHour = 3
  const meta = readRecoveryMeta()
  const reloads = Array.isArray(meta.reloads) ? meta.reloads.filter((ts) => now - Number(ts) < windowMs) : []
  const lastReloadAt = Number(meta.lastReloadAt || 0)

  if (lastReloadAt && now - lastReloadAt < cooldownMs) {
    await reportPlayerError('LV-RECOVERY-COOLDOWN', '자동 복구 새로고침 쿨다운 중이라 다음 콘텐츠로 이동합니다.', { errorCode, message, ...extra }, 'warning')
    return false
  }

  if (reloads.length >= maxReloadsPerHour) {
    const detail = `store=${CONFIG.store || '-'}\nerror=${errorCode}\n최근 1시간 reload=${reloads.length}회\n한국시간=${kstString()}`
    showErrorScreen({
      title: '자동 복구 새로고침 횟수 제한',
      message: '1시간 내 Player 새로고침이 3회 이상 발생하여 무한 새로고침을 멈췄습니다. CMS에서 문제 콘텐츠와 네트워크 상태를 확인해 주세요.',
      errorCode: 'LV-RECOVERY-LIMIT',
      detail,
    })
    await reportPlayerError('LV-RECOVERY-LIMIT', '자동 복구 새로고침 횟수 제한에 도달하여 fallback 화면을 유지합니다.', { errorCode, message, reloads, ...extra }, 'fatal')
    return true
  }

  reloads.push(now)
  writeRecoveryMeta({ lastReloadAt: now, reloads })
  state.recoveryReloadPending = true
  setStatus(`오류 2회 누적: Player 자동 새로고침 (${errorCode})`)
  await reportPlayerError('LV-AUTO-RECOVERY-RELOAD', '콘텐츠 오류 2회 누적으로 Player를 자동 새로고침합니다.', { errorCode, message, ...extra }, 'warning')
  window.setTimeout(() => location.reload(), 800)
  return true
}

async function handlePlaybackFailure(side, item, errorCode, message, extra = {}) {
  const payload = { side, itemId: item?.id, title: item?.title, url: item?.url, fileName: item?.fileName, ...extra }
  await reportPlayerError(errorCode, message, payload, 'error')

  const key = mediaKeyOf(item)
  const count = key ? Number(state.mediaFailures[key] || 0) + 1 : 1
  if (key) state.mediaFailures[key] = count

  const msg = String(message || '')
  const isPowerPause = msg.includes('paused to save power') || msg.includes('interrupted') || msg.includes('play() request')

  if (count === 1) {
    if (!isPowerPause) await deleteMediaCacheForItem(item)
    setStatus(`${errorCode}: ${side} 재시도 1회 (${item?.fileName || item?.title || ''})`)
    setSideTimer(side, () => playItem(side, item), isPowerPause ? 1200 : 800)
    return
  }

  if (key) state.sessionBlacklist[key] = Date.now()
  setStatus(`${errorCode}: ${side} 콘텐츠 임시 제외 후 다음 재생`)
  await reportPlayerError('LV-MEDIA-SESSION-SKIP', '반복 실패 콘텐츠를 이번 세션에서 임시 제외했습니다.', { ...payload, failCount: count, blacklisted: true }, 'warning')
  scheduleNext(side, 2)
}

function markPlaybackSuccess() {
  state.playbackFailureCount = 0
  state.lastPlaybackFailureAt = 0
}

function showErrorScreen({ title = 'LocalVision 오류', message = '플레이어 실행 중 문제가 발생했습니다.', errorCode = 'LV-UNKNOWN', detail = '' }) {
  let overlay = document.getElementById('playerErrorOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'playerErrorOverlay'
    document.body.appendChild(overlay)
  }

  overlay.innerHTML = `
    <div class="player-error-card">
      <p class="player-error-kicker">LocalVision 오류</p>
      <h1>${title}</h1>
      <p>${message}</p>
      ${detail ? `<pre>${detail}</pre>` : ''}
      <strong>오류코드: ${errorCode}</strong>
      <span>점주님은 위 오류코드를 관리자에게 알려주세요.</span>
    </div>
  `
  overlay.hidden = false
  setStatus(`${errorCode} · ${message}`)
}

function hideErrorScreen() {
  const overlay = document.getElementById('playerErrorOverlay')
  if (overlay) overlay.hidden = true
}

function markGoodConfig() {
  if (CONFIG.store) localStorage.setItem(LAST_GOOD_STORE_KEY, CONFIG.store)
  if (CONFIG.apiBase) localStorage.setItem(LAST_GOOD_API_BASE_KEY, CONFIG.apiBase)
}

function updateDebug() {
  els.dbgStore.textContent = CONFIG.store || CONFIG.appId || '-' 
  els.dbgDevice.textContent = CONFIG.deviceId || `store:${CONFIG.store}` || '미지정'
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
  const attempts = Number(options.attempts || 3)
  const delays = [0, 3000, 10000]
  let lastError = null
  const cleanOptions = { ...options }
  delete cleanOptions.attempts

  for (let i = 0; i < attempts; i += 1) {
    if (delays[i]) await sleep(delays[i])
    try {
      // CORS 안정성: API fetch에는 cache-control/pragma 같은 요청 헤더를 직접 붙이지 않습니다.
      // cache: 'no-store' 옵션과 URL의 t/_lvts 캐시버스터만 사용합니다.
      const response = await fetch(url, {
        cache: 'no-store',
        ...cleanOptions,
        headers: { ...(cleanOptions.headers || {}) },
      })
      const text = await response.text().catch(() => '')
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch (_) {
        data = { ok: false, error: text.slice(0, 300) || 'Non-JSON response' }
      }
      if (!response.ok || data.ok === false) {
        const err = createPlayerError(data.errorCode || 'LV-API-DOWN', data.error || `HTTP ${response.status}`)
        err.status = response.status
        err.endpoint = (() => { try { return new URL(url).pathname } catch (_) { return '' } })()
        err.url = url
        err.responseBody = text.slice(0, 500)
        throw err
      }
      return data
    } catch (error) {
      if (!error.url) error.url = url
      if (!error.endpoint) { try { error.endpoint = new URL(url).pathname } catch (_) {} }
      lastError = error
      // POST/PATCH도 1회 이상은 재시도하지만, 긴 반복은 하지 않습니다.
    }
  }
  throw lastError || new Error('fetch failed')
}


async function fetchAppConfig() {
  if (!CONFIG.apiBase || !CONFIG.appId) return null
  return fetchJson(`${CONFIG.apiBase}/api/app-config?id=${encodeURIComponent(CONFIG.appId)}&t=${Date.now()}`)
}

function comparableUrl(value) {
  try {
    const url = new URL(value, location.href)
    url.hash = ''
    for (const key of ['t', 'nativeReload', 'appShell', 'appVersion', 'native', 'appCore']) url.searchParams.delete(key)
    return url.toString()
  } catch {
    return String(value || '').trim()
  }
}

async function checkAppConfig(reason = 'poll') {
  if (!CONFIG.apiBase || !CONFIG.appId) return false
  try {
    const data = await fetchAppConfig()
    if (!data?.playerUrl) return false
    if (data.active === false) {
      showErrorScreen({
        title: '이 TV는 CMS에서 비활성 상태입니다.',
        message: 'CMS의 업체 ID 상태를 사용중/운영중으로 변경하면 다시 재생됩니다.',
        errorCode: 'LV-APP-ID-INACTIVE',
        detail: `id=${CONFIG.appId}`,
      })
      return true
    }
    const nextUrl = comparableUrl(data.playerUrl)
    const currentUrl = comparableUrl(location.href)
    if (nextUrl && nextUrl !== currentUrl) {
      setStatus(`app-config URL 변경 감지: ${CONFIG.appId}`)
      await reportPlayerError('LV-APP-CONFIG-URL-CHANGE', 'CMS app-config의 Player URL 변경을 감지해 이동합니다.', { reason, appId: CONFIG.appId, nextUrl: data.playerUrl }, 'warning')
      window.setTimeout(() => location.replace(data.playerUrl), 300)
      return true
    }
  } catch (error) {
    await reportPlayerError('LV-APP-CONFIG-FAILED', error?.message || 'app-config 확인 실패', { reason, appId: CONFIG.appId }, 'warning')
  }
  return false
}

function playerQuery(extra = {}) {
  const qs = new URLSearchParams({ store: CONFIG.store, t: String(Date.now()), ...extra })
  if (CONFIG.appId) qs.set('id', CONFIG.appId)
  return qs
}

async function fetchPlayerState(reason = 'poll') {
  if (!CONFIG.apiBase || !CONFIG.store) throw new Error('apiBase/store missing')
  const qs = playerQuery({ reason })
  try {
    return await fetchJson(`${CONFIG.apiBase}/api/player-state?${qs.toString()}`)
  } catch (error) {
    // 이전 CMS와의 호환을 위해 player-state가 없으면 기존 player-config로 fallback합니다.
    const fallback = await fetchJson(`${CONFIG.apiBase}/api/player-config?store=${encodeURIComponent(CONFIG.store)}&t=${Date.now()}`)
    fallback.endpoint = '/api/player-config-fallback'
    return fallback
  }
}

async function fetchLiteEndpoint(path, reason = 'poll') {
  if (!CONFIG.apiBase || !CONFIG.store) throw new Error('apiBase/store missing')
  const qs = playerQuery({ reason })
  return fetchJson(`${CONFIG.apiBase}${path}?${qs.toString()}`, { attempts: 2 })
}

async function fetchPlayerConfig() {
  return fetchPlayerState('compat')
}


function extractPlaylistItems(snapshot, side) {
  if (!snapshot) return []
  if (Array.isArray(snapshot?.playlists?.[side])) return snapshot.playlists[side]
  if (Array.isArray(snapshot?.items) && (snapshot.side === side || !snapshot.side)) return snapshot.items
  if (Array.isArray(snapshot?.[side])) return snapshot[side]
  return []
}

async function fetchSnapshot(url, label = 'snapshot') {
  if (!url) return null
  try {
    return await fetchJson(`${url}${url.includes('?') ? '&' : '?'}_lvts=${Date.now()}`, { attempts: 2 })
  } catch (error) {
    await reportPlayerError('LV-SNAPSHOT-FETCH-FAILED', error?.message || 'playlist snapshot fetch failed', { label, url }, 'warning')
    return null
  }
}

async function resolvePlaylistsFromConfig(data) {
  let left = Array.isArray(data?.playlists?.left) ? data.playlists.left : []
  let right = Array.isArray(data?.playlists?.right) ? data.playlists.right : []

  const urls = data?.playlistUrls || {}
  const bundleUrl = data?.playlistUrl || urls.bundle || ''

  // snapshot URL이 있으면 이것을 우선 사용합니다. 단, 실패하면 API payload의 playlists로 fallback합니다.
  const bundle = await fetchSnapshot(bundleUrl, 'bundle')
  if (bundle) {
    const bLeft = extractPlaylistItems(bundle, 'left')
    const bRight = extractPlaylistItems(bundle, 'right')
    if (bLeft.length) left = bLeft
    if (bRight.length) right = bRight
  }

  // 공통 right는 여러 매장이 공유하므로 bundle이 있어도 별도 right snapshot이 있으면 우선 적용합니다.
  // left도 별도 snapshot이 있으면 적용합니다. 둘 중 하나가 실패해도 API payload/bundle로 fallback합니다.
  if (urls.left || urls.right) {
    const [leftDoc, rightDoc] = await Promise.all([
      urls.left ? fetchSnapshot(urls.left, 'left') : Promise.resolve(null),
      urls.right ? fetchSnapshot(urls.right, 'right') : Promise.resolve(null),
    ])
    const sLeft = extractPlaylistItems(leftDoc, 'left')
    const sRight = extractPlaylistItems(rightDoc, 'right')
    if (sLeft.length) left = sLeft
    if (sRight.length) right = sRight
  }

  return { left, right }
}

function mediaKeyOf(item = {}) {
  return String(item.cacheKey || item.cacheUrl || item.sourceUrl || item.url || item.fileName || item.id || '')
}

function isBlacklisted(item = {}) {
  const key = mediaKeyOf(item)
  return Boolean(key && state.sessionBlacklist[key])
}

async function deleteMediaCacheForItem(item = {}) {
  try {
    const key = item.cacheUrl || item.cacheKey || item.url
    if (!key) return false
    const cache = await getMediaCache()
    await cache.delete(key)
    const meta = loadMeta()
    delete meta[key]
    saveMeta(meta)
    await updateCacheStatus()
    return true
  } catch { return false }
}

function guessType(value) {
  const lower = String(value || '').toLowerCase()
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.includes('.mp4?')) return 'video'
  return 'image'
}


function makeMediaFetchUrl(rawUrl) {
  if (!rawUrl) return ''
  if (CONFIG.cacheVia === 'direct') return rawUrl

  try {
    const url = new URL(rawUrl)

    // 이미 CMS media API면 그대로 사용
    if (url.pathname.includes('/api/media')) {
      return rawUrl
    }

    // R2 public URL 안의 stores/... 또는 system/... key만 뽑아서 CMS 프록시로 가져옴
    const markers = ['/stores/', '/system/']
    for (const marker of markers) {
      const idx = url.pathname.indexOf(marker)
      if (idx >= 0) {
        const key = url.pathname.slice(idx + 1)
        return `${CONFIG.apiBase}/api/media?key=${encodeURIComponent(key)}`
      }
    }

    return rawUrl
  } catch {
    return rawUrl
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => item && item.status === '사용중')
    .map((item) => ({
      ...item,
      duration: Number(item.duration || 20),
      sourceUrl: item.url || '',
      url: item.url || '',
      cacheUrl: makeMediaFetchUrl(item.url || ''),
      type: item.type || guessType(item.url || item.fileName || ''),
      cacheKey: makeMediaFetchUrl(item.url || ''),
    }))
    .filter((item) => item.url)
}

function lightItems(items) {
  return items.map((item) => ({
    id: item.id,
    url: item.url,
    cacheUrl: item.cacheUrl,
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
  const fetchUrl = item?.cacheUrl || item?.url
  if (!fetchUrl) return false

  const cache = await getMediaCache()
  const hit = await cache.match(fetchUrl)
  if (hit) {
    touchMeta(fetchUrl, { type: item.type, side: item.side, sourceUrl: item.url })
    return true
  }

  state.bundleStatus = `다운로드 ${index}/${total}`
  setStatus(`미디어 다운로드중 ${index}/${total}`)
  updateDebug()

  let response
  try {
    response = await fetch(fetchUrl, { cache: 'no-store' })
  } catch (error) {
    throw new Error(`media fetch failed: ${item.title || item.url || fetchUrl}`)
  }

  if (!response.ok) throw new Error(`media ${response.status}: ${item.title || item.url || fetchUrl}`)

  await cache.put(fetchUrl, response.clone())
  touchMeta(fetchUrl, { type: item.type, side: item.side, sourceUrl: item.url })
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
    const key = item.cacheUrl || item.url
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(item)
    }
  }

  if (!unique.length) return true

  for (let i = 0; i < unique.length; i += 1) {
    await ensureCached(unique[i], i + 1, unique.length)
  }

  await pruneCache(unique.map((item) => item.cacheUrl || item.url))
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

function removeLocalStorageByPrefix(prefix) {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => localStorage.removeItem(key))
  } catch (error) {}
}

async function clearPlaybackCaches() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('lv-media-bundle-'))
          .map((key) => caches.delete(key))
      )
    }
  } catch (error) {}

  try {
    removeLocalStorageByPrefix('lv-media-bundle-meta-')
    removeLocalStorageByPrefix('lv-playlist-bundle-')
    localStorage.removeItem(META_KEY)
    localStorage.removeItem(PLAYLIST_KEY)
  } catch (error) {}

  state.cacheStatus = 'cleared'
  state.bundleStatus = 'cleared'
  updateDebug()
}

async function hardRefreshFromCms(commandName = 'refresh') {
  setStatus(commandName === 'refresh'
    ? 'CMS 새로고침 명령 수신: 캐시 삭제 후 재시작'
    : `CMS ${commandName} 명령 수신: 캐시 삭제 후 재시작`
  )

  await clearPlaybackCaches()

  window.setTimeout(() => {
    location.reload()
  }, 300)
}

async function clearMediaCache() {
  await clearPlaybackCaches()
  setStatus('미디어 캐시를 삭제했습니다')
}

async function getCachedBlobUrl(item) {
  const fetchUrl = item.cacheUrl || item.url
  const cache = await getMediaCache()
  let response = await cache.match(fetchUrl)

  if (!response) {
    if (!navigator.onLine) throw new Error('offline cache miss')
    await ensureCached(item, 1, 1)
    response = await cache.match(fetchUrl)
  }

  if (!response) throw new Error('cache miss')

  touchMeta(fetchUrl, { type: item.type, sourceUrl: item.url })
  const blob = await response.clone().blob()
  return URL.createObjectURL(blob)
}


function normalizeNotice(notice) {
  if (!notice || !notice.id) return null
  const type = notice.type || guessType(notice.mediaUrl || notice.url || notice.fileName || '')
  return {
    ...notice,
    type,
    mediaUrl: notice.mediaUrl || notice.url || '',
    linkUrl: notice.linkUrl || '',
    durationSec: Math.max(5, Number(notice.durationSec || notice.duration || 15)),
    priority: notice.priority || 'normal',
    repeatMode: notice.repeatMode || 'once',
  }
}

async function fetchActiveNotice() {
  if (!CONFIG.apiBase || !CONFIG.store) return null
  try {
    const data = await fetchLiteEndpoint('/api/notice-active', 'notice')
    return normalizeNotice(data.notice || data.activeNotice || data.active || (Array.isArray(data.notices) ? data.notices[0] : null))
  } catch (error) {
    // 새 경량 API가 아직 배포 전이면 기존 player-state로 호환합니다.
    const data = await fetchPlayerState('notice-fallback')
    return normalizeNotice(data.notice || data.activeNotice || data.active || (Array.isArray(data.notices) ? data.notices[0] : null))
  }
}


function getNoticeKey(notice) {
  if (!notice || !notice.id) return ''
  const revision = notice.revision || notice.updatedAt || notice.mediaUrl || notice.linkUrl || notice.title || 'v1'
  return `${notice.id}:${revision}`
}

function getSeenNoticeStorageKey(noticeKey) {
  const safeStore = String(CONFIG.store || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeKey = String(noticeKey || '').replace(/[^a-zA-Z0-9_.:-]/g, '_')
  return `lv_seen_notice_${safeStore}_${safeKey}`
}

function hasSeenNotice(noticeKey) {
  if (!noticeKey) return false
  try { return localStorage.getItem(getSeenNoticeStorageKey(noticeKey)) === '1' } catch { return false }
}

function markNoticeSeen(noticeKey) {
  if (!noticeKey) return
  try { localStorage.setItem(getSeenNoticeStorageKey(noticeKey), '1') } catch {}
}

function getNoticeOverlay() {
  let overlay = document.getElementById('noticeOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'noticeOverlay'
    document.body.appendChild(overlay)
  }
  return overlay
}

function hideNoticeOverlay() {
  if (state.noticeTimer) clearTimeout(state.noticeTimer)
  state.noticeTimer = null
  const overlay = document.getElementById('noticeOverlay')
  if (overlay) {
    overlay.classList.remove('is-active')
    overlay.innerHTML = ''
  }
  state.noticeVisible = false
  state.activeNoticeId = ''
  setMainPlaybackPaused(false)
}

function noticeTextMarkup(notice) {
  const hasLink = notice.linkUrl || (notice.type === 'link' && notice.mediaUrl)
  const link = notice.linkUrl || (notice.type === 'link' ? notice.mediaUrl : '')
  const qr = link ? `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(link)}` : ''
  return `
    <div class="notice-stage">
      <div class="notice-badge">LocalVision 공지 송출중</div>
      <div class="notice-text-card fade-in">
        <p class="notice-kicker">FULLSCREEN NOTICE</p>
        <h1>${escapeHtml(notice.title || 'LocalVision 공지')}</h1>
        ${notice.message ? `<p>${escapeHtml(notice.message)}</p>` : ''}
        ${link ? `<div class="notice-link-block"><img src="${qr}" alt="공지 QR" onerror="this.style.display='none'"/><code>${escapeHtml(link)}</code></div>` : ''}
      </div>
    </div>`
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getKstDateKey(value = new Date()) {
  return kstString(value).slice(0, 10)
}

function getNoticeRepeatMode(notice = {}) {
  if (notice.priority === 'urgent' && !notice.repeatMode) return 'always'
  return String(notice.repeatMode || 'once').toLowerCase()
}

function getNoticeSeenValue(noticeKey) {
  try { return localStorage.getItem(getSeenNoticeStorageKey(noticeKey)) || '' } catch { return '' }
}

function shouldShowNoticeNow(notice, noticeKey, reason = 'poll') {
  if (!noticeKey) return false
  const mode = getNoticeRepeatMode(notice)
  if (mode === 'always') return true
  if (mode === 'command') return reason === 'remote-command' || reason === 'startup'
  const seen = getNoticeSeenValue(noticeKey)
  if (mode === 'daily') return seen !== getKstDateKey()
  if (mode === 'interval') {
    const last = Number(seen || 0)
    const intervalMin = Math.max(1, Number(notice.repeatIntervalMin || notice.intervalMin || 30))
    return !last || Date.now() - last >= intervalMin * 60 * 1000
  }
  return seen !== '1'
}

function markNoticeShown(notice, noticeKey) {
  if (!noticeKey) return
  const mode = getNoticeRepeatMode(notice)
  try {
    if (mode === 'always') return
    if (mode === 'daily') localStorage.setItem(getSeenNoticeStorageKey(noticeKey), getKstDateKey())
    else if (mode === 'interval') localStorage.setItem(getSeenNoticeStorageKey(noticeKey), String(Date.now()))
    else localStorage.setItem(getSeenNoticeStorageKey(noticeKey), '1')
  } catch {}
}

function setMainPlaybackPaused(paused) {
  for (const side of ['left', 'right']) {
    const zone = getZone(side)
    if (!zone) continue
    zone.querySelectorAll('video').forEach((video) => {
      try {
        if (paused) video.pause()
        else video.play().catch(() => {})
      } catch {}
    })
  }
}

async function showNoticeOverlay(notice, reason = 'poll') {
  if (!notice) return hideNoticeOverlay()
  const noticeKey = getNoticeKey(notice)
  const isSame = state.activeNoticeId === noticeKey && state.noticeVisible
  if (isSame) return

  if (!shouldShowNoticeNow(notice, noticeKey, reason)) {
    if (state.noticeVisible) hideNoticeOverlay()
    return
  }

  const overlay = getNoticeOverlay()
  if (state.noticeTimer) clearTimeout(state.noticeTimer)
  state.activeNoticeId = noticeKey
  state.noticeVisible = true
  markNoticeShown(notice, noticeKey)
  setMainPlaybackPaused(true)
  setStatus(`공지 송출중: ${notice.title || notice.id}`)

  if (notice.type === 'image') {
    const item = { ...notice, url: notice.mediaUrl, cacheUrl: makeMediaFetchUrl(notice.mediaUrl), type: 'image', title: notice.title }
    try {
      const src = await getCachedBlobUrl(item)
      overlay.innerHTML = `<div class="notice-stage"><div class="notice-badge">LocalVision 공지 송출중</div><img class="notice-media ${CONFIG.fit === 'contain' ? 'contain' : ''} fade-in" src="${src}" alt="${escapeHtml(notice.title)}" /></div>`
      overlay.classList.add('is-active')
    } catch (error) {
      const key = `notice-image:${notice.id}`
      if (!state.noticeErrorIds[key]) {
        state.noticeErrorIds[key] = true
        reportPlayerError('LV-NOTICE-MEDIA-MISSING', error?.message || '공지 이미지를 불러오지 못했습니다.', { noticeId: notice.id, title: notice.title, mediaUrl: notice.mediaUrl }, 'error')
      }
      hideNoticeOverlay()
      return
    }
  } else if (notice.type === 'video') {
    const item = { ...notice, url: notice.mediaUrl, cacheUrl: makeMediaFetchUrl(notice.mediaUrl), type: 'video', title: notice.title }
    try {
      const src = await getCachedBlobUrl(item)
      overlay.innerHTML = `<div class="notice-stage"><div class="notice-badge">LocalVision 공지 송출중</div></div>`
      const stage = overlay.querySelector('.notice-stage')
      const video = document.createElement('video')
      video.className = `notice-media ${CONFIG.fit === 'contain' ? 'contain' : ''} fade-in`
      video.src = src
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.controls = false
      video.preload = 'auto'
      video.onended = () => {
        if (notice.priority === 'urgent' || getNoticeRepeatMode(notice) === 'always') {
          try { video.currentTime = 0; video.play().catch(() => {}) } catch {}
        } else {
          hideNoticeOverlay()
        }
      }
      video.onerror = () => {
        reportPlayerError('LV-NOTICE-PLAY-FAIL', '공지 영상 재생에 실패했습니다.', { noticeId: notice.id, title: notice.title, mediaUrl: notice.mediaUrl }, 'error')
        hideNoticeOverlay()
      }
      stage.appendChild(video)
      overlay.classList.add('is-active')
      setTimeout(() => video.play().catch((error) => {
        reportPlayerError('LV-NOTICE-PLAY-FAIL', error?.message || '공지 영상 자동재생에 실패했습니다.', { noticeId: notice.id, title: notice.title }, 'error')
        hideNoticeOverlay()
      }), 100)
    } catch (error) {
      reportPlayerError('LV-NOTICE-MEDIA-MISSING', error?.message || '공지 영상을 불러오지 못했습니다.', { noticeId: notice.id, title: notice.title, mediaUrl: notice.mediaUrl }, 'error')
      hideNoticeOverlay()
      return
    }
  } else {
    overlay.innerHTML = noticeTextMarkup(notice)
    overlay.classList.add('is-active')
  }

  if (notice.priority !== 'urgent' && getNoticeRepeatMode(notice) !== 'always') {
    state.noticeTimer = setTimeout(() => {
      // 같은 noticeKey는 이미 표시 시작 시점에 저장했으므로 다음 폴링에서 다시 열리지 않습니다.
      hideNoticeOverlay()
    }, notice.durationSec * 1000)
  }
}

async function checkNotice(reason = 'poll') {
  if (!CONFIG.apiBase || !CONFIG.store) return
  try {
    const notice = await fetchActiveNotice()
    if (notice) await showNoticeOverlay(notice, reason)
    else if (state.noticeVisible) hideNoticeOverlay()
  } catch (error) {
    reportPlayerError('LV-NOTICE-API-DOWN', error?.message || '공지 API 확인 실패', { reason }, 'warning')
  }
}

async function syncConfig(reason = 'scheduled') {
  if (state.isSyncing) return
  state.isSyncing = true

  try {
    setStatus('CMS 재생목록 확인중...')
    const data = await fetchPlayerState(reason)

    const commandHandled = await handleRemoteCommand(data.devices || [], data.command)
    if (commandHandled) return
    // 공지 확인은 /api/notice-active 경량 API가 담당합니다.

    const resolved = await resolvePlaylistsFromConfig(data)
    const nextLeft = normalizeItems(resolved.left)
    const nextRight = normalizeItems(resolved.right)

    if (!nextLeft.length && !nextRight.length) {
      throw createPlayerError('LV-PLAYLIST-EMPTY', '재생 가능한 playlist가 없습니다.')
    }

    const changed = bundleSignature(nextLeft, nextRight) !== bundleSignature(state.leftItems, state.rightItems)

    if (!changed && state.leftItems.length + state.rightItems.length > 0) {
      state.lastSync = kstString()
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

    markGoodConfig()
    hideErrorScreen()
    saveBundle(nextLeft, nextRight)

    startPlayback('left')
    window.setTimeout(() => startPlayback('right'), 500)

    state.lastSync = kstString()
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
        const code = error.code || 'LV-API-DOWN'
        await reportPlayerError(code, error.message, { reason, endpoint: error.endpoint || '', url: error.url || '', httpStatus: error.status || '' }, 'error')
        showErrorScreen({
          title: code === 'LV-PLAYLIST-EMPTY' ? '콘텐츠가 없습니다.' : 'CMS 연결 또는 playlist 확인 실패',
          message: code === 'LV-PLAYLIST-EMPTY' ? 'CMS에서 콘텐츠를 업로드하거나 playlist를 확인해 주세요.' : error.message,
          errorCode: code,
          detail: `store=${CONFIG.store || '-'}\napiBase=${CONFIG.apiBase || '-'}\nendpoint=${error.endpoint || '-'}\nurl=${error.url || '-'}\nhttpStatus=${error.status || '-'}\nstep=${reason || '-'}`,
        })
      }
    } else {
      const code = error.code || 'LV-API-DOWN'
      await reportPlayerError(code, error.message, { reason, mode: 'keep-current-playlist', endpoint: error.endpoint || '', url: error.url || '', httpStatus: error.status || '' }, 'warning')
      setStatus(`${code}: CMS 확인 실패, 기존 재생 유지`)
    }
    updateDebug()
  } finally {
    state.isSyncing = false
  }
}

async function handleRemoteCommand(devices, commandFromState = null) {
  const myDevice = CONFIG.deviceId
    ? devices.find((device) => device.id === CONFIG.deviceId || device.store === CONFIG.store)
    : devices.find((device) => device.store === CONFIG.store || device.id === CONFIG.store)
  if (!myDevice) return false

  const command = String(commandFromState?.command || myDevice.lastCommand || '')
  const commandAt = String(commandFromState?.commandAt || commandFromState?.commandAtUtc || myDevice.commandAt || '')
  if (!command || !commandAt) return false

  // CMS에서 보낸 새로고침 계열 명령은 단순 reload가 아니라
  // 미디어 캐시 + 저장된 playlist bundle을 삭제한 뒤 다시 시작합니다.
  const handled = localStorage.getItem(handledCommandKey)
  const commandKey = `${command}:${commandAt}`

  // 이전 버전은 commandAt만 저장했으므로, 이전 저장값도 함께 중복 처리합니다.
  if (handled === commandKey || handled === commandAt) return false

  const hardRefreshCommands = new Set(['refresh', 'hard_refresh', 'clear_cache_refresh', 'cache_refresh'])
  const noticeCommands = new Set(['notice_refresh', 'notice', 'reload_notice'])

  if (hardRefreshCommands.has(command)) {
    localStorage.setItem(handledCommandKey, commandKey)
    await hardRefreshFromCms(command)
    return true
  }

  if (noticeCommands.has(command)) {
    localStorage.setItem(handledCommandKey, commandKey)
    setStatus('CMS 공지 명령 수신: 공지 확인중')
    await checkNotice('remote-command')
    await syncConfig('notice-command')
    return true
  }

  if (command === 'screenshot' || command === 'capture') {
    if (window.LocalVisionNative?.captureScreenshot) {
      localStorage.setItem(handledCommandKey, commandKey)
      setStatus('CMS 화면 캡처 명령 수신: APP Shell에 캡처 요청')
      try {
        window.LocalVisionNative.captureScreenshot(JSON.stringify({
          command, commandAt, store: CONFIG.store, id: CONFIG.appId, source: 'player-v1.7.1', at: nowUtcIso(),
        }))
        return true
      } catch (error) {
        await reportPlayerError('LV-NATIVE-SCREENSHOT-FAILED', error?.message || 'APP Shell 캡처 호출 실패', { command, commandAt }, 'error')
        return false
      }
    }
    await reportPlayerError('LV-NATIVE-SCREENSHOT-UNAVAILABLE', 'APP Shell 브릿지가 없어 스크린샷 명령을 처리할 수 없습니다.', { command, commandAt }, 'warning')
    return false
  }

  if (command === 'clear_webview_cache' && window.LocalVisionNative?.clearWebViewCache) {
    localStorage.setItem(handledCommandKey, commandKey)
    window.LocalVisionNative.clearWebViewCache(JSON.stringify({ command, commandAt, store: CONFIG.store, id: CONFIG.appId }))
    return true
  }

  if (command === 'reload_app' && window.LocalVisionNative?.reloadApp) {
    localStorage.setItem(handledCommandKey, commandKey)
    window.LocalVisionNative.reloadApp(JSON.stringify({ command, commandAt, store: CONFIG.store, id: CONFIG.appId }))
    return true
  }

  return false
}

async function checkRemoteCommand() {
  if (!CONFIG.apiBase || !CONFIG.store) return
  try {
    const data = await fetchLiteEndpoint('/api/player-command', 'command')
    await handleRemoteCommand(data.device ? [data.device] : (data.devices || []), data.command)
  } catch (error) {
    try {
      const data = await fetchPlayerState('command-fallback')
      await handleRemoteCommand(data.devices || [], data.command)
      if (data.notice || data.activeNotice) await showNoticeOverlay(normalizeNotice(data.notice || data.activeNotice), 'command')
    } catch (_) {}
  }
}

async function sendHeartbeat() {
  if (!CONFIG.apiBase || !CONFIG.store) return
  const now = nowUtcIso()
  const body = {
    id: CONFIG.appId || CONFIG.deviceId || '',
    appId: CONFIG.appId || '',
    deviceId: CONFIG.deviceId || '',
    store: CONFIG.store,
    source: 'player',
    role: 'player',
    online: true,
    lastSeen: now,
    lastSeenKst: kstString(now),
    playerVersion: 'v1.7.1-api-diet',
    appShell: Boolean(CONFIG.appShell || CONFIG.appVersion),
    appVersion: CONFIG.appVersion || '',
    currentContent: state.leftItems[state.leftIndex]?.fileName || state.leftItems[state.leftIndex]?.title || '',
    playStatus: state.noticeVisible ? 'notice' : 'playing',
    cacheStatus: state.cacheStatus || '',
    noticeStatus: state.noticeVisible ? 'active' : 'idle',
    errorCount: state.playbackFailureCount || 0,
  }

  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let data
      try {
        data = await fetchJson(`${CONFIG.apiBase}/api/heartbeat`, {
          method: 'POST',
          attempts: 1,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (heartbeatError) {
        // 구버전 CMS 호환: /api/heartbeat가 없으면 기존 player-state POST로 1회 fallback합니다.
        data = await fetchJson(`${CONFIG.apiBase}/api/player-state`, {
          method: 'POST',
          attempts: 1,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      state.lastHeartbeat = data?.device?.lastSeenKst || data?.updatedAtKst || kstString(now)
      updateDebug()
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(1000 * attempt)
    }
  }

  reportPlayerError('LV-HEARTBEAT-FAILED', lastError?.message || 'heartbeat failed', { store: CONFIG.store, attempts: 3, lastSeenUtc: now, lastSeenKst: kstString(now) }, 'warning')
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
  if (isBlacklisted(item)) return scheduleNext(side, 1)

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
    const code = error.code || (String(error.message || '').includes('cache') ? 'LV-CACHE-CORRUPT' : 'LV-MEDIA-MISSING')
    handlePlaybackFailure(side, item, code, error.message || '콘텐츠 파일을 불러오지 못했습니다.')
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
    markPlaybackSuccess()
    scheduleNext(side, item.duration || 20)
  }

  img.onerror = () => {
    handlePlaybackFailure(side, item, 'LV-MEDIA-MISSING', '이미지 파일을 불러오지 못했습니다.')
  }
}

function mediaDebugInfo(media, item = {}) {
  const err = media?.error
  return {
    sourceUrl: item?.sourceUrl || item?.url || '',
    cacheUrl: item?.cacheUrl || '',
    fileName: item?.fileName || '',
    mediaSrc: media?.currentSrc || media?.src || '',
    errorCode: err?.code || '',
    errorMessage: err?.message || '',
    networkState: media?.networkState,
    readyState: media?.readyState,
    currentTime: media?.currentTime,
    duration: media?.duration,
  }
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
        markPlaybackSuccess()
        clearWatchdog(side)
      }).catch(() => {
        setTimeout(() => video.play().catch((error) => {
          handlePlaybackFailure(side, item, 'LV-MEDIA-PLAY-FAIL', error?.message || '영상 재생에 실패했습니다.', mediaDebugInfo(video, item))
        }), 300)
      })
    }, delay)
  }

  video.onloadeddata = reveal
  video.oncanplay = reveal

  video.onended = () => next(side)
  video.onerror = () => {
    handlePlaybackFailure(side, item, 'LV-MEDIA-PLAY-FAIL', '영상 파일 로딩 또는 재생에 실패했습니다.', mediaDebugInfo(video, item))
  }

  video.onloadedmetadata = () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setSideTimer(side, () => next(side), Math.ceil(video.duration + 2) * 1000)
    }
  }

  setWatchdog(side, () => {
    if (!started) handlePlaybackFailure(side, item, 'LV-MEDIA-WATCHDOG', '영상 시작 시간이 초과되어 다음 콘텐츠로 이동합니다.', mediaDebugInfo(video, item))
  }, 15000)

  const safetyMs = Math.max(60, Number(item.duration || 0) || 1800) * 1000
  setSideTimer(side, () => next(side), safetyMs)

  try { video.load() } catch {}
}

function scheduleNext(side, durationSeconds) {
  setSideTimer(side, () => next(side), Math.max(3, Number(durationSeconds || 20)) * 1000)
}

function next(side) {
  clearWatchdog(side)
  const items = getItems(side)
  if (!items.length) return
  let nextIndex = (getIndex(side) + 1) % items.length
  let found = false
  for (let i = 0; i < items.length; i += 1) {
    const idx = (nextIndex + i) % items.length
    if (!isBlacklisted(items[idx])) {
      nextIndex = idx
      found = true
      break
    }
  }
  if (!found) {
    // 모든 파일이 이번 세션에서 제외되면 무한 빈 화면을 막기 위해 세션 blacklist를 1회 초기화합니다.
    state.sessionBlacklist = {}
    nextIndex = (getIndex(side) + 1) % items.length
    setStatus(`${side} 세션 제외 목록 초기화 후 재시도`)
  }
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

function fireAndForget(label, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.warn('[LocalVision immediate boot]', label, error)
      if (label !== 'heartbeat') {
        reportPlayerError('LV-IMMEDIATE-BOOT-FAILED', error?.message || String(error || 'unknown'), { label }, 'warning')
      }
    })
}

function startOperationIntervals() {
  if (state.intervalsStarted) return
  state.intervalsStarted = true

  // 정기 호출은 첫 API 성공 여부와 무관하게 먼저 등록합니다.
  // 첫 호출은 boot()에서 즉시 별도 실행하고, 이후에는 아래 주기대로만 반복합니다.
  if (CONFIG.playerStatePollMs > 0) {
    setInterval(() => syncConfig('player-state-interval'), CONFIG.playerStatePollMs)
  }
  if (CONFIG.noticePollMs > 0) {
    setInterval(() => checkNotice('notice-interval'), CONFIG.noticePollMs)
  }
  if (CONFIG.appConfigPollMs > 0 && CONFIG.appId) {
    setInterval(() => checkAppConfig('app-config-interval'), CONFIG.appConfigPollMs)
  }
  if (CONFIG.heartbeatMs > 0) {
    setInterval(() => sendHeartbeat(), CONFIG.heartbeatMs)
  }
  setInterval(updateDebug, 2000)
}

function runImmediateApiBoot() {
  // Player URL 접속 즉시 1회 호출합니다.
  // 어떤 API가 실패해도 다른 API 호출과 재생/캐시 복구가 멈추지 않도록 전부 독립 실행합니다.
  if (CONFIG.appId) fireAndForget('app-config-startup', () => checkAppConfig('startup-immediate'))
  fireAndForget('player-state-startup', () => syncConfig('startup-immediate'))
  if (CONFIG.noticePollMs > 0) fireAndForget('notice-startup', () => checkNotice('startup-immediate'))
  fireAndForget('heartbeat', () => sendHeartbeat())
}

async function boot() {
  await registerServiceWorker()
  setupDebugToggle()
  setupDailyRestart()
  await updateCacheStatus()

  // 정기 호출 등록은 네트워크 성공을 기다리지 않고 먼저 처리합니다.
  startOperationIntervals()

  const fatalIssue = bootIssues.find((issue) => issue.level === 'fatal')
  const warnings = bootIssues.filter((issue) => issue.level === 'warning')
  warnings.forEach((issue) => {
    setStatus(`${issue.code}: ${issue.message}`)
    reportPlayerError(issue.code, issue.message, { recoveredStore: CONFIG.store, recoveredApiBase: CONFIG.apiBase }, 'warning')
  })

  // 저장된 콘텐츠가 있으면 API 응답을 기다리지 않고 즉시 재생합니다.
  if (loadSavedBundle()) {
    startPlayback('left')
    window.setTimeout(() => startPlayback('right'), 500)
    setStatus('저장된 캐시 재생 시작 · API 즉시 확인 중')
  } else {
    setStatus('Player 시작 · CMS API 즉시 확인 중')
  }

  // 첫 API 호출은 바로 실행합니다. 성공/실패가 다른 호출을 막지 않습니다.
  runImmediateApiBoot()

  if (fatalIssue) {
    showErrorScreen({
      title: fatalIssue.title || '설정 정보가 없습니다.',
      message: fatalIssue.message,
      errorCode: fatalIssue.code,
      detail: `현재 URL: ${location.href}`,
    })
    await reportPlayerError(fatalIssue.code, fatalIssue.message, { href: location.href }, 'fatal')
    updateDebug()
  }
}


window.addEventListener('error', (event) => {
  const message = event.message || '알 수 없는 오류가 발생했습니다.'
  setStatus(`LV-UNKNOWN: ${message}`)
  reportPlayerError('LV-UNKNOWN', message, { source: event.filename, line: event.lineno, column: event.colno }, 'error')
})
window.addEventListener('unhandledrejection', (event) => {
  const message = event.reason?.message || String(event.reason || '알 수 없는 오류가 발생했습니다.')
  setStatus(`LV-UNKNOWN: ${message}`)
  reportPlayerError('LV-UNKNOWN', message, { type: 'unhandledrejection' }, 'error')
})

boot()
