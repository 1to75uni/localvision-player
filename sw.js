const APP_CACHE = 'lv-player-app-v1-9-0-stable';
const APP_ASSETS = ['./index.html','./style.css','./integrity.js?v=1.9.0','./playlist-store.js?v=1.9.0','./runtime.js?v=1.9.0','./app.js?v=1.9.0','./loading.jpg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache=>cache.addAll(APP_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lv-player-app-') && k!==APP_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/version.json'))return;
  if(event.request.mode==='navigate') {
    event.respondWith((async()=>{
      const cache=await caches.open(APP_CACHE);
      const installed=await cache.match('./index.html');
      if(installed)return installed;
      return fetch(event.request,{cache:'no-store'});
    })());
    return;
  }
  if(!APP_ASSETS.some(asset=>new URL(asset,self.location.href).href===url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(APP_CACHE),hit=await cache.match(event.request);
    // Versioned application assets are activated together by installation.
    if(hit)return hit;
    const response=await fetch(event.request);
    if(response.ok)await cache.put(event.request,response.clone());
    return response;
  })());
});
