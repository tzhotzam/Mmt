// Çevrimdışı çalışma için basit önbellek. three.js CDN'den geldiği için
// 3B önizleme çevrimdışı devre dışı kalır; üretim ve dışa aktarma çalışır.

const CACHE = 'cnc-panel-v9';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './js/main.js',
  './js/geom.js',
  './js/heightmap.js',
  './js/marchingsquares.js',
  './js/nest.js',
  './js/cutlist.js',
  './js/stl.js',
  './js/facet.js',
  './js/relief.js',
  './js/paint.js',
  './js/mesh.js',
  './js/unfold.js',
  './js/demomesh.js',
  './js/preview2d.js',
  './js/preview3d.js',
  './js/modes/ribs.js',
  './js/modes/contour.js',
  './js/modes/facets.js',
  './js/export/dxf.js',
  './js/export/svg.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Ağ öncelikli, çevrimdışında önbellek: geliştirirken bayat dosya sorunu olmaz.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
