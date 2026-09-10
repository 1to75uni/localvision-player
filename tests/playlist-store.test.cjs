const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function setup(){
 const ctx=vm.createContext({crypto:crypto.webcrypto,TextEncoder,Uint8Array,Array,Blob,Response,Map,Set,console});
 for(const file of ['integrity.js','playlist-store.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),ctx);
 const entries=new Map(),storage=new Map();let downloads=0,corrupt=false,quota=false,block=null;
 const cache={match:async key=>entries.get(key)?.clone(),put:async(key,res)=>{if(quota)throw new Error('quota');entries.set(key,res.clone())},delete:async key=>entries.delete(key)};
 const item={url:'https://x.test/a.mp4',cacheUrl:'https://x.test/a.mp4',type:'video'};
 const files=new ctx.LVPlaylistStore.VerifiedFiles({cache:async()=>cache,room:async()=>{},fetch:async(url,signal,consume)=>{downloads++;if(block)await block;return consume(new Response(corrupt?'wrong':'media',{headers:{'content-type':'video/mp4','content-length':'5'}}))}});
 return {ctx,entries,item,files,cache,storage,get downloads(){return downloads},set corrupt(x){corrupt=x},set quota(x){quota=x},set block(x){block=x}};
}
test('chunk SHA-256 matches independent Node hashes at boundaries',async()=>{
 const h=setup();for(const size of [1,63,64,1024*1024,1024*1024+17]){
  const bytes=crypto.randomBytes(size),m=await h.ctx.LVIntegrity.inspect(new Blob([bytes]).stream());
  for(let i=0;i<m.hashes.length;i++)assert.equal(m.hashes[i],crypto.createHash('sha256').update(bytes.subarray(i*1048576,(i+1)*1048576)).digest('hex'));
  assert.equal(m.byteSize,size);await h.ctx.LVIntegrity.inspect(new Blob([bytes]).stream(),{expected:m});
 }
});
test('truncated and same-length corrupt files fail origin verification',async()=>{
 const h=setup(),m=await h.ctx.LVIntegrity.inspect(new Blob(['media']).stream());
 for(const body of ['medi','wrong'])await assert.rejects(h.ctx.LVIntegrity.inspect(new Blob([body]).stream(),{expected:m}),/불일치|다릅니다/);
});
test('tampered manifest revision and malformed chunk counts are rejected',async()=>{
 const h=setup(),m=await h.ctx.LVIntegrity.inspect(new Blob(['media']).stream());
 await assert.rejects(h.ctx.LVIntegrity.inspect(new Blob(['media']).stream(),{expected:{...m,revision:'a'.repeat(64)}}),/리비전/);
 assert.throws(()=>h.ctx.LVIntegrity.validate({...m,hashes:[]}),/검증 정보/);
});
test('verified downloads are reused without fetching unchanged bytes',async()=>{
 const h=setup();h.item.integrity=await h.ctx.LVIntegrity.inspect(new Blob(['media']).stream());
 const first=await h.files.ensure(h.item),second=await h.files.ensure(h.item);assert.equal(first.verified,true);assert.equal(second.verified,true);assert.equal(h.downloads,1);
});
test('corrupt existing cache is repaired only for affected file',async()=>{
 const h=setup();h.item.integrity=await h.ctx.LVIntegrity.inspect(new Blob(['media']).stream());
 await h.cache.put(h.item.url,new Response('wrong'));await h.cache.put('other',new Response('untouched'));
 await h.files.ensure(h.item);assert.equal(h.downloads,1);assert.equal(await (await h.cache.match('other')).text(),'untouched');
});
test('bad origin bytes retry at most twice and never enter committed cache',async()=>{
 const h=setup();h.item.integrity=await h.ctx.LVIntegrity.inspect(new Blob(['media']).stream());h.corrupt=true;
 await assert.rejects(h.files.ensure(h.item));assert.equal(h.downloads,2);assert.equal(h.entries.size,0);
});
test('legacy receipt is local-only, and corruption is detected after restart',async()=>{
 const h=setup();const initial=await h.files.ensure(h.item);assert.equal(initial.verified,false);
 const res=await h.cache.match(h.item.url);await h.cache.put(h.item.url,new Response('wrong',{headers:res.headers}));h.files.checked.clear();
 await h.files.ensure(h.item);assert.equal(h.downloads,2);
});
test('new revision never overwrites retained old revision',async()=>{
 const h=setup();await h.files.ensure(h.item);h.item={...h.item,cacheUrl:h.item.url+'?revision=new',fetchUrl:h.item.url,integrity:await h.ctx.LVIntegrity.inspect(new Blob(['media']).stream())};
 await h.files.ensure(h.item);assert.ok(h.entries.has(h.item.url));assert.ok(h.entries.has(h.item.cacheUrl));assert.equal(h.downloads,1);
});
test('ready current content bypasses a pending background download',async()=>{
 const h=setup();await h.files.ensure(h.item);let release;h.block=new Promise(r=>release=r);
 const pending=h.files.ensure({...h.item,cacheUrl:'next'});await new Promise(setImmediate);
 const current=await h.files.ensure(h.item);assert.equal(current.blob.size,5);release();await pending;
});
test('storage quota failure cannot falsely mark file ready',async()=>{
 const h=setup();h.quota=true;await assert.rejects(h.files.ensure(h.item),/quota/);assert.equal(h.files.checked.size,0);
});
test('atomic journal retains current bundle on failed update and survives restart',()=>{
 const h=setup();let fail=false;const storage={getItem:k=>h.storage.get(k),setItem:(k,v)=>{if(fail)throw new Error('quota');h.storage.set(k,v)}};
 const j=new h.ctx.LVPlaylistStore.Journal(storage,'j');const bundle=id=>({left:[{id}],right:[],schedule:{activeKey:id}});
 j.commit(bundle('old'));fail=true;assert.throws(()=>j.commit(bundle('new')),/저장 실패/);assert.equal(j.read().active.left[0].id,'old');fail=false;j.commit(bundle('new'));
 const restarted=new h.ctx.LVPlaylistStore.Journal(storage,'j');assert.equal(restarted.read().active.left[0].id,'new');assert.equal(restarted.read().previous.left[0].id,'old');
});
test('volatile journal storage and empty bundles are refused',()=>{
 const h=setup(),j=new h.ctx.LVPlaylistStore.Journal({volatile:true},'j');assert.throws(()=>j.commit({left:[{}],right:[]}),/저장소/);assert.throws(()=>j.commit({left:[],right:[]}),/재생목록/);
});
test('legacy WebView SHA-256 fallback agrees with native implementation',async()=>{
 const h=setup();h.ctx.crypto={};for(const n of [0,1,55,56,63,64,65,1000,1048576]){const bytes=crypto.randomBytes(n);assert.equal(await h.ctx.LVIntegrity.digest(bytes),crypto.createHash('sha256').update(bytes).digest('hex'));}
});
