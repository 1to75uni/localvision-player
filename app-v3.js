// All network scheduling is owned here. Native APP timers and bridge signatures are unchanged.
const V3_STORE_KEY=`lv-v3-publication-${CONFIG.store}`;
const faultLedger=new LVSync.FaultLedger(STORAGE,`lv-v3-faults-${CONFIG.deviceId}`);
const tombstones=new LVSync.Tombstones(STORAGE,`lv-v3-tombstones-${CONFIG.store}`);
const syncLease=new LVSync.Lease(STORAGE,`lv-v3-leader-${CONFIG.deviceId}`);
let publication=LVSync.read(STORAGE,V3_STORE_KEY,null),receivedVersion=publication?.version||'',appliedVersion=STORAGE.getItem(`lv-v3-applied-${CONFIG.store}`)||'';
let targetController=null,targetToken=0,targetBusy=false,targetRetryTimer=null,syncCoordinator=null,updateChecking=false;
let networkOwner=false,receiptSequence=0;

// Persist quarantine through Player restarts; another file's success cannot clear it.
for(const side of ['left','right']){
 const original=lanes[side].setPlaylist.bind(lanes[side]);
 lanes[side].setPlaylist=function(items,index=0){
  for(const item of items){const f=faultLedger.snapshot().find(f=>f.side===side&&f.assetId===item.id&&f.assetVersion===(item.assetVersion||item.integrity?.revision||item.r2Key||item.url)&&f.status!=='recovered');if(!f)continue;const key=this.key(item);this.failures.set(key,{count:Math.max(1,f.count),at:Date.now()});if(f.status==='excluded'&&!this.exclusions.has(key))this.exclusions.set(key,{itemId:item.id,fileName:item.fileName,side,retryAt:Math.max(Date.now()+1000,Number(f.retryAt)||Date.now()+60000),excludedAt:Date.parse(f.firstAt),failCount:f.count})}
  return original(items,index)
 }
}
let faultPageCursor=0;
function summaryV3(){
 const lane=side=>{const s=lanes[side].snapshot();return {status:s.status,fileName:s.fileName,itemId:s.itemId,currentTime:s.currentTime,reason:s.reason,lastCompletedAt:s.lastCompletedAt}};
 const all=faultLedger.snapshot(),faults=[];if(faultLedger.urgent)faults.push(faultLedger.urgent);for(let n=0;n<Math.min(50,all.length);n++){const f=all[(faultPageCursor+n)%all.length];if(!faults.includes(f))faults.push(f)}faultPageCursor=(faultPageCursor+50)%Math.max(1,all.length);faultLedger.urgent=null;
 return {playerVersion:PLAYER_BUILD,version:appliedVersion,pendingVersion:receivedVersion===appliedVersion?'':receivedVersion,left:lane('left'),right:lane('right'),faults,faultCount:all.filter(f=>f.status!=='recovered').length,criticalRevision:faultLedger.value.criticalRevision||0,faultPaging:{total:all.length},storageUnhealthy:!!(STORAGE.volatile||faultLedger.volatile),blackMode:state.blackModeActive,noticeActive:state.noticeVisible,delivery:{phase:delivery.phase,completed:delivery.completed,total:delivery.total,error:delivery.error},commandResult:readJsonStorage('lv-last-command-result',null)};
}
function persistCleanBackups(){
 const filter=b=>b&&({...b,left:tombstones.filter(b.left),right:tombstones.filter(b.right)});
 const journal=bundleJournal.read();
 const left=tombstones.filter(state.leftItems),right=tombstones.filter(state.rightItems);
 if(playlistSignature(left)!==playlistSignature(state.leftItems)){state.leftItems=left;startPlayback('left')}
 if(playlistSignature(right)!==playlistSignature(state.rightItems)){state.rightItems=right;startPlayback('right')}
 if(journal){journal.active=filter(journal.active);journal.previous=filter(journal.previous);if(STORAGE.getItem(bundleJournal.key)!==JSON.stringify(journal))LVSync.write(STORAGE,bundleJournal.key,journal)}
 const legacy=readJsonStorage(PLAYLIST_KEY,null);if(legacy){const clean=filter(legacy);if(JSON.stringify(clean)!==JSON.stringify(legacy))LVSync.write(STORAGE,PLAYLIST_KEY,clean);}
 for(const group of Object.values(state.playlistGroups))group.left=tombstones.filter(group.left);
 state.leftItems=tombstones.filter(state.leftItems);state.rightItems=tombstones.filter(state.rightItems);saveScheduleBundle(state.rightItems);
}
function faultInput(extra){return {...extra,assetId:extra.itemId,assetVersion:extra.assetVersion||extra.sourceUrl};}
reportPlayerError=async function(code,message,extra={},level='error',minMs=60000){
 let priority=false;
 if(extra.side && extra.itemId){
  if(code==='LV-MEDIA-SESSION-SKIP')priority=faultLedger.exclude(faultInput(extra));
  else if(code==='LV-MEDIA-RECOVERED')priority=faultLedger.recover(faultInput(extra));
  else if(level==='error')priority=faultLedger.failure(faultInput(extra));
 }
 // Non-media messages remain bounded samples, never an independent HTTP outbox.
 if(!extra.itemId && level!=='debug')outbox.enqueue({id:LVRuntime.uid(),errorCode:code,message:String(message).slice(0,500),level,time:nowUtcIso(),extra});
 if(priority)syncCoordinator?.wake(true);
};
requestHealthReport=function(){ /* Latest state is sent by the coordinator; frame changes do not create network timers. */ };
sendHealthReport=async function(){syncCoordinator?.wake(true)};
sendHeartbeat=async function(){syncCoordinator?.wake(false)};
flushQueuedPlayerErrors=function(){return true};
scheduleCmsRecovery=function(){ /* Coordinator owns the only network retry timer. */ };
setupPlayerBuildCheck=function(){ /* Release version is received in player-sync. */ };
checkRemoteCommand=async function(){return false};
syncConfig=async function(){syncCoordinator?.wake(false)};
hardRefreshFromCms=async function(command='refresh'){
 if(['clear_cache_refresh','cache_refresh'].includes(command))await clearPlaybackCaches();
 // Refresh and version updates must preserve healthy media. Explicit clear commands retain their existing meaning.
 setTimeout(()=>location.reload(),1000);
};
const originalRecordCommand=recordCommandResult;
recordCommandResult=function(command,commandAt,status){originalRecordCommand(command,commandAt,status);const row=readJsonStorage('lv-last-command-result',{});row.id=`${command}:${commandAt}`;LVSync.write(STORAGE,'lv-last-command-result',row);syncCoordinator?.wake(true)};

const originalLoadSaved=loadSavedBundle;
loadSavedBundle=function(){const result=originalLoadSaved();persistCleanBackups();return result};
selectBootBundle=async function(){
 const saved=bundleJournal.read()?.active;if(!saved)return;
 const cache=await getMediaCache(),ready=async items=>{const result=[];for(const i of tombstones.filter(items))if(await cache.match(i.cacheUrl||i.url))result.push(i);return result};
 // Missing files in one lane do not prevent the other lane from starting.
 state.leftItems=await ready(saved.left);state.rightItems=await ready(saved.right);restoreSchedule(saved.schedule);persistCleanBackups();
};
const originalGetBlob=getCachedBlobUrl;
getCachedBlobUrl=async function(item,signal){if(!tombstones.allows(item))throw createPlayerError('LV-ASSET-DELETED','삭제 콘텐츠');return originalGetBlob(item,signal)};

function publishedNotice(){
 const now=new Date().toISOString();
 const rows=(publication?.common.notices||[]).filter(n=>(n.store===CONFIG.store||n.store==='_all')&&Number(n.is_active)===1&&(!n.start_at||n.start_at<=now)&&(!n.end_at||n.end_at>=now));
 rows.sort((a,b)=>(a.priority==='urgent'?-1:0)-(b.priority==='urgent'?-1:0)||String(b.updated_at).localeCompare(String(a.updated_at)));
 const n=rows[0];return n?normalizeNotice({...n,mediaUrl:n.media_url,linkUrl:n.link_url,fileName:n.file_name,r2Key:n.r2_key,startAt:n.start_at,endAt:n.end_at,displayMode:n.display_mode,durationSec:n.duration_sec,repeatMode:n.repeat_mode,repeatIntervalMin:n.repeat_interval_min,updatedAt:n.updated_at}):null;
}
fetchActiveNotice=async function(){return publishedNotice()};
checkBlackMode=async function(){if(!publication)return;const row=publication.store.black||{};setBlackMode(!publication.store.active || LVSync.blackActive(row),'local',row)};
const originalNormalize=normalizeItems;
normalizeItems=function(items){return originalNormalize(tombstones.filter(items))};
function targetLists(){
 if(!publication)return null;
 captureSchedulePayload(publication.store);
 for(const group of Object.values(state.playlistGroups))group.left=tombstones.filter(group.left);
 const selected=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey);
 state.activePlaylistKey=selected.group?.key||'default';
 const left=normalizeItems(selected.group?.left||publication.store.playlists.left);
 const right=normalizeItems((publication.common.right||[]).filter(i=>LVSync.rightAllowed(i,CONFIG.store)));
 return {left,right};
}
function fairOrder(left,right){const out=[];for(let i=0;i<Math.max(left.length,right.length);i++){if(left[i])out.push(left[i]);if(right[i])out.push(right[i])}return out;}
async function prepareLatest(){
 if(!publication)return;
 clearTimeout(targetRetryTimer);targetController?.abort();prefetchController?.abort();clearTimeout(prefetchTimer);
 const controller=targetController=new AbortController(),token=++targetToken,version=publication.version,lists=targetLists();targetBusy=true;
 const valid=()=>token===targetToken&&!controller.signal.aborted;
 const id=i=>`${i.assetId||i.id}:${i.assetVersion||i.integrity?.revision||i.url}`;
 const wanted=new Set([...lists.left,...lists.right].map(id));
 cacheKeepUrls=new Set([...lists.left,...lists.right,...Object.values(state.playlistGroups).flatMap(g=>normalizeItems(g.left))].map(i=>i.cacheUrl||i.url));
 const cache=await getMediaCache(),readyKeys=new Set(),failed=[];
 const apply=()=>{
  if(!valid())return;
  const ready=(side)=>lists[side].filter(i=>readyKeys.has(id(i))&&tombstones.allows(i));
  // Continue still-authorized old files until replacements are ready. Removed items never remain eligible.
  const left=ready('left'),right=ready('right');
  commitPrepared(left.length?left:state.leftItems.filter(i=>wanted.has(id(i))&&tombstones.allows(i)),right.length?right:state.rightItems.filter(i=>wanted.has(id(i))&&tombstones.allows(i)));
 };
 try{
  for(const item of [...lists.left,...lists.right]){if(!valid())return;if(await cache.match(item.cacheUrl||item.url))readyKeys.add(id(item))}
  apply(); // Reorder/delete uses only existing bytes, with no network download.
  delivery.phase='preparing';delivery.total=lists.left.length+lists.right.length;delivery.completed=readyKeys.size;
  for(const item of fairOrder(lists.left,lists.right)){
   if(!valid())return;if(readyKeys.has(id(item)))continue;
   try{await ensureCached(item,1,1,controller.signal);if(!valid()||!tombstones.allows(item))return;readyKeys.add(id(item));delivery.completed=readyKeys.size;apply()}
   catch(e){if(!valid())return;failed.push(item);const side=lists.right.includes(item)?'right':'left';await reportPlayerError(e.code||'LV-DOWNLOAD-FAILED',e.message,{side,itemId:item.id,fileName:item.fileName,assetVersion:item.assetVersion,sourceUrl:item.url,attemptId:`download-${token}-${item.id}`},'error')}
  }
  if(!valid())return;
  if(failed.length){delivery.phase='blocked';delivery.error=`준비 실패 ${failed.length}개 · 준비된 파일 계속 재생`;targetRetryTimer=setTimeout(()=>prepareLatest().catch(e=>setStatus(e.message)),300000)}
  else {appliedVersion=version;STORAGE.setItem(`lv-v3-applied-${CONFIG.store}`,version);delivery.phase='applied';delivery.error='';syncCoordinator?.wake(true)}
  hideErrorScreen();markGoodConfig();checkBlackMode();checkNotice('startup');updateDebug();
 }finally{if(valid())targetBusy=false;queuePrefetch()}
}
queuePrefetch=function(){clearTimeout(prefetchTimer);if(targetBusy || !publication)return;prefetchTimer=setTimeout(()=>prefetchUpcoming().catch(()=>{}),3000)};
const originalLocalSchedule=applyLocalSchedule;
applyLocalSchedule=async function(){
 if(!publication)return originalLocalSchedule('local');
 const next=selectScheduledGroup(state.playlistGroups,state.playlistSchedules,state.defaultPlaylistKey).group?.key||'default';
 if(next!==state.activePlaylistKey){await prepareLatest()}
};
async function receiveSync(result){
 const receipt=++receiptSequence;
 state.lastSync=kstString();state.lastHeartbeat=state.lastSync;lastCmsError=null;
 if(result.pendingFaultPages)syncCoordinator?.wake(true);
 if(result.changed&&result.manifests){
  const load=path=>LVRuntime.timedFetch(new URL(path,CONFIG.apiBase).href,{cache:'no-store'},15000,r=>LVApiResponse.read(r,new URL(path,CONFIG.apiBase).href));
  const [store,common]=await Promise.all([result.manifests.store?load(result.manifests.store):publication?.store,result.manifests.common?load(result.manifests.common):publication?.common]);
  if(receipt!==receiptSequence)return;
  if(store?.schema!==3||common?.schema!==3||`${store.revision}:${common.revision}`!==result.version||store.store!==CONFIG.store)throw new Error('Manifest identity mismatch');
  tombstones.merge(common.tombstones);persistCleanBackups();
  const next={version:result.version,store,common};LVSync.write(STORAGE,V3_STORE_KEY,next);publication=next;receivedVersion=result.version;
  // Metadata/network polling does not wait for large file downloads.
  prepareLatest().catch(e=>{delivery.phase='blocked';delivery.error=e.message;setStatus(e.message)});
 }
 if(result.command)await handleRemoteCommand([{...result.command,store:CONFIG.store,lastCommand:result.command.command}],result.command);
 if(result.release!==PLAYER_BUILD.replace(/^v/,''))await requestReleaseUpdate(result.release);
 updateDebug();
}
async function requestReleaseUpdate(release){
 if(updateChecking || !('serviceWorker' in navigator))return;updateChecking=true;
 try{const key=`lv-release-attempt-${release}`,last=Number(STORAGE.getItem(key)||0);if(Date.now()-last<3600000)return;STORAGE.setItem(key,String(Date.now()));const reg=await navigator.serviceWorker.getRegistration();await reg?.update();}
 catch(e){setStatus('Player 업데이트 확인 지연 · 현재 방송 유지')}
 finally{updateChecking=false}
}
startOperationIntervals=function(){
 if(state.intervalsStarted)return;state.intervalsStarted=true;
 // These timers evaluate locally and make no CMS calls.
 setInterval(()=>{applyLocalSchedule().catch(()=>{});checkBlackMode().catch(()=>{});checkNotice('local').catch(()=>{})},30000);
 setInterval(updateDebug,2000);
};
runImmediateApiBoot=function(){
 if(!CONFIG.apiBase)return;
 if(!CONFIG.store){if(CONFIG.appId)checkAppConfig('initial-id-resolution').catch(()=>{});return;}
 if(!syncLease.acquire()){setStatus('다른 Player 창이 서버 확인 담당 · 이 창은 캐시 재생');return;}
 networkOwner=true;
 syncCoordinator=new LVSync.Coordinator({storage:STORAGE,key:`lv-v3-session-${CONFIG.deviceId}`,
  packet:()=>({installation:CONFIG.deviceId,store:CONFIG.store,version:receivedVersion,stateRevision:faultLedger.value.revision,summary:summaryV3(),samples:[...faultLedger.value.samples,...outbox.items].slice(0,10)}),
  // JSON data in a CORS-safelisted envelope avoids an extra OPTIONS request every five minutes.
  send:packet=>LVRuntime.timedFetch(`${CONFIG.apiBase}/api/player-sync`,{method:'POST',cache:'no-store',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify(packet)},15000,async response=>{if(response.status===409){const b=await response.json();throw Object.assign(new Error(b.error),{response:b})}return LVApiResponse.read(response,`${CONFIG.apiBase}/api/player-sync`)}),
  success:(r)=>{receiveSync(r).catch(e=>{setStatus(`편성 확인 지연: ${e.message}`);receivedVersion='';syncCoordinator?.wake(false)})},
  ack:ids=>{faultLedger.acknowledge(ids);outbox.items=outbox.items.filter(x=>!ids.includes(x.id));outbox.persist()},
  failure:e=>{lastCmsError={code:e.code||'LV-SYNC-DOWN',message:e.message};setStatus('서버 확인 지연 · 저장된 방송 계속 재생')},
  sessionConflict:()=>{networkOwner=false;setStatus('다른 Player 세션 활성 · 현재 캐시 재생 유지')}
 });
 syncLease.start(()=>{networkOwner=false;syncCoordinator.stop()});syncCoordinator.start();
 if(publication)prepareLatest().catch(e=>setStatus(e.message));
};
// A fully installed new service worker is the only trigger for a version reload.
if('serviceWorker' in navigator){let reloadOnce=false;const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadController||reloadOnce)return;reloadOnce=true;setTimeout(()=>location.reload(),state.noticeVisible?30000:1000)})}
window.addEventListener('online',()=>syncCoordinator?.wake(false));
window.addEventListener('pagehide',()=>{syncCoordinator?.stop();syncLease.release();faultLedger.persist();targetController?.abort()});
boot().catch(error=>reportPlayerError('LV-BOOT-FAILED',error.message,{},'fatal'));
