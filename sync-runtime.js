(function(root){
'use strict';
const uid=()=>root.LVRuntime?.uid?.() || root.crypto.randomUUID();
const read=(s,k,d)=>{try{return JSON.parse(s.getItem(k)||'null')||d}catch{return d}};
function write(s,k,v){const text=JSON.stringify(v);s.setItem(k,text);if(s.volatile || s.getItem(k)!==text)throw new Error('Permanent storage verification failed')}
const fileKey=f=>JSON.stringify([f.side,f.assetId||f.itemId||f.id,f.assetVersion||f.integrity?.revision||f.r2Key||f.sourceUrl||f.url]);
class FaultLedger {
 constructor(storage,key){this.storage=storage;this.key=key;this.value=read(storage,key,{revision:0,criticalRevision:0,faults:{},samples:[],sampleDay:'',sampleUsed:0});this.attempts=new Set();this.volatile=false;}
 persist(){try{write(this.storage,this.key,this.value)}catch{this.volatile=true}}
 failure(f,now=Date.now()){
  const attempt=f.attemptId?`${fileKey(f)}:${f.attemptId}`:'';
  if(attempt && this.attempts.has(attempt))return false;
  if(attempt){this.attempts.add(attempt);if(this.attempts.size>1000)this.attempts.delete(this.attempts.values().next().value)}
  const k=fileKey(f),old=this.value.faults[k],fresh=!old||old.status==='recovered';
  const row=fresh?{assetId:f.assetId||f.itemId||f.id,assetVersion:f.assetVersion||f.integrity?.revision||f.r2Key||f.sourceUrl||f.url,side:f.side,fileName:f.fileName,episode:uid(),firstAt:new Date(now).toISOString(),count:0,status:'fault'}:old;
  row.count++;row.lastAt=new Date(now).toISOString();this.value.faults[k]=row;this.value.revision++;
  if(fresh){this.value.criticalRevision=(this.value.criticalRevision||0)+1;this.urgent=row;this.sample(row,'first',now);}this.persist();return fresh;
 }
 exclude(f,now=Date.now()){
  const row=this.value.faults[fileKey(f)];if(!row || row.status==='excluded')return false;
  row.status='excluded';row.lastAt=new Date(now).toISOString();row.retryAt=now+60000;this.value.revision++;this.value.criticalRevision=(this.value.criticalRevision||0)+1;this.urgent=row;this.sample(row,'excluded',now);this.persist();return true;
 }
 recover(f,now=Date.now()){
  const row=this.value.faults[fileKey(f)];if(!row || row.status==='recovered')return false;
  row.status='recovered';row.recoveredAt=new Date(now).toISOString();row.lastAt=row.recoveredAt;delete row.retryAt;this.value.revision++;this.value.criticalRevision=(this.value.criticalRevision||0)+1;this.urgent=row;this.sample(row,'recovered',now);this.persist();return true;
 }
 sample(row,type,now){
  const day=new Date(now).toISOString().slice(0,10),samples=this.value.samples;
  if(this.value.sampleDay!==day){this.value.sampleDay=day;this.value.sampleUsed=0}if(this.value.sampleUsed>=10)return;this.value.sampleUsed++;
  samples.push({id:`${row.episode}:${type}`,day,type,...row});this.value.samples=samples.filter(x=>Date.parse(x.lastAt)>now-7*86400000).slice(-70);
 }
 snapshot(now=Date.now()){
  for(const [k,f] of Object.entries(this.value.faults))if(f.status==='recovered'&&Date.parse(f.recoveredAt)<now-7*86400000)delete this.value.faults[k];
  return Object.values(this.value.faults);
 }
 acknowledge(ids){const set=new Set(ids);this.value.samples=this.value.samples.filter(x=>!set.has(x.id));this.persist()}
}
class Tombstones {
 constructor(storage,key){this.storage=storage;this.key=key;this.items=read(storage,key,{});}
 merge(rows){const next={...this.items};for(const r of rows||[]){const id=r.asset_id||r.assetId;if(id)next[id]=r.asset_version||r.assetVersion||'*'}write(this.storage,this.key,next);this.items=next;}
 allows(item){const deleted=this.items[item.assetId||item.id];return !deleted || (deleted!=='*'&&deleted!==(item.assetVersion||item.integrity?.revision||item.r2Key||item.url))}
 filter(items){return (items||[]).filter(x=>this.allows(x))}
}
function rightAllowed(item,store){
 const mode=String(item.targetMode??item.target_mode??'').toLowerCase();
 if(mode==='all')return true;
 if(!['selected','select','stores'].includes(mode))return false;
 let list=item.targetStores??item.target_stores_json??[];
 if(typeof list==='string'){try{list=JSON.parse(list)}catch{return false}}
 return Array.isArray(list)&&!!store&&list.includes(store);
}
function blackActive(row={},now=Date.now()){
 if(Number(row.immediate_active??row.immediateActive)===1 && (!(row.immediate_until||row.immediateUntil)||Date.parse(row.immediate_until||row.immediateUntil)>now))return true;
 if(Number(row.schedule_enabled??row.scheduleEnabled)!==1)return false;
 let days=row.schedule_days_json??row.scheduleDays??[];if(typeof days==='string'){try{days=JSON.parse(days)}catch{return false}}
 const d=new Date(now+9*3600000),hhmm=d.toISOString().slice(11,16),start=row.schedule_start||row.scheduleStart||'00:00',end=row.schedule_end||row.scheduleEnd||'23:59';
 return days.includes(d.getUTCDay())&&(start<=end?(hhmm>=start&&hhmm<=end):(hhmm>=start||hhmm<=end));
}
class Coordinator {
 constructor(o){
  this.o=o;this.seq=0;this.boot=uid();this.key=o.key;this.saved=read(o.storage,o.key,{generation:0});this.generation=0;this.timer=null;this.busy=false;this.pending=false;this.stopped=false;this.nextRegular=0;this.retryAt=this.saved.retryAt>Date.now()?this.saved.retryAt:0;this.failures=this.saved.failures||0;
  this.budget=read(o.storage,o.key+'-budget',{day:'',regular:0,priority:0,retry:0});
 }
 take(kind){const day=new Date().toISOString().slice(0,10);if(this.budget.day!==day)this.budget={day,regular:0,priority:0,retry:0};const limit={regular:300,priority:30,retry:40}[kind];if(this.budget[kind]>=limit)return false;this.budget[kind]++;try{write(this.o.storage,this.key+'-budget',this.budget)}catch{}return true;}
 start(){if(this.started)return;this.started=true;this.nextRegular=Date.now()+300000;this.run('regular');}
 wake(priority=false){if(this.stopped)return;if(priority){this.pending=true;if(!this.busy&&Date.now()>=this.retryAt)this.run('priority')}else if(Date.now()>=this.retryAt && !this.busy)this.run('retry');}
 arm(){clearTimeout(this.timer);if(this.stopped)return;const next=this.retryAt>Date.now()?this.retryAt:Math.min(this.nextRegular,this.pending?Date.now()+1000:Infinity);this.timer=setTimeout(()=>this.run(this.pending&&Date.now()>=this.retryAt?'priority':this.retryAt?'retry':'regular'),Math.max(1000,next-Date.now()));}
 async run(kind){
  if(this.busy||this.stopped)return;if(Date.now()<this.retryAt){this.arm();return;}
  if(!this.take(kind)){this.pending=false;this.nextRegular=Math.max(this.nextRegular,Date.now()+300000);this.retryAt=Date.now()+300000;this.arm();return;}
  this.busy=true;const hadPending=this.pending;this.pending=false;
  if(kind==='regular')this.nextRegular=Date.now()+300000;
  try{
   const current=this.o.packet();const packet={...current,boot:this.boot,generation:this.generation,previousGeneration:this.saved.generation||0,seq:++this.seq};
   const result=await this.o.send(packet);
   if(!result?.ok)throw Object.assign(new Error(result?.error||'Sync rejected'),{response:result});
   if(result.boot!==this.boot)throw new Error('Wrong session acknowledgement');
   this.generation=result.generation;this.saved={generation:this.generation,retryAt:0,failures:0};write(this.o.storage,this.key,this.saved);
   this.failures=0;this.retryAt=0;this.nextRegular=Math.max(this.nextRegular,Date.now()+1000);
   this.o.success?.(result,packet);this.o.ack?.(result.acknowledged||[]);
  }catch(e){
   this.pending=this.pending||hadPending;this.failures++;this.retryAt=Date.now()+Math.max(Number(e.retryAfterMs)||0,[60000,300000,900000,1800000][Math.min(3,this.failures-1)]);this.saved={generation:this.saved.generation||this.generation,retryAt:this.retryAt,failures:this.failures};try{write(this.o.storage,this.key,this.saved)}catch{}this.o.failure?.(e);
   // A session conflict cannot be resolved by making this old page impersonate the new boot.
   if(e.response?.code==='LV_SESSION_CONFLICT'){this.stopped=true;this.o.sessionConflict?.(e)}
  }finally{this.busy=false;this.arm();}
 }
 stop(){this.stopped=true;clearTimeout(this.timer)}
}
// Two page instances on the same origin must not double the polling traffic.
class Lease {
 constructor(storage,key){this.s=storage;this.key=key;this.id=uid();this.owned=false;this.timer=null;}
 acquire(now=Date.now()){const old=read(this.s,this.key,null);if(old&&old.id!==this.id&&old.until>now)return false;try{write(this.s,this.key,{id:this.id,until:now+30000});this.owned=read(this.s,this.key,{}).id===this.id}catch{this.owned=false}return this.owned;}
 start(lost){this.timer=setInterval(()=>{if(!this.acquire())lost?.()},5000)}
 release(){clearInterval(this.timer);const old=read(this.s,this.key,{});if(old.id===this.id)this.s.removeItem(this.key);this.owned=false}
}
root.LVSync={FaultLedger,Tombstones,Coordinator,Lease,fileKey,rightAllowed,blackActive,read,write};
if(typeof module!=='undefined')module.exports=root.LVSync;
})(globalThis);
