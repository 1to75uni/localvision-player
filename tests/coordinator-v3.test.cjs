const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./harness.cjs'),{integrated}=require('./app.test.cjs');
function fixture(){const h=setup();h.ctx.clearInterval=h.ctx.clearTimeout;vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../sync-runtime.js'),'utf8'),h.ctx);return h}
test('100 coordinators run 28,800 regular requests in 24 hours, with no legacy polling timer',async()=>{
 const h=fixture(),now=h.ctx.Date.now();await h.tick(86400000-now%86400000);let count=0;
 const clients=Array.from({length:100},(_,i)=>new h.ctx.LVSync.Coordinator({storage:h.localStorage,key:'session-'+i,packet:()=>({installation:'installation_'+i}),send:async p=>{count++;return {ok:true,boot:p.boot,generation:1}},success:()=>{}}));clients.forEach(c=>c.start());await h.tick(86400000-1);assert.equal(count,28800);clients.forEach(c=>c.stop());assert.equal(h.timers.size,0)
});
test('coordinator has one in-flight request; multiple urgent events coalesce, reserve never consumes regular budget',async()=>{
 const h=fixture();let release,live=0,max=0,count=0;const blocker=new Promise(r=>release=r);
 const c=new h.ctx.LVSync.Coordinator({storage:h.localStorage,key:'c',packet:()=>({}),send:async p=>{count++;max=Math.max(max,++live);if(count===1)await blocker;live--;return {ok:true,boot:p.boot,generation:1}}});c.start();for(let n=0;n<40;n++)c.wake(true);assert.equal(count,1);release();await h.tick(5000);assert.equal(max,1);assert.equal(count,2);for(let i=0;i<100;i++){c.wake(true);await h.tick(1000)}assert.ok(c.budget.priority<=30);assert.equal(c.budget.regular,1);c.stop()
});
test('quota cooldown survives reload and cold offline boot still has a bounded retry timer',async()=>{
 const h=fixture();let calls=0;const options={storage:h.localStorage,key:'c',packet:()=>({}),send:async()=>{calls++;throw Object.assign(new Error('quota'),{retryAfterMs:900000})}};
 const first=new h.ctx.LVSync.Coordinator(options);first.start();await h.tick(1000);first.stop();const second=new h.ctx.LVSync.Coordinator(options);second.start();await h.tick(300000);assert.equal(calls,1);await h.tick(600001);assert.equal(calls,2);second.stop()
});
test('two page instances cannot both acquire the same persistent installation lease',()=>{const h=fixture(),a=new h.ctx.LVSync.Lease(h.localStorage,'owner'),b=new h.ctx.LVSync.Lease(h.localStorage,'owner');h.localStorage.removeItem=k=>h.storage.delete(k);assert.equal(a.acquire(),true);assert.equal(b.acquire(),false);a.release();assert.equal(b.acquire(),true);b.release()});
test('first LEFT and first RIGHT are downloaded before the remainder of LEFT',async()=>{const h=integrated(),c=h.controller;c.manifest.playlists.left.push({...c.manifest.playlists.left[0],id:'l2',url:'https://cdn.test/l2.mp4'},{...c.manifest.playlists.left[0],id:'l3',url:'https://cdn.test/l3.mp4'});await h.advance(5000);assert.deepEqual(h.calls.filter(c=>c.path.endsWith('.mp4')).slice(0,3).map(c=>c.path),['/left.mp4','/right.mp4','/l2.mp4'])});
test('real lane error reports immediately, then quarantines only that file; right continues',async()=>{
 const h=integrated();h.controller.manifest.playlists.left.push({...h.controller.manifest.playlists.left[0],id:'good',url:'https://cdn.test/good.mp4'});await h.advance(5000);const before=h.calls.filter(c=>c.path==='/api/player-sync').length;
 h.run('lanes.left.element.onerror()');await h.advance(300);assert.ok(h.calls.filter(c=>c.path==='/api/player-sync').length>before);assert.equal(h.run('faultLedger.snapshot()[0].status'),'fault');assert.equal(h.run('lanes.right.phase'),'playing');
 await h.advance(2500);h.run('lanes.left.element.onerror()');await h.advance(4000);assert.equal(h.run('faultLedger.snapshot()[0].status'),'excluded');assert.equal(h.run('state.rightItems.length'),1);assert.ok(h.run('lanes.right.lastCompletedAt'));
 assert.equal(h.run("faultLedger.recover({side:'left',itemId:'good',assetVersion:'https://cdn.test/good.mp4'})"),false);
});
test('late completion from an obsolete download cannot replace the latest playlist',async()=>{
 const h=integrated();await h.advance(5000);let release;const held=new Promise(r=>release=r),original=h.ctx.fetch;
 h.ctx.fetch=async(url,init)=>{if(String(url).includes('/slow.mp4'))await held;return original(url,init)};
 h.controller.version='2:1';h.controller.manifest.playlists.left=[{...h.controller.manifest.playlists.left[0],id:'slow',url:'https://cdn.test/slow.mp4'}];h.run('syncCoordinator.wake(false)');await h.advance(500);
 h.controller.version='3:1';h.controller.manifest.playlists.left=[{...h.controller.manifest.playlists.left[0],id:'latest',url:'https://cdn.test/latest.mp4'}];h.run('syncCoordinator.wake(false)');await h.advance(500);release();await h.advance(4000);
 assert.equal(h.run('state.leftItems[0].id'),'latest');assert.equal(h.run("bundleJournal.read().active.left.some(i=>i.id==='slow')"),false);assert.equal(h.run('appliedVersion'),'3:1')
});
