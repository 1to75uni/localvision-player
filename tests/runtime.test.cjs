const test = require('node:test');
const assert = require('node:assert/strict');
const {setup}=require('./harness.cjs');
const item=(id,type='video')=>({id,url:`blob:${id}`,fileName:`${id}.mp4`,type,duration:3});
test('left and right use their own waiting artwork during preparation and startup',async()=>{
  const h=setup({deferPlay:true});
  for(const side of ['left','right']) {
    const lane=h.lanes[side];lane.setPlaylist([item(side)]);
    assert.equal(lane.o.zone.children[0].src,`./waiting-${side}.jpg?v=1.9.3`);
  }
  await h.tick(800);
  for(const side of ['left','right']) {
    const lane=h.lanes[side];
    assert.equal(lane.element.poster,`./waiting-${side}.jpg?v=1.9.3`);
    assert.equal(lane.o.zone.children[0].src,lane.element.poster);lane.stop();await h.tick(200);
  }
});
test('video preparation replaces a retained playlist image with its lane artwork',async()=>{
  const h=setup({deferPlay:true}),lane=h.lanes.left,photo=item('photo','image'),video=item('video');
  lane.setPlaylist([photo]);await h.tick(100);assert.ok(lane.poster);
  lane.setPlaylist([photo,video],1);
  assert.equal(lane.o.zone.children[0].src,'./waiting-left.jpg?v=1.9.3');lane.stop();
});
test('pending video stays transparent with an explicit logo poster and no controls',async()=>{
  const h=setup({deferPlay:true});h.lanes.left.setPlaylist([item('pending')]);await h.tick(200);
  const video=h.lanes.left.element;
  assert.equal(video.tag,'video');assert.equal(video.style.opacity,'0');assert.equal(video.controls,false);
  assert.equal(video.poster,'./waiting-left.jpg?v=1.9.3');
  const waiting=h.lanes.left.o.zone.children[0];
  assert.equal(waiting.tag,'img');assert.equal(waiting.src,'./waiting-left.jpg?v=1.9.3');
  assert.equal(h.lanes.left.o.zone.children[1],video);
  h.lanes.left.stop();assert.equal(h.live,0);
});
test('confirmed playback with current data reveals video before the progress poll',async()=>{
  const h=setup();h.lanes.left.setPlaylist([item('ready')]);await h.tick(200);
  assert.equal(h.lanes.left.element.style.opacity,'1');assert.equal(h.lanes.left.firstFrameAt,0);
  h.lanes.left.stop();
});
test('play notification without current data cannot reveal the waiting surface',async()=>{
  const h=setup({readyState:1,freeze:true});h.lanes.left.setPlaylist([item('waiting')]);await h.tick(200);
  assert.equal(h.lanes.left.element.style.opacity,'0');h.lanes.left.stop();
});
test('rejected autoplay remains hidden and retains bounded recovery',async()=>{
  const h=setup({rejectAlways:true});h.lanes.left.setPlaylist([item('denied')]);await h.tick(200);
  assert.equal(h.lanes.left.element.style.opacity,'0');await h.tick(45000);
  assert.equal(h.lanes.left.phase,'fallback');assert.equal(h.live,0);
});
test('stale playback callback cannot reveal a replaced video',async()=>{
  const h=setup({deferPlay:true});const lane=h.lanes.left;lane.setPlaylist([item('old')]);await h.tick(200);
  const old=lane.element,started=old.onplaying;lane.setPlaylist([item('new')]);await h.tick(200);
  old.paused=false;old.readyState=4;started();
  assert.equal(old.style.opacity,'0');assert.equal(lane.element.style.opacity,'0');lane.stop();
});
test('successful retry is not marked as a 15-second failure',async()=>{
  const h=setup({rejectFirst:true,duration:30});h.lanes.left.setPlaylist([item('a')]);await h.tick(17000);
  assert.equal(h.lanes.left.phase,'playing');assert.equal(h.events.filter(e=>e[2]?.failCount).length,0);
});
test('two lanes run and replace videos without more than two decoder allocations',async()=>{
  const h=setup();h.lanes.left.setPlaylist([item('a'),item('b')]);h.lanes.right.setPlaylist([item('c'),item('d')]);await h.tick(120000);
  assert.equal(h.maxLive,2);assert.ok(h.events.filter(e=>e[0]==='LV-PLAY-COMPLETE').length>=20);
  assert.equal(h.events.filter(e=>e[3]==='error').length,0);
});
test('stalled first frame is detected, then bounded retry and quarantine',async()=>{
  const h=setup({freeze:true});h.lanes.left.setPlaylist([item('a')]);await h.tick(45000);
  assert.equal(h.events.filter(e=>e[0]==='LV-MEDIA-SESSION-SKIP').length,1);
  assert.equal(h.lanes.left.phase,'fallback');assert.equal(h.live,0);
});
test('duplicate callbacks from one attempt count as one failure',async()=>{
  const h=setup();const lane=h.lanes.left;lane.setPlaylist([item('a')]);await h.tick(2000);const token=lane.generation;
  lane.fail(new Error('one'),'playback',token);lane.fail(new Error('same'),'playback',token);
  assert.equal(lane.failures.get(lane.key(item('a'))).count,1);
});
test('actual completion resets historical failures',async()=>{
  const h=setup({duration:6});const lane=h.lanes.left;lane.setPlaylist([item('a')]);await h.tick(2000);
  lane.fail(new Error('transient'),'playback',lane.generation);await h.tick(8000);
  assert.equal(lane.failures.size,0);assert.equal(lane.exclusions.size,0);assert.ok(h.events.some(e=>e[0]==='LV-MEDIA-RECOVERED'));
});
test('notice / black mode pause removes decoders and does not count failures',async()=>{
  const h=setup();for(const side of ['left','right'])h.lanes[side].setPlaylist([item(side)]);await h.tick(3000);
  for(const side of ['left','right']){h.lanes[side].pause('notice');h.lanes[side].pause('black-mode');}
  assert.equal(h.live,0);await h.tick(60000);
  for(const side of ['left','right'])h.lanes[side].resume('notice');await h.tick(1000);assert.equal(h.live,0);
  for(const side of ['left','right'])h.lanes[side].resume('black-mode');await h.tick(3000);assert.equal(h.live,2);
  assert.equal(h.events.filter(e=>e[3]==='error').length,0);
});
test('a late old callback cannot fail the new content',async()=>{
  const h=setup();const lane=h.lanes.left;lane.setPlaylist([item('a')]);await h.tick(2000);const old=lane.generation;
  lane.setPlaylist([item('b')]);lane.fail(new Error('old event'),'decode',old);await h.tick(2000);
  assert.equal(lane.current.id,'b');assert.equal(lane.failures.size,0);
});
test('metadata duration never skips an unstarted video silently',async()=>{
  const h=setup({duration:5,freeze:true});h.lanes.left.setPlaylist([item('a'),item('b')]);await h.tick(8000);
  assert.equal(h.lanes.left.current.id,'a');assert.equal(h.events.filter(e=>e[0]==='LV-PLAY-COMPLETE').length,0);
});
test('HTTP success without acknowledgement preserves the outbox',async()=>{
  const h=setup();const box=new h.runtime.Outbox({storage:h.localStorage,key:'q',send:async()=>({ok:true,degraded:true,saved:0})});box.enqueue({id:'a'});await box.flush();assert.equal(box.items.length,1);
});
test('flush acknowledges only sent IDs and preserves concurrently queued records',async()=>{
  const h=setup();let reply;const box=new h.runtime.Outbox({storage:h.localStorage,key:'q',send:()=>new Promise(r=>reply=r)});
  box.enqueue({id:'a'});const pending=box.flush();box.enqueue({id:'b'});reply({ok:true,acknowledged:['a','b']});await pending;
  assert.equal(box.items.length,1);assert.equal(box.items[0].id,'b');
});
test('partial acknowledgements preserve failed entries',async()=>{
  const h=setup();const box=new h.runtime.Outbox({storage:h.localStorage,key:'q',send:async()=>({ok:true,acknowledged:['a']})});box.enqueue({id:'a'});box.enqueue({id:'b'});await box.flush();assert.equal(box.items[0].id,'b');
});
test('network outage does not discard durable events',async()=>{
  const h=setup();const box=new h.runtime.Outbox({storage:h.localStorage,key:'q',send:async()=>{throw new Error('offline')}});box.enqueue({id:'a'});await box.flush();
  const restored=new h.runtime.Outbox({storage:h.localStorage,key:'q',send:async()=>({ok:true,acknowledged:['a']})});assert.equal(restored.items.length,1);await restored.flush();assert.equal(restored.items.length,0);
});
test('storage failure is visible and does not erase in-memory events',()=>{
  const h=setup();const box=new h.runtime.Outbox({storage:{getItem:()=>null,setItem:()=>{throw new Error('quota')}},key:'q',send:async()=>{}});box.enqueue({id:'a'});assert.equal(box.durable,false);assert.equal(box.items.length,1);
});
test('outbox is bounded and reports dropped records',()=>{
  const h=setup();const box=new h.runtime.Outbox({storage:h.localStorage,key:'q',send:async()=>{},maxCount:2});box.enqueue({id:'a',level:'error'});box.enqueue({id:'b',level:'debug'});box.enqueue({id:'c',level:'error'});assert.equal(box.items.length,2);assert.equal(box.dropped,1);assert.equal(box.items[0].id,'a');
});
test('empty playlist cancels the former video',async()=>{
  const h=setup();h.lanes.left.setPlaylist([item('a')]);await h.tick(2000);h.lanes.left.setPlaylist([]);assert.equal(h.live,0);assert.equal(h.lanes.left.phase,'empty');
});
test('72-hour accelerated two-lane transition simulation keeps bounded resources',async()=>{
  const h=setup({duration:60});h.lanes.left.setPlaylist([item('a'),item('b')]);h.lanes.right.setPlaylist([item('c'),item('d')]);await h.tick(72*3600000);
  assert.equal(h.maxLive,2);assert.equal(h.events.filter(e=>e[3]==='error').length,0);assert.ok(h.events.filter(e=>e[0]==='LV-PLAY-COMPLETE').length>8000);
  assert.ok(h.timers.size<12);for(const side of ['left','right'])h.lanes[side].stop();assert.equal(h.live,0);
});

test('progress that stops after playback begins triggers stall recovery',async()=>{
  const h=setup({duration:90});const lane=h.lanes.left;lane.setPlaylist([item('a')]);await h.tick(3000);
  const video=h.elements.filter(x=>x.tag==='video').at(-1);h.timers.delete(video.frameTimer);await h.tick(13000);
  assert.ok(h.events.some(e=>e[0]==='LV-MEDIA-STALL'));assert.ok(lane.failures.size>0);
});
test('one lane exclusion never prevents the same content in the other lane',async()=>{
  const h=setup({duration:90});const left=h.lanes.left;left.setPlaylist([item('a')]);h.lanes.right.setPlaylist([item('a')]);await h.tick(3000);
  left.fail(new Error('decode'),'decode',left.generation);await h.tick(2000);left.fail(new Error('decode'),'decode',left.generation);await h.tick(1000);
  assert.equal(left.exclusions.size,1);assert.equal(h.lanes.right.exclusions.size,0);assert.equal(h.lanes.right.phase,'playing');
});
test('hung source resolution reaches a bounded recovery deadline',async()=>{
  const h=setup();const lane=new h.runtime.Lane('left',{zone:new h.Element('zone'),acquire:h.runtime.createGate(),resolveSource:()=>new Promise(()=>{}),onEvent:(...x)=>h.events.push(x)});
  lane.setPlaylist([item('a')]);await h.tick(91000);assert.ok(h.events.some(e=>e[0]==='LV-MEDIA-SOURCE-TIMEOUT'));lane.stop();
});
test('removed image poster is discarded when playlist becomes empty',async()=>{
  const h=setup();const lane=h.lanes.left;lane.setPlaylist([item('image','image')]);await h.tick(100);assert.ok(lane.poster);lane.setPlaylist([]);assert.equal(lane.poster,null);assert.equal(lane.phase,'empty');
});
test('short video ending before the polling interval can complete',async()=>{
  const h=setup({duration:0.5});h.lanes.left.setPlaylist([item('short')]);await h.tick(1200);assert.ok(h.events.some(e=>e[0]==='LV-PLAY-COMPLETE'));assert.equal(h.events.filter(e=>e[3]==='error').length,0);
});
