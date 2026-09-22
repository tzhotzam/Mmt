// Çevrimdışı çalışma için basit önbellek. three.js CDN'den geldiği için
// 3B önizleme çevrimdışı devre dışı kalır; üretim ve dışa aktarma çalışır.
//
// SÜRÜM: index.html içindeki <meta name="app-version"> ve main.js içindeki
// APP_VERSION ile AYNI olmalı. Üçü ayrışırsa tarayıcı yeni HTML'i eski
// JavaScript'le birleştirebilir; testler bu üçünü karşılaştırır.

const VERSION = '2026-09-22-a';
const CACHE = `cnc-panel-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './js/main.js',
  './js/geom.js',
  './js/heightmap.js',
  './js/marchingsquares.js',
  './js/nest.js',
  './js/cutlist.js',
  './js/stl.js',
  './js/facet.js',
  './js/relief.js',
  './js/corners.js',
  './js/paint.js',
  './js/mesh.js',
  './js/unfold.js',
  './js/demomesh.js',
  './js/patterns.js',
  './js/preview2d.js',
  './js/preview3d.js',
  './js/modes/ribs.js',
  './js/modes/contour.js',
  './js/modes/facets.js',
  './js/modes/slices.js',
  './js/slice.js',
  './js/export/dxf.js',
  './js/export/svg.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 'reload' → kurulum dosyaları HTTP önbelleğinden değil, sunucudan gelsin.
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
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

  // Ağ öncelikli. `cache: 'no-cache'` kritik: aksi hâlde istek tarayıcının
  // KENDİ HTTP önbelleğinden karşılanabiliyor. GitHub Pages dosyalara birkaç
  // dakikalık ömür verdiği için, yeni index.html ile eski main.js aynı anda
  // sunulabiliyordu — arayüzde yeni alanlar çıkıp onları dolduran kod
  // bulunmuyordu. 'no-cache' sunucuya doğrulatır; değişmemişse 304 döner,
  // yani maliyeti düşüktür.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
