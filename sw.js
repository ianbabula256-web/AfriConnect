const V='wx-v6',SHELL=['./','index.html','manifest.webmanifest','icon.svg','apple-touch-icon.png','icon-192.png','icon-512.png','icon-maskable-512.png','cloud-far.png','cloud-mid.png','cloud-near.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Cache-first so the app opens instantly and offline; refreshed in the background when online.
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
 e.respondWith(caches.open(V).then(async c=>{const hit=await c.match(r,{ignoreSearch:true})||(r.mode==='navigate'?await c.match('index.html'):null);
  const net=fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res}).catch(()=>null);
  return hit||(await net)||new Response('Offline and not cached yet. Open the app once while online.',{status:503})}))});
