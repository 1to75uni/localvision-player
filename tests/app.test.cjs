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
  const initial=['leftZone','rightZone','statusPill','debugPanel','reloadBtn','syncBtn','clearCacheBtn','dbgStore','dbgDevice','dbgApi','dbgLeft','dbgRight','dbgSync','dbgHeartbeat','dbgBundle','dbgCache','dbgStatus','dbgCms'];
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
  h.notice=null;h.blackMode=false;h.command=null;h.offline=Boolean(options.offline);h.logFailure=false;h.apiResponse=options.apiResponse;
  ctx.fetch=async(url,init={})=>{
    const u=new URL(url,'https://player.test');calls.push({path:u.pathname,init});
    if(h.offline)throw new Error('offline');
    if(h.apiResponse && u.pathname.startsWith('/api/')) {const r=await h.apiResponse(u,init);if(r)return r;}
    if(h.quota && u.pathname.startsWith('/api/'))return new Response(JSON.stringify({ok:false,errorCode:'LV-D1-QUOTA',error:'D1 exceeded daily row write limit',retryAfterSec:900}),{status:503});
    if(u.hostname==='cdn.test')return new Response('media',{headers:{'content-type':'video/mp4','content-length':'5'}});
    let body={ok:true};
    if(u.pathname==='/api/player-sync'){
      const b=JSON.parse(init.body),version=h.version || '1:1';body={ok:true,generation:1,boot:b.boot,version,changed:b.version!==version,release:'3.0.0',acknowledged:h.logFailure?[]:b.samples.map(s=>s.id),manifests:b.version!==version?{store:'/api/player-manifest?store=qa&revision='+version.split(':')[0],common:'/api/player-manifest?store=_common&revision='+version.split(':')[1]}:null,command:h.command};
    }
    if(u.pathname==='/api/player-manifest'){
      const common=u.searchParams.get('store')==='_common';body=common?{schema:3,store:'_common',revision:Number((h.version||'1:1').split(':')[1]),right:h.manifest.playlists.right.map(x=>({...x,targetMode:x.targetMode||'all'})),notices:h.notices||[],tombstones:h.tombstones||[]}: {...h.manifest,schema:3,store:'qa',revision:Number((h.version||'1:1').split(':')[0]),active:true,black:h.black||{},playlistGroups:h.manifest.playlistGroups||{},playlists:{left:h.manifest.playlists.left,right:[]}};
    }
    if(u.pathname==='/api/player-command')body={ok:true,device:{id:'tv_qa',store:'qa'},command:h.command};
    if(u.pathname==='/api/notice-active')body={ok:true,notice:h.notice};
    if(u.pathname==='/api/black-mode')body={ok:true,mode:{active:h.blackMode,reason:h.blackMode?'test':'off'}};
    if(u.pathname==='/api/player-control')body={ok:true,command:{ok:true,device:{id:'tv_qa',store:'qa'},command:h.command},notice:{ok:true,notice:h.notice},black:{ok:true,mode:{active:h.blackMode,reason:h.blackMode?'test':'off'}}};
    if(u.pathname==='/api/heartbeat')body={ok:true,healthAccepted:true};
    if(u.pathname==='/api/player-errors')body=h.logFailure?{ok:true,degraded:true,saved:0}:{ok:true,acknowledged:JSON.parse(init.body).errors.map(e=>e.id)};
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  ctx.scheduler={yield:()=>new Promise(setImmediate)};ctx.crypto=require('node:crypto').webcrypto;ctx.TextEncoder=TextEncoder;ctx.Blob=Blob;ctx.Response=Response;
  for(const file of ['integrity.js','playlist-store.js','free-budget.js','api-response.js','sync-runtime.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),ctx);
  let app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  // Accelerate legacy playback regressions only; free100 profile is tested without overrides below.
  if(!options.productionProfile)app=app.replace('boot().catch',"Object.assign(CONFIG,{heartbeatMs:10000,commandPollMs:5000,noticePollMs:10000,blackModePollMs:10000,playerStatePollMs:10000});boot().catch");
  const run=code=>vm.runInContext(code,ctx);
  vm.runInContext(app,ctx,{filename:'app.js'});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app-v3.js'),'utf8'),ctx,{filename:'app-v3.js'});
  const advance=async ms=>{await new Promise(setImmediate);for(let n=0;n<ms;n+=100){await h.tick(Math.min(100,ms-n));await new Promise(setImmediate);}};
  return {...h,calls,cacheSets,nodes,listeners,run,advance,controller:h};
}
module.exports={integrated};
