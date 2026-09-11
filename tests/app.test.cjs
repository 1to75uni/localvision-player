const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./harness.cjs');
function integrated(options={}) {
  const h=setup(),ctx=h.ctx,nodes=new Map(),listeners={},cacheSets=options.cacheSets || new Map(),calls=[];
  const noop=()=>{};
  class Node extends h.Element {
    constructor(tag){super(tag);this.classList={add:noop,remove:noop,toggle:noop};this.dataset={};this.hidden=false;this.textContent='';this.innerHTML='';}
    appendChild(el){this.children.push(el);if(el.id)nodes.set(el.id,el);return el;}
    addEventListener(){} querySelectorAll(tag){return this.children.filter(e=>e.tag===tag || e.tag==='div').flatMap(e=>e.tag===tag?[e]:e.querySelectorAll?.(tag)||[]);}
    querySelector(tag){return this.children.find(e=>e.className===tag.replace('.','')) || null;}
  }
  const initial=['leftZone','rightZone','statusPill','debugPanel','reloadBtn','syncBtn','clearCacheBtn','dbgStore','dbgDevice','dbgApi','dbgLeft','dbgRight','dbgSync','dbgHeartbeat','dbgBundle','dbgCache','dbgStatus'];
  initial.forEach(id=>{const n=new Node('div');n.id=id;nodes.set(id,n);});
  ctx.document={visibilityState:'visible',getElementById:id=>nodes.get(id)||null,createElement:tag=>new Node(tag),head:new Node('head'),body:new Node('body'),addEventListener:(n,fn)=>listeners[n]=fn};
  if(options.storage)for(const [k,v] of options.storage)h.storage.set(k,v);
  h.localStorage.removeItem=k=>h.storage.delete(k);
  ctx.localStorage=h.localStorage;
  ctx.location={search:'?store=qa&apiBase=https://cms.test&heartbeat=10000&commandPoll=5000&noticePoll=10000&blackModePoll=10000&playerStatePoll=10000&versionPoll=0',href:'https://player.test/?store=qa',reload:()=>{h.reloads=(h.reloads || 0)+1}};
  ctx.URL=URL;ctx.URLSearchParams=URLSearchParams;ctx.navigator={onLine:true,userAgent:'QA'};ctx.addEventListener=(n,fn)=>listeners[n]=fn;
  ctx.setInterval=(fn,ms)=>{let id;const repeat=()=>{fn();id=h.timer(repeat,ms)};id=h.timer(repeat,ms);return id};ctx.clearInterval=ctx.clearTimeout;
  ctx.caches={async open(name){if(!cacheSets.has(name))cacheSets.set(name,new Map());const set=cacheSets.get(name);return {async match(url){return set.get(url.url || url)?.clone()},async put(url,response){set.set(url.url || url,response.clone())},async delete(url){return set.delete(url.url || url)},async keys(){return [...set.keys()].map(url=>({url}))}}},async keys(){return [...cacheSets.keys()]},async delete(name){return cacheSets.delete(name)}};
  const item=(side,id=side)=>({id,side,type:'video',url:`https://cdn.test/${id}.mp4`,fileName:`${id}.mp4`,status:'사용중',title:id,duration:4});
  h.manifest={ok:true,devices:[{id:'tv_qa',store:'qa'}],playlists:{left:[item('left')],right:[item('right')]}};
  h.notice=null;h.blackMode=false;h.command=null;h.offline=Boolean(options.offline);h.logFailure=false;
  ctx.fetch=async(url,init={})=>{
    const u=new URL(url,'https://player.test');calls.push({path:u.pathname,init});
    if(h.offline)throw new Error('offline');
    if(h.quota && u.pathname.startsWith('/api/'))return new Response(JSON.stringify({ok:false,errorCode:'LV-D1-QUOTA',error:'D1 exceeded daily row write limit',retryAfterSec:900}),{status:503});
    if(u.hostname==='cdn.test')return new Response('media',{headers:{'content-type':'video/mp4','content-length':'5'}});
    let body={ok:true};
    if(u.pathname==='/api/player-state')body=h.manifest;
    if(u.pathname==='/api/player-command')body={ok:true,device:{id:'tv_qa',store:'qa'},command:h.command};
    if(u.pathname==='/api/notice-active')body={ok:true,notice:h.notice};
    if(u.pathname==='/api/black-mode')body={ok:true,mode:{active:h.blackMode,reason:h.blackMode?'test':'off'}};
    if(u.pathname==='/api/player-control')body={ok:true,command:{ok:true,device:{id:'tv_qa',store:'qa'},command:h.command},notice:{ok:true,notice:h.notice},black:{ok:true,mode:{active:h.blackMode,reason:h.blackMode?'test':'off'}}};
    if(u.pathname==='/api/heartbeat')body={ok:true,healthAccepted:true};
    if(u.pathname==='/api/player-errors')body=h.logFailure?{ok:true,degraded:true,saved:0}:{ok:true,acknowledged:JSON.parse(init.body).errors.map(e=>e.id)};
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  ctx.scheduler={yield:()=>new Promise(setImmediate)};ctx.crypto=require('node:crypto').webcrypto;ctx.TextEncoder=TextEncoder;ctx.Blob=Blob;ctx.Response=Response;
  for(const file of ['integrity.js','playlist-store.js','free-budget.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),ctx);
  let app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  // Accelerate legacy playback regressions only; free100 profile is tested without overrides below.
  if(!options.productionProfile)app=app.replace('boot().catch',"Object.assign(CONFIG,{heartbeatMs:10000,commandPollMs:5000,noticePollMs:10000,blackModePollMs:10000,playerStatePollMs:10000});boot().catch");
  const run=code=>vm.runInContext(code,ctx);
  vm.runInContext(app,ctx,{filename:'app.js'});
  const advance=async ms=>{await new Promise(setImmediate);for(let n=0;n<ms;n+=100){await h.tick(Math.min(100,ms-n));await new Promise(resolve=>setTimeout(resolve,1));}};
  return {...h,calls,cacheSets,nodes,listeners,run,advance,controller:h};
}
test('full Player boot loads both playlists, caches media and sends truthful health',async()=>{
  const h=integrated();await h.advance(6000);
  assert.equal(h.run('lanes.left.phase'),'playing');assert.equal(h.run('lanes.right.phase'),'playing');
  assert.ok(h.calls.some(c=>c.path==='/api/heartbeat'));
  assert.equal(h.run('outbox.items.some(e=>e.errorCode==="LV-BOOT-FAILED")'),false);
  assert.equal(h.run('readQueuedPlayerErrors().filter(e=>e.level==="error").length'),0);
});
test('command poll is active and ordinary refresh preserves media cache',async()=>{
  const h=integrated();await h.advance(6000);
  assert.ok(h.calls.filter(c=>c.path==='/api/player-control').length>=2);
  h.controller.command={command:'refresh',commandAt:'2026-09-09T00:00:00Z'};await h.advance(6000);
  assert.equal(h.controller.reloads,1);
  assert.ok([...h.cacheSets.values()].some(m=>m.has('https://cdn.test/left.mp4')));
});
test('notice and black mode share suspension ownership and resume both sides',async()=>{
  const h=integrated();await h.advance(3000);
  await h.run("showNoticeOverlay({id:'n',type:'image',mediaUrl:'https://cdn.test/n.jpg',durationSec:5,repeatMode:'once'},'remote-command')");
  h.run("setBlackMode(true,'test')");await h.advance(1000);
  assert.equal(h.run('lanes.left.phase'),'paused');h.run('hideNoticeOverlay()');assert.equal(h.run('lanes.right.phase'),'paused');
  h.run("setBlackMode(false,'off')");await h.advance(3000);assert.equal(h.run('lanes.left.phase'),'playing');
});
test('log storage rejection retains logs while playback continues',async()=>{
  const h=integrated();h.controller.logFailure=true;await h.advance(6000);
  await h.run("reportPlayerError('TEST-FAULT','diagnostic',{side:'right'},'error',0)");await h.advance(3000);
  assert.ok(h.run('outbox.items.length')>0);assert.equal(h.run('lanes.left.phase'),'playing');
  h.controller.logFailure=false;await h.advance(12000);await h.run('outbox.flush()');assert.equal(h.run('outbox.items.length'),0);
});
test('offline state sync keeps the last valid media and playlist',async()=>{
  const h=integrated();await h.advance(6000);h.controller.offline=true;await h.advance(30000);
  assert.equal(h.run('state.leftItems.length'),1);assert.ok(h.run('playbackMetrics.completed')>2);
  assert.ok([...h.cacheSets.values()].some(m=>m.has('https://cdn.test/right.mp4')));
});

module.exports={integrated};
test('left-only playlist changes keep right playback generation intact',async()=>{
 const h=integrated();await h.advance(6000);const generation=h.run('lanes.right.generation');
 h.controller.manifest.playlists.left=[{...h.controller.manifest.playlists.left[0],id:'new',url:'https://cdn.test/new.mp4'}];
 await h.run("syncConfig('test')");assert.equal(h.run('lanes.right.generation'),generation);assert.equal(h.run('state.leftItems[0].id'),'new');assert.equal(h.run('delivery.phase'),'applied');
});
test('incorrect expected file digest blocks whole candidate and preserves active journal',async()=>{
 const h=integrated();await h.advance(6000);const before=h.run('bundleJournal.read().active.id');
 const m=await h.run("LVIntegrity.inspect(new Blob(['wrong']).stream())");
 h.controller.manifest.playlists.left=[{...h.controller.manifest.playlists.left[0],id:'bad',url:'https://cdn.test/bad.mp4',integrity:m}];
 await h.run("syncConfig('test-corrupt')");assert.equal(h.run('state.leftItems[0].id'),'left');assert.equal(h.run('bundleJournal.read().active.id'),before);assert.equal(h.run('delivery.phase'),'blocked');
});
test('next schedule prefetch is ready before switch and switch works offline',async()=>{
 const h=integrated();await h.advance(6000);
 h.run(`state.playlistGroups={base:{key:'base',name:'base',left:state.leftItems},next:{key:'next',id:'next',name:'next',left:[{...state.leftItems[0],id:'next',url:'https://cdn.test/next.mp4'}]}};state.defaultPlaylistKey='base';state.activePlaylistKey='base';state.playlistSchedules=[{enabled:true,days:[0,1,2,3,4,5,6],startTime:'08:00',endTime:'09:00',playlistGroupId:'next'}]`);
 // Fake clock is 2023-11-15 07:13 KST.
 await h.run('prefetchUpcoming()');assert.equal(h.run('delivery.prefetch.phase'),'ready');h.controller.offline=true;
 h.run("state.playlistSchedules[0].startTime='07:00'");await h.run("applyLocalSchedule('offline-test')");assert.equal(h.run('state.leftItems[0].id'),'next');
});
test('boot selects retained previous bundle when active files are missing',async()=>{
 const h=integrated();await h.advance(6000);
 h.controller.manifest.playlists.left=[{...h.controller.manifest.playlists.left[0],id:'new',url:'https://cdn.test/new.mp4'}];await h.run("syncConfig('new')");
 const cache=await h.run('getMediaCache()');await cache.delete('https://cdn.test/new.mp4');h.controller.offline=true;
 await h.run('selectBootBundle()');assert.equal(h.run('state.leftItems[0].id'),'left');assert.match(h.run('delivery.error'),/이전 저장본/);
});
test('overnight player selection agrees with start-day semantics',async()=>{
 const h=integrated();await h.advance(6000);
 assert.equal(h.run("isScheduleActiveAt({days:[1],startTime:'22:00',endTime:'02:00'},new Date('2026-09-07T16:00:00Z'))"),true);
 assert.equal(h.run("isScheduleActiveAt({days:[1],startTime:'22:00',endTime:'02:00'},new Date('2026-09-06T16:00:00Z'))"),false);
});

test('new app context restores a committed bundle offline after restart',async()=>{
 const first=integrated();await first.advance(6000);
 first.controller.manifest.playlists.left=[{...first.controller.manifest.playlists.left[0],id:'updated',url:'https://cdn.test/updated.mp4'}];await first.run("syncConfig('update')");
 const second=integrated({storage:first.storage,cacheSets:first.cacheSets,offline:true});await second.advance(6000);
 assert.equal(second.run('state.leftItems[0].id'),'updated');assert.equal(second.run('lanes.left.phase'),'playing');assert.equal(second.run('lanes.right.phase'),'playing');
});
test('journal quota refusal leaves both live lanes and last saved bundle untouched',async()=>{
 const h=integrated();await h.advance(6000);const before=h.run('bundleJournal.read().active.id');
 h.run("bundleJournal.storage={getItem:k=>localStorage.getItem(k),setItem:()=>{throw new Error('quota injected')}}");
 h.controller.manifest.playlists.left=[{...h.controller.manifest.playlists.left[0],id:'not-applied',url:'https://cdn.test/not-applied.mp4'}];await h.run("syncConfig('quota')");
 assert.equal(h.run('state.leftItems[0].id'),'left');assert.equal(h.run('bundleJournal.read().active.id'),before);assert.equal(h.run('delivery.phase'),'blocked');
});

test('quota circuit persists, coalesces API retries, and leaves both cached lanes running',async()=>{
 const h=integrated();await h.advance(6000);h.controller.quota=true;const before=h.calls.length;
 await assert.rejects(h.run("fetchJson('https://cms.test/api/player-status',{attempts:3})"),e=>e.code==='LV-D1-QUOTA');
 assert.equal(h.calls.length-before,1);assert.ok(h.run('cmsRetryAt')>h.run('Date.now()')+899000);
 for(let i=0;i<20;i++)await assert.rejects(h.run("fetchJson('https://cms.test/api/heartbeat')"),e=>e.code==='LV-D1-QUOTA');
 assert.equal(h.calls.length-before,1);await h.advance(30000);assert.equal(h.calls.length-before,1);
 assert.ok(h.run('playbackMetrics.completed')>2);assert.equal(h.run('state.leftItems.length'),1);assert.equal(h.run('state.rightItems.length'),1);assert.ok(h.storage.has('lv-cms-retry-at'));
});
test('rapid health triggers cannot produce a request every ten seconds',async()=>{
 const h=integrated();await h.advance(6000);const before=h.calls.filter(c=>c.path==='/api/player-status').length;
 for(let i=0;i<20;i++){h.run('requestHealthReport()');await h.advance(1000);}
 assert.equal(h.calls.filter(c=>c.path==='/api/player-status').length,before);
});

test('production free100 profile clamps old URLs and combines control requests',async()=>{
 const h=integrated({productionProfile:true});await h.advance(6000);
 assert.equal(h.run('CONFIG.heartbeatMs'),600000);assert.equal(h.run('CONFIG.playerStatePollMs'),900000);assert.equal(h.run('CONFIG.commandPollMs'),300000);
 assert.equal(h.calls.filter(x=>x.path==='/api/player-control').length,1);
 assert.equal(h.calls.filter(x=>['/api/player-command','/api/notice-active','/api/black-mode'].includes(x.path)).length,0);
 assert.equal(h.run('lanes.left.phase'),'playing');assert.equal(h.run('lanes.right.phase'),'playing');
});
