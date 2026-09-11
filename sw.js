/* HTML fetched through redirects must not be replayed as redirected navigation responses. */
const APP_CACHE = 'lv-player-app-v1-9-5-free-100';
const APP_ASSETS = ['./index.html','./style.css?v=1.9.5','./integrity.js?v=1.9.5','./playlist-store.js?v=1.9.5','./runtime.js?v=1.9.5','./free-budget.js?v=1.9.5','./app.js?v=1.9.5','./loading.jpg','./waiting-left.jpg?v=1.9.5','./waiting-right.jpg?v=1.9.5'];
function navigationDocument(response) {
  if(!response || !response.ok || response.status===206 || ['opaque','opaqueredirect','error'].includes(response.type)) throw new Error('Player document unavailable');
  const headers=new Headers(response.headers);
  if(!/text\/html/i.test(headers.get('content-type') || '')) throw new Error('Player document is not HTML');
  // Construct a fresh Response: no inherited redirect history/URL list.
  // Body streams already contain decoded bytes, so don't replay transport compression headers.
  headers.delete('content-encoding');headers.delete('content-length');headers.delete('transfer-encoding');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(APP_CACHE);
    await cache.addAll(APP_ASSETS);
    const html=await cache.match('./index.html');
    await cache.put('./index.html',navigationDocument(html));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // Cleanup failure must not prevent the repaired worker from taking control.
    try {const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('lv-player-app-') && k!==APP_CACHE).map(k=>caches.delete(k).catch(()=>false)));}catch(_){}
    await self.clients.claim();
  })());
});
async function documentForNavigation(request) {
  try {
    const cache=await caches.open(APP_CACHE),installed=await cache.match('./index.html');
    if(installed)return navigationDocument(installed);
  }catch(_){}
  // Read the static HTML, preserving the incoming URL (store/id/apiBase) in the browser.
  // Only successful readable same-origin HTML may be turned into a navigation response.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(new URL('./index.html',self.location.href).href,{cache:'no-store',redirect:'follow',credentials:'same-origin',signal:controller.signal});
    if(response.url && new URL(response.url).origin!==self.location.origin)throw new Error('Unexpected document origin');
    return navigationDocument(response);
  }catch(_){
    return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LocalVision 연결 확인</title><body style="background:#111;color:#fff;font:24px sans-serif;padding:5vw"><p>LocalVision 화면 연결을 복구하고 있습니다.</p><p>저장된 콘텐츠를 삭제하지 말고 네트워크 연결을 확인해 주세요.</p><button onclick="location.reload()" style="font:inherit">다시 연결</button><script>setTimeout(()=>location.reload(),30000)</script></body></html>',{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-lv-recovery':'document-unavailable'}});
  }finally{clearTimeout(timer);}
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/version.json'))return;
  if(event.request.mode==='navigate') {event.respondWith(documentForNavigation(event.request));return;}
  if(!APP_ASSETS.some(asset=>new URL(asset,self.location.href).href===url.href))return;
  event.respondWith((async()=>{
    let cache;try{cache=await caches.open(APP_CACHE);const hit=await cache.match(event.request);if(hit)return hit;}catch(_){}
    const response=await fetch(event.request);
    if(response.ok && cache){try{await cache.put(event.request,response.clone());}catch(_){}}
    return response;
  })());
});
