const STORAGE = (() => {
  try { const value = window.localStorage; value.getItem('lv-check'); return value; }
  catch (_) { const memory = new Map(); return {getItem:k=>memory.get(k) || null, setItem:(k,v)=>memory.set(k,String(v)), removeItem:k=>memory.delete(k), volatile:true}; }
})()
const params = new URLSearchParams(location.search)

const LAST_GOOD_STORE_KEY = 'lv-last-good-store'
const LAST_GOOD_API_BASE_KEY = 'lv-last-good-api-base'
const rawStore = String(params.get('store') || '').trim()
const rawApiBase = String(params.get('apiBase') || '').trim().replace(/\/$/, '')
const lastGoodStore = String(STORAGE.getItem(LAST_GOOD_STORE_KEY) || '').trim()
const lastGoodApiBase = String(STORAGE.getItem(LAST_GOOD_API_BASE_KEY) || '').trim().replace(/\/$/, '')

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
  blackModePollMs: Number(params.get('blackModePoll') || params.get('blackModePollMs') || 60000),
  playerStatePollMs: Number(params.get('playerStatePoll') || params.get('statePoll') || params.get('contentCheck') || 900000),
  scheduleCheckMs: Number(params.get('scheduleCheck') || params.get('scheduleCheckMs') || 30000),
  versionPollMs: Number(params.get('versionPoll') || 600000),
  cacheMax: Number(params.get('cacheMax') || 200),
  cacheBudgetMB: Number(params.get('cacheBudgetMB') || 1024),
  diagnosticEvents: params.get('diagnostics') === '1',
  restart: params.get('restart') || '',
  restartMode: params.get('restartMode') || 'reload',
  restartJitterSec: Number(params.get('restartJitterSec') || 0),
  fit: params.get('fit') || 'cover',
  videoMode: params.get('videoMode') || 'cache',
  bundleMode: params.get('bundleMode') || 'cache',
  cacheVia: params.get('cacheVia') || 'api',
  cacheAll: params.get('cacheAll') !== '0',
  activateWhenCached: params.get('activateWhenCached') !== '0',
  // v1.7.3: 기본값은 R2 public playlist snapshot 직접 fetch OFF.
  // /api/player-state가 이미 playlists payload를 내려주므로, 현장에서는 public R2 CORS/일시 실패 로그를 줄이는 것이 더 안정적입니다.
  // 필요할 때만 URL에 snapshotFetch=1을 붙이면 기존 방식처럼 R2 playlist.json을 직접 확인합니다.
  snapshotFetch: ['1', 'true', 'yes'].includes(String(params.get('snapshotFetch') || params.get('r2SnapshotFetch') || '').toLowerCase()),
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

const PLAYER_BUILD = 'v1.9.1-navigation-hotfix'
const MEDIA_CACHE = 'lv-media-bundle-v1-8-0'
const META_KEY = 'lv-media-bundle-meta-v1-8-0'
const PLAYLIST_KEY = `lv-playlist-bundle-v1-8-0-${CONFIG.store || CONFIG.appId}`
const SCHEDULE_KEY = `lv-schedule-bundle-v1-8-0-${CONFIG.store || CONFIG.appId}`
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
  noticeGeneration: 0,
  noticeObjectUrl: '',
  noticeLoadController: null,
  noticeMonitor: null,
  scheduleApplying: false,
  playbackFailureCount: 0,
  lastPlaybackFailureAt: 0,
  recoveryReloadPending: false,
  intervalsStarted: false,
  navigating: false,
  mediaFailures: {},
  sessionBlacklist: {},
  lastPlaylistCheckReportAt: 0,
  versionReloadPending: false,
  blackModeActive: false,
  blackModeReason: 'off',
  blackModeUpdatedAt: '',
  playlistGroups: {},
  playlistSchedules: [],
  activePlaylistKey: '',
  defaultPlaylistKey: 'default',
  scheduleStatus: 'off',
  lastScheduleEvalAt: '',
}



const RECOVERY_KEY = `lv-player-recovery-${CONFIG.store || CONFIG.appId || 'unknown'}`
const ERROR_QUEUE_KEY = `lv-player-error-queue-${CONFIG.store || CONFIG.appId || 'unknown'}`
const ERROR_QUEUE_MAX = 50
const ERROR_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000

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

// Stable installation identity is separate from the legacy store-level CMS device card.
let installationId = CONFIG.deviceId || STORAGE.getItem('lv-installation-id') || `web_${LVRuntime.uid()}`
CONFIG.deviceId = installationId
try { STORAGE.setItem('lv-installation-id', installationId) } catch (_) {}
const SESSION_ID = LVRuntime.uid()
const BOOT_SEQUENCE = Math.max(Date.now(),Number(STORAGE.getItem('lv-boot-sequence') || 0) + 1)
try { STORAGE.setItem('lv-boot-sequence', String(BOOT_SEQUENCE)) } catch (_) {}
let healthSequence = 0, healthTimer = null, healthBusy = false
let lastHealthSentAt = 0
const exclusiveTasks = new Set()
const cacheDownloads = new Map()
let cacheWriteChain = Promise.resolve()
let cacheKeepUrls = new Set()
const playbackMetrics = {started:0,completed:0,interrupted:0,failed:0,skipped:0,items:{}}
const outbox = new LVRuntime.Outbox({
  storage: STORAGE, key: `lv-outbox-v181-${CONFIG.store}-${CONFIG.deviceId}`,
  send: async (items) => LVRuntime.timedFetch(`${CONFIG.apiBase}/api/player-errors`, {
    method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
    body:JSON.stringify({store:CONFIG.store,deviceId:CONFIG.deviceId,errors:items})
  }, 15000, async response => {
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `로그 서버 HTTP ${response.status}`)
    return body
  })
})
// Import unsent v1.8.0 records without deleting them until durable new storage exists.
try {
  const old = JSON.parse(STORAGE.getItem(ERROR_QUEUE_KEY) || '[]')
  if (Array.isArray(old) && old.length) {
    old.forEach(e => outbox.enqueue({...e,deviceId:CONFIG.deviceId,id:e.id || LVRuntime.uid()}))
    if (outbox.durable) STORAGE.removeItem(ERROR_QUEUE_KEY)
  }
} catch (_) {}
const acquireDecoder = LVRuntime.createGate()
const lanes = {}
for (const side of ['left','right']) {
  lanes[side] = new LVRuntime.Lane(side, {
    zone: side === 'left' ? els.leftZone : els.rightZone, fit:CONFIG.fit,
    acquire:acquireDecoder,resolveSource:async (item,signal) => {
      return getCachedBlobUrl(item,signal)
    },
    onItem:(_side,item,index) => {setIndex(_side,index)},
    onState:(_side,_snapshot,important) => {if (important) requestHealthReport();},
    onEvent:(code,message,extra,level) => {
      const names = {'LV-PLAY-START':'started','LV-PLAY-COMPLETE':'completed','LV-PLAY-INTERRUPTED':'interrupted','LV-MEDIA-SESSION-SKIP':'skipped'}
      const metric = names[code] || (level === 'error' ? 'failed' : '')
      if (metric) {
        playbackMetrics[metric]++
        const key = `${extra.side}:${extra.itemId || extra.fileName}`
        if (!playbackMetrics.items[key] && Object.keys(playbackMetrics.items).length < 250) playbackMetrics.items[key] = {side:extra.side,itemId:extra.itemId,fileName:extra.fileName,started:0,completed:0,interrupted:0,failed:0,skipped:0}
        if (playbackMetrics.items[key]) playbackMetrics.items[key][metric]++
      }
      if (['LV-PLAY-START','LV-PLAY-COMPLETE'].includes(code) && !CONFIG.diagnosticEvents) return
      const opposite = lanes[side === 'left' ? 'right' : 'left']?.snapshot()
      reportPlayerError(code,message,{...extra,opposite},level,extra.attemptId ? 0 : 60000)
    }
  })
}


const bundleJournal=new LVPlaylistStore.Journal(STORAGE,`lv-bundle-v190-${CONFIG.store}`);
let delivery={phase:'idle',target:'',completed:0,total:0,verified:0,legacy:0,fileName:'',error:'',appliedAt:'',prefetch:null};
let prefetchBusy=false,prefetchTimer=null,prefetchRetryAt=0,prefetchKey='',backgroundPreparing=false;
let verifiedFiles,prefetchController=null,prefetchWork=null;
function deliveryStage(phase,item){
 if(backgroundPreparing){if(delivery.prefetch){delivery.prefetch.phase=phase;delivery.prefetch.fileName=item?.fileName || '';}}
 else {delivery.phase=phase;delivery.fileName=item?.fileName || '';}
 requestHealthReport();
}
verifiedFiles=new LVPlaylistStore.VerifiedFiles({
 cache:getMediaCache,room:makeCacheRoom,
 fetch:(url,signal,consume)=>LVRuntime.timedFetch(url,{cache:'no-store',signal},90000,consume),
 yieldChunk:()=>globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve=>setTimeout(resolve,0)),
 stage:deliveryStage,
 saved:(key,result)=>touchMeta(key,{bytes:result.blob.size,revision:result.revision,originVerified:result.verified}),
 fault:(e,item)=>reportPlayerError(e.code || 'LV-INTEGRITY-MISMATCH',e.message,{fileName:item.fileName,phase:'cache-validation'},'warning',60000)
});
function scheduleSnapshot(){return {playlistGroups:state.playlistGroups,playlistSchedules:state.playlistSchedules,defaultPlaylistKey:state.defaultPlaylistKey,activeKey:state.activePlaylistKey};}
function restoreSchedule(s={}){state.playlistGroups=s.playlistGroups || {};state.playlistSchedules=s.playlistSchedules || [];state.defaultPlaylistKey=s.defaultPlaylistKey || 'default';state.activePlaylistKey=s.activeKey || '';}
function commitPrepared(left,right){
 const leftChanged=playlistSignature(left)!==playlistSignature(state.leftItems),rightChanged=playlistSignature(right)!==playlistSignature(state.rightItems);
 const bundle={left,right,schedule:scheduleSnapshot(),savedAt:nowUtcIso(),id:bundleSignature(left,right)};
 bundleJournal.commit(bundle); // Single authoritative write, before mutating live playback.
 state.leftItems=left;state.rightItems=right;if(leftChanged)state.leftIndex=0;if(rightChanged)state.rightIndex=0;
 saveBundle(left,right);saveScheduleBundle(right); // Legacy rollback compatibility; journal remains authoritative.
 if(leftChanged)startPlayback('left');if(rightChanged)startPlayback('right');
 cacheKeepUrls=new Set([...left,...right].map(i=>i.cacheUrl || i.url));
 delivery.phase='applied';delivery.appliedAt=bundle.savedAt;delivery.fileName='';delivery.error='';
 requestHealthReport();queuePrefetch();
}
function queuePrefetch(){if(prefetchTimer)clearTimeout(prefetchTimer);prefetchTimer=setTimeout(()=>{prefetchWork=prefetchUpcoming().catch(()=>{}).finally(()=>{prefetchWork=null})},2000);}
function upcomingGroup(now=Date.now()){
 const current=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey,new Date(now)).group;
 for(let minute=1;minute<=24*60;minute++){
  const selected=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey,new Date(Math.floor(now/60000)*60000+minute*60000));
  if(selected.group && selected.group.key!==current?.key)return {group:selected.group,at:Math.floor(now/60000)*60000+minute*60000};
 }
 return null;
}
async function prefetchUpcoming(){
 if(prefetchBusy || state.isSyncing || state.scheduleApplying || Date.now()<prefetchRetryAt)return;
 const next=upcomingGroup();if(!next){delivery.prefetch=null;return;}
 const left=normalizeItems(next.group.left),right=state.rightItems;const key=next.group.key+':'+bundleSignature(left,right);
 if(prefetchKey===key && delivery.prefetch?.phase==='ready')return;
 prefetchBusy=true;backgroundPreparing=true;prefetchController=new AbortController();prefetchKey=key;
 delivery.prefetch={phase:'preparing',group:next.group.name || next.group.key,at:new Date(next.at).toISOString(),completed:0,total:0,error:''};
 try{await ensureBundleCached(left,right,true,prefetchController.signal);delivery.prefetch.phase='ready';}
 catch(e){delivery.prefetch.phase='blocked';delivery.prefetch.error=e.message;prefetchRetryAt=Date.now()+300000;reportPlayerError(e.code || 'LV-PREFETCH-FAILED',e.message,{phase:'prefetch',group:next.group.key},'warning',300000);}
 finally{backgroundPreparing=false;prefetchBusy=false;prefetchController=null;requestHealthReport();}
}
async function selectBootBundle(){
 const journal=bundleJournal.read();if(!journal)return;
 const cache=await getMediaCache();
 const complete=async b=>{for(const item of [...b.left,...b.right])if(!await cache.match(item.cacheUrl || item.url))return false;return true;};
 let selected=journal.active;
 if(!await complete(selected) && journal.previous && await complete(journal.previous)){
  selected=journal.previous;delivery.error='현재 송출본 파일 누락: 이전 저장본 사용';
  reportPlayerError('LV-BUNDLE-BOOT-FALLBACK',delivery.error,{phase:'boot'},'warning');
 }
 state.leftItems=selected.left;state.rightItems=selected.right;restoreSchedule(selected.schedule);
 delivery.phase='restored';delivery.appliedAt=selected.savedAt || '';delivery.verified=[...selected.left,...selected.right].filter(x=>x.integrity).length;delivery.legacy=selected.left.length+selected.right.length-delivery.verified;
}
function healthPayload() {
  return {store:CONFIG.store,deviceId:CONFIG.deviceId,appId:CONFIG.appId,sessionId:SESSION_ID,
    bootSequence:BOOT_SEQUENCE,sequence:++healthSequence,playerVersion:PLAYER_BUILD,appVersion:CONFIG.appVersion,
    sentAt:nowUtcIso(),heartbeatMs:CONFIG.heartbeatMs,userAgent:navigator.userAgent,
    visibility:document.visibilityState,blackMode:state.blackModeActive,notice:state.noticeVisible,
    left:lanes.left.snapshot(),right:lanes.right.snapshot(),outbox:{...outbox.snapshot(),volatileStorage:Boolean(STORAGE.volatile)},
    delivery,cache:{status:state.cacheStatus,budgetMB:CONFIG.cacheBudgetMB},metrics:playbackMetrics,
    schedule:{activeKey:state.activePlaylistKey,status:state.scheduleStatus},
    lastCommand:readJsonStorage('lv-last-command-result',null)}
}
function readJsonStorage(key,fallback) {try{return JSON.parse(STORAGE.getItem(key) || 'null') || fallback}catch(_){return fallback}}
function requestHealthReport() {
  if (healthTimer || !CONFIG.apiBase) return
  healthTimer = setTimeout(() => {healthTimer=null;sendHealthReport().catch(()=>{})},Math.max(1000,10000-(Date.now()-lastHealthSentAt)))
}
async function sendHealthReport() {
  if (healthBusy || !CONFIG.apiBase || !CONFIG.store) return
  healthBusy=true
  try {
    await LVRuntime.timedFetch(`${CONFIG.apiBase}/api/player-status`,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(healthPayload())},15000,async r=>{if(!r.ok) throw new Error(`상태 서버 HTTP ${r.status}`);return r.json()})
    lastHealthSentAt=Date.now()
  } catch (_) { /* The next heartbeat retries current state; playback never waits. */ }
  finally {healthBusy=false}
}
async function runExclusive(name,task) {
  if (exclusiveTasks.has(name)) return
  exclusiveTasks.add(name)
  try {return await task()} finally {exclusiveTasks.delete(name)}
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


function readQueuedPlayerErrors() { return outbox.items.slice() }

function writeQueuedPlayerErrors() { outbox.persist() }

function enqueuePlayerError(payload = {}) { return outbox.enqueue(payload) }

function flushQueuedPlayerErrors() { outbox.flush().catch(()=>{}); return true }

async function reportPlayerError(errorCode, message, extra = {}, level = 'error', minReportMs = 60000) {
  if (!CONFIG.apiBase) return
  const key = `${errorCode}:${extra.side || ''}:${extra.itemId || extra.fileName || ''}:${extra.attemptId || ''}:${message}`
  if (minReportMs > 0 && !shouldReportError(key,minReportMs)) return
  const timeUtc=nowUtcIso()
  const id=outbox.enqueue({store:CONFIG.store,deviceId:CONFIG.deviceId,errorCode,message:String(message || '').slice(0,1000),level,time:timeUtc,timeUtc,timeKst:kstString(timeUtc),
    href:location.href,userAgent:navigator.userAgent,extra:{...extra,timeUtc,timeKst:kstString(timeUtc),playerVersion:PLAYER_BUILD,sessionId:SESSION_ID}})
  if (level === 'error' || level === 'fatal' || errorCode === 'LV-MEDIA-RECOVERED') requestHealthReport()
  return id
}

function readRecoveryMeta() {
  try { return JSON.parse(STORAGE.getItem(RECOVERY_KEY) || '{}') } catch { return {} }
}

function writeRecoveryMeta(meta) {
  try { STORAGE.setItem(RECOVERY_KEY, JSON.stringify(meta || {})) } catch {}
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


function isTransientPlaybackMessage(message = '') {
  const text = String(message || '').toLowerCase()
  return state.navigating
    || document.visibilityState === 'hidden'
    || text.includes('page was frozen')
    || text.includes('containing page was frozen')
    || text.includes('play() request was interrupted')
    || text.includes('interrupted because')
}

function handlePlaybackFailure(side,item,errorCode,message,extra={}) {
  const lane=lanes[side]
  if(lane && lane.current?.url === item?.url) lane.fail(Object.assign(new Error(message),{code:errorCode,...extra}),'playback',lane.generation)
}

function markPlaybackSuccess() { /* Completion is tracked by each Lane. */ }

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
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
      <strong>오류코드: ${escapeHtml(errorCode)}</strong>
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
  if (CONFIG.store) STORAGE.setItem(LAST_GOOD_STORE_KEY, CONFIG.store)
  if (CONFIG.apiBase) STORAGE.setItem(LAST_GOOD_API_BASE_KEY, CONFIG.apiBase)
}

function updateDebug() {
  els.dbgStore.textContent = CONFIG.store || CONFIG.appId || '-' 
  els.dbgDevice.textContent = CONFIG.deviceId || `store:${CONFIG.store}` || '미지정'
  els.dbgApi.textContent = CONFIG.apiBase
  els.dbgLeft.textContent = String(state.leftItems.length)
  els.dbgRight.textContent = String(state.rightItems.length)
  els.dbgSync.textContent = state.lastSync || '-'
  els.dbgHeartbeat.textContent = state.lastHeartbeat || '-'
  els.dbgBundle.textContent = state.bundleStatus + (state.scheduleStatus ? ` · ${state.scheduleStatus}` : '')
  els.dbgCache.textContent = state.cacheStatus
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  try { await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}) } catch (error) {}
}

async function fetchJson(url, options = {}) {
  const attempts=LVRuntime.clamp(options.attempts || 3,1,3,3)
  const clean={...options}; delete clean.attempts
  let lastError
  for(let attempt=0;attempt<attempts;attempt++) {
    if(attempt) await sleep(attempt*1000)
    try {
      return await LVRuntime.timedFetch(url,{cache:'no-store',...clean},15000,async response=>{
        const text=await response.text()
        let data;try{data=JSON.parse(text)}catch(_){throw createPlayerError('LV-API-INVALID','CMS 응답 형식 오류')}
        if(!response.ok || data.ok === false) {
          const err=createPlayerError(data.errorCode || 'LV-API-DOWN',data.error || `HTTP ${response.status}`)
          err.status=response.status;err.url=url;err.endpoint=new URL(url).pathname;throw err
        }
        return data
      })
    } catch(error) {lastError=error;error.url=url;try{error.endpoint=new URL(url).pathname}catch(_){};if(error.status>=400 && error.status<500 && error.status!==429) break}
  }
  throw lastError
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
      state.navigating = true
      await reportPlayerError('LV-APP-CONFIG-URL-CHANGE', 'CMS app-config의 Player URL 변경을 감지해 이동합니다.', { reason, appId: CONFIG.appId, nextUrl: data.playerUrl }, 'warning', 30 * 60 * 1000)
      window.setTimeout(() => location.replace(data.playerUrl), 300)
      return true
    }
  } catch (error) {
    await reportPlayerError('LV-APP-CONFIG-FAILED', error?.message || 'app-config 확인 실패', { reason, appId: CONFIG.appId }, 'warning')
  }
  return false
}

function playerQuery(extra = {}) {
  const qs = new URLSearchParams({ store: CONFIG.store, deviceId: CONFIG.deviceId, t: String(Date.now()), ...extra })
  if (CONFIG.appId) qs.set('id', CONFIG.appId)
  return qs
}

async function fetchPlayerState(reason = 'poll') {
  if (!CONFIG.apiBase || !CONFIG.store) throw new Error('apiBase/store missing')
  const qs = playerQuery({ reason })
  try {
    return await fetchJson(`${CONFIG.apiBase}/api/player-state?${qs.toString()}`)
  } catch (error) {
    if (error.status !== 404) throw error
    // 이전 CMS에서 player-state가 없을 때만 호환 엔드포인트를 사용합니다.
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

function ensureBlackModeOverlay() {
  let overlay = document.getElementById('lvBlackModeOverlay')
  if (overlay) return overlay
  overlay = document.createElement('div')
  overlay.id = 'lvBlackModeOverlay'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.innerHTML = '<div class="lv-black-mode-dot"></div>'
  const style = document.createElement('style')
  style.id = 'lvBlackModeStyle'
  style.textContent = `
    #lvBlackModeOverlay{position:fixed;inset:0;background:#000;z-index:999999;display:none;align-items:center;justify-content:center;color:#111;cursor:none;}
    #lvBlackModeOverlay.is-active{display:flex;}
    #lvBlackModeOverlay .lv-black-mode-dot{width:1px;height:1px;opacity:.02;background:#000;}
  `
  document.head.appendChild(style)
  document.body.appendChild(overlay)
  return overlay
}

function setBlackMode(active, reason = 'off', extra = {}) {
  const overlay = ensureBlackModeOverlay()
  const next = Boolean(active)
  if (state.blackModeActive === next && state.blackModeReason === reason) return
  for(const side of ['left','right']) next ? lanes[side].pause('black-mode') : lanes[side].resume('black-mode')
  state.blackModeActive = next
  state.blackModeReason = reason || 'off'
  state.blackModeUpdatedAt = kstString()
  overlay.classList.toggle('is-active', next)
  overlay.dataset.reason = state.blackModeReason
  overlay.dataset.store = CONFIG.store || ''
  overlay.dataset.updatedAt = state.blackModeUpdatedAt
  if (next) {
    setStatus(`휴무모드 ON: ${state.blackModeReason}`)
    reportPlayerError('LV-BLACK-MODE-ON', 'CMS 휴무모드/블랙모드가 적용되었습니다.', { reason: state.blackModeReason, mode: extra }, 'info', 10 * 60 * 1000)
  } else {
    setStatus('휴무모드 OFF: 정상 송출')
    reportPlayerError('LV-BLACK-MODE-OFF', 'CMS 휴무모드/블랙모드가 해제되었습니다.', { reason: state.blackModeReason, mode: extra }, 'info', 10 * 60 * 1000)
  }
  updateDebug()
}

async function checkBlackMode(reason = 'poll') {
  if (!CONFIG.apiBase || !CONFIG.store) return
  try {
    const data = await fetchLiteEndpoint('/api/black-mode', reason)
    const mode = data?.mode || data || {}
    setBlackMode(Boolean(mode.blackMode || mode.active), mode.reason || 'off', mode)
  } catch (error) {
    await reportPlayerError('LV-BLACK-MODE-CHECK-FAILED', error?.message || '휴무모드 확인 실패', { reason, endpoint: error.endpoint || '', url: error.url || '' }, 'warning', 10 * 60 * 1000)
  }
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
    await reportPlayerError('LV-SNAPSHOT-FETCH-FAILED', error?.message || 'playlist snapshot fetch failed', { label, url }, 'warning', 30 * 60 * 1000)
    return null
  }
}

function parseScheduleDays(value) {
  if (Array.isArray(value)) return value.map(Number).filter((v) => v >= 0 && v <= 6)
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.map(Number).filter((v) => v >= 0 && v <= 6) : []
  } catch { return [] }
}

function timeMinutes(value = '') {
  const m = String(value || '00:00').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  return Math.max(0, Math.min(23, Number(m[1]))) * 60 + Math.max(0, Math.min(59, Number(m[2])))
}

function kstParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return {
    day: kst.getUTCDay(),
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
    time: `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`,
  }
}

function isScheduleActiveAt(schedule = {}, value = new Date()) {
  if (!schedule || schedule.enabled === false) return false
  const parts = kstParts(value)
  const days = parseScheduleDays(schedule.days || schedule.daysJson)
  const start = timeMinutes(schedule.startTime)
  const end = timeMinutes(schedule.endTime)
  const now = parts.minutes
  if (start === end) return days.includes(parts.day)
  if (start < end) return days.includes(parts.day) && now >= start && now < end
  return (days.includes(parts.day) && now >= start) || (days.includes((parts.day+6)%7) && now < end)
}

function pickActiveSchedule(schedules = [], value = new Date()) {
  return [...(schedules || [])]
    .filter((schedule) => schedule.enabled !== false && isScheduleActiveAt(schedule, value))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0] || null
}

function normalizePlaylistGroups(groups = {}) {
  if (!groups || typeof groups !== 'object') return {}
  const output = {}
  Object.entries(groups).forEach(([key, group]) => {
    if (!group) return
    const gKey = String(group.key || group.slug || key || group.id || '').trim()
    if (!gKey) return
    output[gKey] = {
      ...group,
      key: gKey,
      id: group.id || gKey,
      slug: group.slug || gKey,
      name: group.name || '플레이리스트',
      left: Array.isArray(group.left) ? group.left : (Array.isArray(group.items) ? group.items : []),
    }
  })
  return output
}

function findGroupByIdOrKey(groups = {}, idOrKey = '') {
  const target = String(idOrKey || '').trim()
  if (!target) return null
  if (groups[target]) return groups[target]
  return Object.values(groups).find((group) => group.id === target || group.slug === target || group.key === target) || null
}

function selectScheduledGroup(groups = {}, schedules = [], defaultKey = 'default', value = new Date()) {
  const activeSchedule = pickActiveSchedule(schedules, value)
  const bySchedule = activeSchedule ? findGroupByIdOrKey(groups, activeSchedule.playlistGroupId) : null
  const fallback = groups[defaultKey] || Object.values(groups).find((group) => group.isDefault) || Object.values(groups)[0] || null
  const useScheduleGroup = bySchedule && Array.isArray(bySchedule.left) && bySchedule.left.length > 0
  return { group: useScheduleGroup ? bySchedule : fallback, schedule: useScheduleGroup ? activeSchedule : null }
}

function saveScheduleBundle(rightItems = []) {
  try {
    STORAGE.setItem(SCHEDULE_KEY, JSON.stringify({
      playlistGroups: state.playlistGroups,
      playlistSchedules: state.playlistSchedules,
      defaultPlaylistKey: state.defaultPlaylistKey,
      rightItems,
      savedAt: new Date().toISOString(),
    }))
  } catch {}
}

function loadSavedScheduleBundle() {
  try {
    const saved = JSON.parse(STORAGE.getItem(SCHEDULE_KEY) || 'null')
    if (!saved || !saved.playlistGroups) return false
    state.playlistGroups = normalizePlaylistGroups(saved.playlistGroups)
    state.playlistSchedules = Array.isArray(saved.playlistSchedules) ? saved.playlistSchedules : []
    state.defaultPlaylistKey = saved.defaultPlaylistKey || 'default'
    if (Array.isArray(saved.rightItems) && saved.rightItems.length) state.rightItems = saved.rightItems
    state.scheduleStatus = `saved ${saved.savedAt || ''}`
    return Object.keys(state.playlistGroups).length > 0
  } catch { return false }
}

function captureSchedulePayload(data = {}) {
  const groups = normalizePlaylistGroups(data.playlistGroups || {})
  const schedules = Array.isArray(data.playlistSchedules) ? data.playlistSchedules : []
  if (!Object.keys(groups).length) {
    if(Object.prototype.hasOwnProperty.call(data,'playlistGroups')) {
      state.playlistGroups={};state.playlistSchedules=[];state.activePlaylistKey='';state.scheduleStatus='off'
      try{STORAGE.removeItem(SCHEDULE_KEY)}catch(_){}
    }
    return false
  }
  state.playlistGroups = groups
  state.playlistSchedules = schedules
  state.defaultPlaylistKey = data.defaultPlaylistKey || 'default'
  state.scheduleStatus = `${Object.keys(groups).length}개 그룹 · ${schedules.length}개 스케줄`
  state.lastScheduleEvalAt = kstString()
  return true
}

async function applyLocalSchedule(reason = 'schedule-local') {
  const desired=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey).group;
  if(prefetchBusy && (!desired || playlistSignature(normalizeItems(desired.left))===playlistSignature(state.leftItems)))return false;
  if(prefetchBusy){prefetchController?.abort();if(prefetchWork)await prefetchWork;}
  if(state.isSyncing || state.scheduleApplying || prefetchBusy) return false
  state.scheduleApplying=true
  const priorKey=state.activePlaylistKey
  try {
  if (!Object.keys(state.playlistGroups || {}).length) return false
  const selected = selectScheduledGroup(state.playlistGroups, state.playlistSchedules, state.defaultPlaylistKey)
  const group = selected.group
  if (!group || !Array.isArray(group.left) || !group.left.length) return false
  const nextLeft = normalizeItems(group.left)
  const nextRight = state.rightItems || []
  const nextKey = group.key || group.slug || group.id || 'default'
  state.lastScheduleEvalAt = kstString()
  state.scheduleStatus = selected.schedule
    ? `${group.name} · ${selected.schedule.name || '스케줄'} · ${kstParts().time}`
    : `${group.name} · 기본 · ${kstParts().time}`
  if (state.activePlaylistKey === nextKey && playlistSignature(nextLeft) === playlistSignature(state.leftItems)) {
    updateDebug()
    return false
  }
  await ensureBundleCached(nextLeft, nextRight)
  const fresh=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey)
  if((fresh.group?.key || fresh.group?.slug || fresh.group?.id || 'default') !== nextKey) return false
  state.activePlaylistKey = nextKey
  commitPrepared(nextLeft,nextRight)
  await reportPlayerError('LV-SCHEDULE-PLAYLIST-SWITCH', `시간대별 송출 전환: ${group.name}`, {
    reason,
    playlistKey: nextKey,
    schedule: selected.schedule ? selected.schedule.name : 'default',
    leftCount: nextLeft.length,
  }, 'info', 60000)
  setStatus(`시간대별 송출: ${group.name}`)
  updateDebug()
  return true
  } catch(error){state.activePlaylistKey=priorKey;delivery.phase='blocked';delivery.error=error.message;requestHealthReport();reportPlayerError(error.code || 'LV-SCHEDULE-PREPARE',error.message,{phase:'schedule-prepare'},'warning',60000);return false;} finally {state.scheduleApplying=false;queuePrefetch()}
}

async function resolvePlaylistsFromConfig(data) {
  let left = Array.isArray(data?.playlists?.left) ? data.playlists.left : []
  let right = Array.isArray(data?.playlists?.right) ? data.playlists.right : []

  const hasSchedulePayload = captureSchedulePayload(data)
  if (hasSchedulePayload) {
    const selected = selectScheduledGroup(state.playlistGroups, state.playlistSchedules, state.defaultPlaylistKey)
    if (selected.group && Array.isArray(selected.group.left) && selected.group.left.length) {
      left = selected.group.left
      state.activePlaylistKey = selected.group.key || selected.group.slug || selected.group.id || 'default'
      state.scheduleStatus = selected.schedule
        ? `${selected.group.name} · ${selected.schedule.name || '스케줄'} · ${kstParts().time}`
        : `${selected.group.name} · 기본 · ${kstParts().time}`
    }
  }

  const urls = data?.playlistUrls || {}
  const bundleUrl = data?.playlistUrl || urls.bundle || ''

  // v1.7.3 현장 안정화:
  // /api/player-state가 이미 R2 snapshot 또는 D1 fallback으로 만든 playlists를 포함합니다.
  // 따라서 기본 운영에서는 public R2 playlist.json을 다시 fetch하지 않습니다.
  // R2 public URL/CORS/순간 네트워크 문제로 LV-SNAPSHOT-FETCH-FAILED가 누적되는 것을 막습니다.
  // 단, API payload가 비어 있거나 snapshotFetch=1이면 기존처럼 snapshot URL을 확인합니다.
  const hasEmbeddedPlaylist = left.length > 0 || right.length > 0
  if (!CONFIG.snapshotFetch && hasEmbeddedPlaylist) {
    return { left, right }
  }

  // snapshot URL이 있으면 확인합니다. 실패하면 API payload의 playlists로 fallback합니다.
  const bundle = await fetchSnapshot(bundleUrl, 'bundle')
  if (bundle) {
    const bLeft = extractPlaylistItems(bundle, 'left')
    const bRight = extractPlaylistItems(bundle, 'right')
    if (bLeft.length) left = bLeft
    if (bRight.length) right = bRight
    captureSchedulePayload(bundle)
    if (Object.keys(state.playlistGroups || {}).length) {
      const selected = selectScheduledGroup(state.playlistGroups, state.playlistSchedules, state.defaultPlaylistKey)
      if (selected.group?.left?.length) left = selected.group.left
    }
  }

  // 공통 right는 여러 매장이 공유하므로 bundle이 있어도 별도 right snapshot이 있으면 우선 적용합니다.
  // left도 별도 snapshot이 있으면 적용합니다. 둘 중 하나가 실패해도 API payload/bundle로 fallback합니다.
  if (CONFIG.snapshotFetch && (urls.left || urls.right)) {
    const [leftDoc, rightDoc] = await Promise.all([
      urls.left ? fetchSnapshot(urls.left, 'left') : Promise.resolve(null),
      urls.right ? fetchSnapshot(urls.right, 'right') : Promise.resolve(null),
    ])
    const sLeft = extractPlaylistItems(leftDoc, 'left')
    const sRight = extractPlaylistItems(rightDoc, 'right')
    if (sLeft.length && !Object.keys(state.playlistGroups || {}).length) left = sLeft
    if (sRight.length) right = sRight
  }

  return { left, right }
}

function mediaKeyOf(item = {}) {
  return String(item.cacheKey || item.cacheUrl || item.sourceUrl || item.url || item.fileName || item.id || '')
}

function isBlacklisted(item={}) { return false /* Quarantines are lane-scoped in runtime.js. */ }

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

function verifiedCacheKey(item) {
  const url=makeMediaFetchUrl(item.url || '');if(!item.integrity?.revision)return url;
  const u=new URL(url,location.href);u.searchParams.set('_lvrev',item.integrity.revision);return u.href;
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
      fetchUrl: makeMediaFetchUrl(item.url || ''),
      cacheUrl: verifiedCacheKey(item),
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
    integrityRevision:item.integrity?.revision || '',
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
    const saved = bundleJournal.read()?.active || JSON.parse(STORAGE.getItem(PLAYLIST_KEY) || 'null')
    if (!saved) return false
    if (!Array.isArray(saved.left) || !Array.isArray(saved.right)) return false

    if(saved.schedule)restoreSchedule(saved.schedule)
    state.leftItems = saved.left
    state.rightItems = saved.right
    state.leftIndex = Number(saved.leftIndex || 0)
    state.rightIndex = Number(saved.rightIndex || 0)
    if(!bundleJournal.read()){try{bundleJournal.commit({...saved,schedule:scheduleSnapshot(),id:bundleSignature(saved.left,saved.right)})}catch(e){reportPlayerError(e.code,e.message,{phase:'legacy-migration'},'warning')}}
    state.bundleStatus = `saved ${saved.savedAt || ''}`
    updateDebug()
    return state.leftItems.length > 0 || state.rightItems.length > 0
  } catch {
    return false
  }
}

function saveBundle(left,right) {
  try { STORAGE.setItem(PLAYLIST_KEY,JSON.stringify({left,right,sig:bundleSignature(left,right),savedAt:nowUtcIso()})) }
  catch(error) {reportPlayerError('LV-STORAGE-WRITE','재시작용 재생목록 저장 실패',{message:error.message},'error')}
}

function loadMeta() {
  try { return JSON.parse(STORAGE.getItem(META_KEY) || '{}') } catch { return {} }
}

function saveMeta(meta) { try{STORAGE.setItem(META_KEY,JSON.stringify(meta || {}))}catch(_){} }

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

async function ensureCached(item,index,total,signal) {
 return verifiedFiles.ensure(item,signal);
}
async function ensureBundleCached(left,right,background=false,signal){
 const unique=[...new Map([...left,...right].map(item=>[item.cacheUrl || item.url,item])).values()];
 cacheKeepUrls=new Set(unique.map(i=>i.cacheUrl || i.url));
 const target=background?delivery.prefetch:delivery;
 Object.assign(target,{phase:'preparing',completed:0,total:unique.length,verified:0,legacy:0,error:''});
 if(!background)target.target=`왼쪽 ${left.length} · 오른쪽 ${right.length}`;
 for(let i=0;i<unique.length;i++){
  const result=await ensureCached(unique[i],i+1,unique.length,signal);
  target.completed++;result.verified?target.verified++:target.legacy++;
  state.bundleStatus=`검증 ${target.completed}/${target.total} · 원본 대조 ${target.verified} · 기존 파일 ${target.legacy}`;
  updateDebug();requestHealthReport();
 }
 target.phase='ready';target.fileName='';await pruneCache(unique.map(i=>i.cacheUrl || i.url));return true;
}

async function pruneCache(activeUrls=[]) {
  cacheKeepUrls=new Set(activeUrls)
  await makeCacheRoom(0,'')
  await updateCacheStatus()
}

async function makeCacheRoom(incomingBytes=0,incomingUrl='') {
  const cache=await getMediaCache(), keys=await cache.keys(),meta=loadMeta()
  const entries=[]
  for(const req of keys) {
    let bytes=Number(meta[req.url]?.bytes || 0)
    if(!bytes) {const res=await cache.match(req);bytes=Number(res?.headers.get('content-length') || 0)}
    entries.push({url:req.url,bytes,used:meta[req.url]?.lastUsed || 0})
  }
  let bytes=entries.reduce((n,e)=>n+e.bytes,0),count=entries.length
  let budget=LVRuntime.clamp(CONFIG.cacheBudgetMB,128,8192,1024)*1024*1024
  try {
    const estimate=await navigator.storage?.estimate?.()
    if(estimate?.quota) budget=Math.min(budget,Math.max(0,estimate.quota*.8-(estimate.usage || 0)+bytes))
  }catch(_){}
  const active=new Set([...cacheKeepUrls,...state.leftItems.map(i=>i.cacheUrl || i.url),...state.rightItems.map(i=>i.cacheUrl || i.url)])
  const previous=bundleJournal.read()?.previous;
  if(previous)for(const item of [...previous.left,...previous.right])active.add(item.cacheUrl || item.url);
  if(delivery.prefetch?.phase==='ready'){const group=Object.values(state.playlistGroups || {}).find(g=>(g.name || g.key)===delivery.prefetch.group);if(group)for(const item of normalizeItems(group.left))active.add(item.cacheUrl || item.url);}
  if(incomingUrl) active.add(incomingUrl)
  for(const entry of entries.sort((a,b)=>a.used-b.used)) {
    if(bytes+incomingBytes<=budget && count<CONFIG.cacheMax) break
    if(active.has(entry.url)) continue
    await cache.delete(entry.url);bytes-=entry.bytes;count--;delete meta[entry.url]
  }
  saveMeta(meta)
  if(incomingBytes>0 && bytes+incomingBytes>budget) throw createPlayerError('LV-CACHE-CAPACITY','저장 공간 부족: 기존 정상 재생목록 유지')
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
    Object.keys(STORAGE)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => STORAGE.removeItem(key))
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
    STORAGE.removeItem(META_KEY)
    STORAGE.removeItem(PLAYLIST_KEY)
    STORAGE.removeItem(bundleJournal.key)
    STORAGE.removeItem(SCHEDULE_KEY)
    verifiedFiles.checked.clear()
  } catch (error) {}

  state.cacheStatus = 'cleared'
  state.bundleStatus = 'cleared'
  updateDebug()
}

async function hardRefreshFromCms(commandName='refresh') {
  if(commandName !== 'refresh') await clearPlaybackCaches()
  reportPlayerError('LV-COMMAND-RELOAD',commandName === 'refresh' ? '캐시를 보존하고 Player 재시작' : '캐시 삭제 후 Player 재시작',{command:commandName},'info',0)
  setTimeout(()=>location.reload(),500)
}

async function clearMediaCache() {
  await clearPlaybackCaches()
  setStatus('미디어 캐시를 삭제했습니다')
}

async function getCachedBlobUrl(item,signal){
 const result=await ensureCached(item,1,1,signal);
 if(signal?.aborted)throw Object.assign(new Error('cancelled'),{name:'AbortError'});
 return URL.createObjectURL(result.blob);
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
    if (error.status !== 404) throw error
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
  try { return STORAGE.getItem(getSeenNoticeStorageKey(noticeKey)) === '1' } catch { return false }
}

function markNoticeSeen(noticeKey) {
  if (!noticeKey) return
  try { STORAGE.setItem(getSeenNoticeStorageKey(noticeKey), '1') } catch {}
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
  state.noticeGeneration++
  state.noticeLoadController?.abort();state.noticeLoadController=null
  if(state.noticeTimer) clearTimeout(state.noticeTimer)
  if(state.noticeMonitor) clearInterval(state.noticeMonitor)
  state.noticeTimer=null;state.noticeMonitor=null
  const overlay=document.getElementById('noticeOverlay')
  if(overlay) {
    overlay.querySelectorAll('video').forEach(v=>{v.onended=null;v.onerror=null;try{v.pause();v.removeAttribute('src');v.load()}catch(_){}})
    overlay.classList.remove('is-active');overlay.replaceChildren()
  }
  if(state.noticeObjectUrl) URL.revokeObjectURL(state.noticeObjectUrl)
  state.noticeObjectUrl='';state.noticeVisible=false;state.activeNoticeId=''
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
  try { return STORAGE.getItem(getSeenNoticeStorageKey(noticeKey)) || '' } catch { return '' }
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
    if (mode === 'daily') STORAGE.setItem(getSeenNoticeStorageKey(noticeKey), getKstDateKey())
    else if (mode === 'interval') STORAGE.setItem(getSeenNoticeStorageKey(noticeKey), String(Date.now()))
    else STORAGE.setItem(getSeenNoticeStorageKey(noticeKey), '1')
  } catch {}
}

function setMainPlaybackPaused(paused) {
  for(const side of ['left','right']) paused ? lanes[side].pause('notice') : lanes[side].resume('notice')
}

async function showNoticeOverlay(notice,reason='poll') {
  if(!notice) return hideNoticeOverlay()
  const noticeKey=getNoticeKey(notice)
  if(state.activeNoticeId===noticeKey && state.noticeVisible) return
  if(!shouldShowNoticeNow(notice,noticeKey,reason)) return
  hideNoticeOverlay()
  const token=++state.noticeGeneration,overlay=getNoticeOverlay()
  state.activeNoticeId=noticeKey;state.noticeVisible=true;setMainPlaybackPaused(true)
  state.noticeLoadController=new AbortController()
  const current=()=>token===state.noticeGeneration && state.noticeVisible
  const fail=error=>{if(!current()) return;reportPlayerError('LV-NOTICE-PLAY-FAIL',error?.message || '공지 재생 실패',{noticeId:notice.id,title:notice.title},'error');hideNoticeOverlay()}
  state.noticeTimer=setTimeout(()=>fail(new Error('공지 준비 시간 초과')),90000)
  const revealed=()=>{
    if(!current()) return
    if(state.noticeTimer) clearTimeout(state.noticeTimer)
    state.noticeTimer=null;overlay.classList.add('is-active');markNoticeShown(notice,noticeKey)
    if(notice.priority!=='urgent' && getNoticeRepeatMode(notice)!=='always') state.noticeTimer=setTimeout(()=>{if(current())hideNoticeOverlay()},notice.durationSec*1000)
  }
  try {
    if(notice.type==='image' || notice.type==='video') {
      const item={...notice,url:notice.mediaUrl,cacheUrl:makeMediaFetchUrl(notice.mediaUrl),type:notice.type}
      const src=await getCachedBlobUrl(item,state.noticeLoadController.signal)
      if(!current()){URL.revokeObjectURL(src);return}
      state.noticeObjectUrl=src
      const stage=document.createElement('div');stage.className='notice-stage';overlay.replaceChildren(stage)
      const media=document.createElement(notice.type==='video'?'video':'img')
      media.className=`notice-media ${CONFIG.fit==='contain'?'contain':''}`;stage.appendChild(media)
      if(notice.type==='image') {media.onload=revealed;media.onerror=()=>fail(new Error('공지 이미지 표시 실패'));media.src=src}
      else {
        media.muted=true;media.defaultMuted=true;media.playsInline=true;media.preload='auto'
        media.onerror=()=>fail(new Error(media.error?.message || '공지 영상 표시 실패'))
        media.onended=()=>{
          if(!current())return
          if(notice.priority==='urgent' || getNoticeRepeatMode(notice)==='always'){media.currentTime=0;media.play().catch(fail)}else hideNoticeOverlay()
        }
        media.src=src;media.load();await media.play();if(!current())return;revealed()
        let position=Number(media.currentTime),progressAt=Date.now()
        state.noticeMonitor=setInterval(()=>{if(!current())return;const pos=Number(media.currentTime);if(pos!==position){position=pos;progressAt=Date.now()}else if(Date.now()-progressAt>15000)fail(new Error('공지 영상 진행 정지'))},1000)
      }
    } else {overlay.innerHTML=noticeTextMarkup(notice);revealed()}
  }catch(error){fail(error)}
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
  if(prefetchBusy){prefetchController?.abort();if(prefetchWork)await prefetchWork;}
  if (state.isSyncing || state.scheduleApplying || prefetchBusy) return
  state.isSyncing = true
  const oldSchedule=scheduleSnapshot()
  try {
    setStatus('CMS 재생목록 확인중...')
    const data = await fetchPlayerState(reason)
    if (data?.blackMode || data?.blackModeState) {
      const bm = data.blackModeState || data.blackMode
      setBlackMode(Boolean(bm.blackMode || bm.active), bm.reason || 'off', bm)
    }

    const commandHandled = await handleRemoteCommand(data.devices || [], data.command)
    if (commandHandled) return
    // 공지 확인은 /api/notice-active 경량 API가 담당합니다.

    const resolved = await resolvePlaylistsFromConfig(data)
    const nextLeft = normalizeItems(resolved.left)
    const nextRight = normalizeItems(resolved.right)

    if (!nextLeft.length && !nextRight.length) {
      throw createPlayerError('LV-PLAYLIST-EMPTY', '재생 가능한 playlist가 없습니다.')
    }

    const beforeCounts = { left: state.leftItems.length, right: state.rightItems.length }
    const afterCounts = { left: nextLeft.length, right: nextRight.length }
    const changed = bundleSignature(nextLeft, nextRight) !== bundleSignature(state.leftItems, state.rightItems)

    await reportPlayerError(
      changed ? 'LV-PLAYLIST-CHANGED' : 'LV-PLAYLIST-CHECK',
      changed
        ? `재생목록 변경 감지: left ${beforeCounts.left}→${afterCounts.left}, right ${beforeCounts.right}→${afterCounts.right}`
        : `재생목록 확인 완료: left ${afterCounts.left}, right ${afterCounts.right}`,
      {
        reason,
        beforeCounts,
        afterCounts,
        playlistVersion: data?.playlistVersion || '',
        stateVersion: data?.stateVersion || '',
        source: data?.source || '',
        contentReflect: data?.contentReflect || null,
        scheduleStatus: state.scheduleStatus || '',
        activePlaylistKey: state.activePlaylistKey || '',
      },
      changed ? 'info' : 'debug',
      changed ? 60000 : 30 * 60 * 1000
    )

    if (!changed && state.leftItems.length + state.rightItems.length > 0) {
      state.lastSync = kstString()
      saveScheduleBundle(state.rightItems)
      const old=bundleJournal.read()?.active
      if(old && JSON.stringify(old.schedule)!==JSON.stringify(scheduleSnapshot()))bundleJournal.commit({...old,schedule:scheduleSnapshot()})
      state.bundleStatus = '변경 없음'
      setStatus('CMS 확인 완료: 변경 없음')
      updateDebug()
      return
    }

    await ensureBundleCached(nextLeft, nextRight)

    const selectedNow=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey).group
    if(selectedNow && playlistSignature(normalizeItems(selectedNow.left))!==playlistSignature(nextLeft))throw createPlayerError('LV-SCHEDULE-CHANGED','파일 준비 중 시간대 변경: 다음 확인에서 다시 적용')
    commitPrepared(nextLeft,nextRight)
    markGoodConfig()
    hideErrorScreen()

    await reportPlayerError('LV-PLAYLIST-APPLIED', `새 재생목록 적용 완료: left ${nextLeft.length}, right ${nextRight.length}`, {
      reason,
      leftCount: nextLeft.length,
      rightCount: nextRight.length,
      playlistVersion: data?.playlistVersion || '',
      stateVersion: data?.stateVersion || '',
      source: data?.source || '',
      scheduleStatus: state.scheduleStatus || '',
      activePlaylistKey: state.activePlaylistKey || '',
    }, 'info', 60000)
    await flushQueuedPlayerErrors('after-playlist-applied')

    state.lastSync = kstString()
    setStatus('새 재생목록 적용 완료')
    updateDebug()
  } catch (error) {
    restoreSchedule(oldSchedule)
    delivery.phase='blocked';delivery.error=error.message;requestHealthReport()
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
    queuePrefetch()
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
  const handled = STORAGE.getItem(handledCommandKey)
  const commandKey = `${command}:${commandAt}`

  // 이전 버전은 commandAt만 저장했으므로, 이전 저장값도 함께 중복 처리합니다.
  if (handled === commandKey || handled === commandAt) return false

  recordCommandResult(command,commandAt,'received')

  const hardRefreshCommands = new Set(['refresh', 'hard_refresh', 'clear_cache_refresh', 'cache_refresh'])
  const noticeCommands = new Set(['notice_refresh', 'notice', 'reload_notice'])

  if (hardRefreshCommands.has(command)) {
    STORAGE.setItem(handledCommandKey, commandKey)
    recordCommandResult(command,commandAt,'accepted-restart')
    await hardRefreshFromCms(command)
    return true
  }

  if (noticeCommands.has(command)) {
    STORAGE.setItem(handledCommandKey, commandKey)
    setStatus('CMS 공지 명령 수신: 공지 확인중')
    await checkNotice('remote-command')
    recordCommandResult(command,commandAt,'completed')
    await syncConfig('notice-command')
    return true
  }

  if (command === 'screenshot' || command === 'capture') {
    if (window.LocalVisionNative?.captureScreenshot) {
      STORAGE.setItem(handledCommandKey, commandKey)
      setStatus('CMS 화면 캡처 명령 수신: APP Shell에 캡처 요청')
      try {
        recordCommandResult(command,commandAt,'native-requested')
        window.LocalVisionNative.captureScreenshot(JSON.stringify({
          command, commandAt, store: CONFIG.store, id: CONFIG.appId, source: PLAYER_BUILD, at: nowUtcIso(),
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
    STORAGE.setItem(handledCommandKey, commandKey)
    recordCommandResult(command,commandAt,'native-requested')
    window.LocalVisionNative.clearWebViewCache(JSON.stringify({ command, commandAt, store: CONFIG.store, id: CONFIG.appId }))
    return true
  }

  if (command === 'reload_app' && window.LocalVisionNative?.reloadApp) {
    STORAGE.setItem(handledCommandKey, commandKey)
    recordCommandResult(command,commandAt,'native-requested')
    window.LocalVisionNative.reloadApp(JSON.stringify({ command, commandAt, store: CONFIG.store, id: CONFIG.appId }))
    return true
  }

  return false
}

function recordCommandResult(command,commandAt,status) {
  const result={command,commandAt,status,reportedAt:nowUtcIso(),sessionId:SESSION_ID}
  try{STORAGE.setItem('lv-last-command-result',JSON.stringify(result))}catch(_){}
  reportPlayerError('LV-COMMAND-RESULT',`원격 명령 ${status}`,result,'info',0);requestHealthReport()
}

async function checkRemoteCommand() {
  return runExclusive('command',async()=>{
    if(!CONFIG.apiBase || !CONFIG.store) return
    try {const data=await fetchLiteEndpoint('/api/player-command','command');await handleRemoteCommand(data.device?[data.device]:(data.devices || []),data.command)}
    catch(error){if(error.status===404){const data=await fetchPlayerState('command-fallback');await handleRemoteCommand(data.devices || [],data.command)}else reportPlayerError('LV-COMMAND-CHECK-FAILED',error.message,{},'warning',600000)}
  })
}

async function sendHeartbeat() {
  return runExclusive('heartbeat',async()=>{
    if(!CONFIG.apiBase || !CONFIG.store) return
    const health=healthPayload(),now=nowUtcIso()
    const body={id:CONFIG.appId || CONFIG.deviceId,appId:CONFIG.appId,deviceId:CONFIG.deviceId,store:CONFIG.store,source:'player',role:'player',online:true,lastSeen:now,
      playerVersion:PLAYER_BUILD,appShell:Boolean(CONFIG.appShell || CONFIG.appVersion),appVersion:CONFIG.appVersion,
      playStatus:state.blackModeActive?'black-mode':state.noticeVisible?'notice':([health.left,health.right].every(x=>['playing','image','empty'].includes(x.status))?'playing':'degraded'),
      currentContent:health.left.fileName,errorCount:playbackMetrics.failed,health}
    try {
      let data
      try {data=await fetchJson(`${CONFIG.apiBase}/api/heartbeat`,{method:'POST',attempts:2,headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
      catch(error){if(error.status!==404)throw error;data=await fetchJson(`${CONFIG.apiBase}/api/player-state`,{method:'POST',attempts:1,headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
      state.lastHeartbeat=kstString();lastHealthSentAt=Date.now();flushQueuedPlayerErrors();updateDebug()
      if(!data.healthAccepted) requestHealthReport()
    }catch(error){reportPlayerError('LV-HEARTBEAT-FAILED',error.message,{store:CONFIG.store},'warning')}
  })
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

function startPlayback(side) { clearSideTimer(side);clearWatchdog(side);lanes[side].setPlaylist(getItems(side),getIndex(side)) }

function playItem(side,item) { lanes[side].play(item) }

function applyFit(element) {
  element.className = `media fade-in ${CONFIG.fit === 'contain' ? 'contain' : ''}`
}

function swapWhenReady(side, element, token) {
  if (token !== state.playToken[side]) return
  getZone(side).replaceChildren(element)
}

function playImage(side,item) {lanes[side].play(item)}

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

function playVideo(side,item) {lanes[side].play(item)}

function scheduleNext(side, durationSeconds) {
  setSideTimer(side, () => next(side), Math.max(3, Number(durationSeconds || 20)) * 1000)
}

function next(side) {lanes[side].next()}

async function checkPlayerBuildVersion(reason = 'poll') {
  if (!CONFIG.versionPollMs || state.versionReloadPending) return
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json().catch(() => null)
    const nextBuild = String(data?.build || '').trim()
    if (!nextBuild || nextBuild === PLAYER_BUILD) return
    state.versionReloadPending = true
    await reportPlayerError('LV-PLAYER-VERSION-RELOAD', `Player 새 버전 감지: ${PLAYER_BUILD} → ${nextBuild}`, { reason, currentBuild: PLAYER_BUILD, nextBuild }, 'info', 60 * 60 * 1000)
    const reload = () => location.reload()
    if (state.noticeVisible) {
      setStatus('새 Player 버전 감지: 공지 종료 후 새로고침 예정')
      setTimeout(reload, 30000)
    } else {
      setStatus('새 Player 버전 감지: 새로고침')
      setTimeout(reload, 1000)
    }
  } catch (error) {}
}

function setupPlayerBuildCheck() {
  if (!CONFIG.versionPollMs || CONFIG.versionPollMs <= 0) return
  setInterval(() => checkPlayerBuildVersion('version-interval'), CONFIG.versionPollMs)
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
  if(state.intervalsStarted)return
  state.intervalsStarted=true
  const interval=(name,ms,fn)=>{if(Number.isFinite(ms) && ms>0)setInterval(()=>runExclusive(name,fn).catch(e=>reportPlayerError('LV-BACKGROUND-TASK',e.message,{task:name},'warning')),Math.max(1000,ms))}
  interval('sync',CONFIG.playerStatePollMs,()=>syncConfig('player-state-interval'))
  interval('schedule',CONFIG.scheduleCheckMs,()=>applyLocalSchedule('schedule-interval'))
  interval('notice',CONFIG.noticePollMs,()=>checkNotice('notice-interval'))
  interval('black-mode',CONFIG.blackModePollMs,()=>checkBlackMode('black-mode-interval'))
  if(CONFIG.appId)interval('app-config',CONFIG.appConfigPollMs,()=>checkAppConfig('app-config-interval'))
  if(CONFIG.commandPollMs>0)setInterval(()=>checkRemoteCommand().catch(()=>{}),Math.max(1000,CONFIG.commandPollMs))
  if(CONFIG.heartbeatMs>0)setInterval(()=>sendHeartbeat().catch(()=>{}),Math.max(1000,CONFIG.heartbeatMs))
  setInterval(updateDebug,2000)
}

function runImmediateApiBoot() {
  // Player URL 접속 즉시 1회 호출합니다.
  // 어떤 API가 실패해도 다른 API 호출과 재생/캐시 복구가 멈추지 않도록 전부 독립 실행합니다.
  if (CONFIG.appId) fireAndForget('app-config-startup', () => checkAppConfig('startup-immediate'))
  fireAndForget('player-state-startup', () => syncConfig('startup-immediate'))
  fireAndForget('black-mode-startup', () => checkBlackMode('startup-immediate'))
  if (CONFIG.noticePollMs > 0) fireAndForget('notice-startup', () => checkNotice('startup-immediate'))
  fireAndForget('heartbeat', () => sendHeartbeat())
  fireAndForget('command-startup', () => checkRemoteCommand())
  outbox.schedule(1000)
}

async function boot() {
  await registerServiceWorker()
  setupDebugToggle()
  setupDailyRestart()
  setupPlayerBuildCheck()
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
  loadSavedScheduleBundle()
  if (loadSavedBundle()) {
    await selectBootBundle()
    queuePrefetch()
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

document.addEventListener('visibilitychange',()=>{
  for(const side of ['left','right']) document.visibilityState==='hidden' ? lanes[side].pause('hidden') : lanes[side].resume('hidden')
  if(document.visibilityState==='visible'){outbox.schedule(1000);requestHealthReport()}
})
window.addEventListener('online',()=>{outbox.schedule(1000);checkRemoteCommand().catch(()=>{});sendHeartbeat().catch(()=>{})})
window.addEventListener('pageshow',event=>{if(event.persisted){startPlayback('left');startPlayback('right');requestHealthReport()}})
window.addEventListener('pagehide',()=>{for(const side of ['left','right'])lanes[side].stop();outbox.persist()})
boot().catch(error=>reportPlayerError('LV-BOOT-FAILED',error.message,{},'fatal'))
