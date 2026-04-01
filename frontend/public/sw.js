// sw.js — Görev Kahramanı Service Worker
const CACHE_VERSION = 'gk-v1';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const API_CACHE     = CACHE_VERSION + '-api';

// Offline'da da çalışması için önbelleğe alınacak dosyalar
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/child.html',
  '/parent.html',
  '/js/api.js',
  '/manifest.json',
  '/offline.html',
];

// ── INSTALL — Statik dosyaları önbelleğe al ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Bazı dosyalar önbelleğe alınamadı:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — Eski cache'leri temizle ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('gk-') && key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — Akıllı önbellek stratejisi ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API istekleri: Network first, hata durumunda cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML sayfaları: Network first (güncel içerik önemli)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request)
          .then(cached => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Diğer statik dosyalar (JS, CSS): Cache first
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const clone = res.clone();
      const cache = await caches.open(API_CACHE);
      cache.put(request, clone);
    }
    return res;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'İnternet bağlantısı yok', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('Dosya bulunamadı', { status: 404 });
  }
}

// ── PUSH BİLDİRİMLERİ (sonraki aşama için hazır) ──
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'Görev Kahramanı', body: event.data.text() }; }

  const options = {
    body:    data.body || '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/badge-72.png',
    tag:     data.tag || 'gk-notification',
    data:    { url: data.url || '/' },
    vibrate: [100, 50, 100],
    actions: data.actions || [],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Görev Kahramanı', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
