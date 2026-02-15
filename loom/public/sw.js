/**
 * Loom Service Worker
 * PWA functionality, offline support, background notifications
 */

const CACHE_NAME = 'loom-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/src/vendor/strands.js',
  '/public/manifest.json',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname.includes('anthropic.com') || url.hostname.includes('openai.com') ||
      url.hostname.includes('esm.run') || url.hostname.includes('huggingface.co') ||
      url.hostname.includes('cdn.jsdelivr.net')) return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    }).catch(() => caches.match('/'))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Loom', body: 'New message', icon: '/public/icon-192.svg' };
  if (event.data) { try { data = { ...data, ...event.data.json() }; } catch (e) { data.body = event.data.text(); } }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: data.icon || '/public/icon-192.svg', badge: '/public/icon-192.svg',
    vibrate: [100, 50, 100], data: { url: data.url || '/', timestamp: Date.now() },
    actions: data.actions || [{ action: 'open', title: 'Open' }, { action: 'dismiss', title: 'Dismiss' }],
    tag: data.tag || 'loom-notification', renotify: true, requireInteraction: data.requireInteraction || false
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) { if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus(); }
      if (clients.openWindow) return clients.openWindow(event.notification.data.url || '/');
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, tag, actions, url, requireInteraction } = event.data;
    self.registration.showNotification(title || 'Loom', {
      body: body || '', icon: icon || '/public/icon-192.svg', badge: '/public/icon-192.svg',
      vibrate: [100, 50, 100], tag: tag || 'loom-notification-' + Date.now(), renotify: true,
      requireInteraction: requireInteraction || false, data: { url: url || '/' }, actions: actions || []
    });
  }
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
