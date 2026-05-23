const CACHE_NAME = 'cartazista-cache-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo_cartaz.png',
  './style.css',
  './app.js'
];

// Recursos que devem usar network-first (HTML/CSS/JS do app shell)
// Garante que o usuário sempre receba a versão mais recente sem precisar
// pressionar Ctrl+Shift+R.
const NETWORK_FIRST_REGEX = /\.(html|css|js)$/i;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Não cachear chamadas do Firebase ou API
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebase') ||
      url.pathname.includes('/api/')) {
    return;
  }

  const isAppShell =
    req.mode === 'navigate' ||
    NETWORK_FIRST_REGEX.test(url.pathname);

  if (isAppShell) {
    // Network-first: sempre tenta buscar a versão mais recente
    e.respondWith(
      fetch(req)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Demais recursos (imagens, fontes etc.): cache-first
  e.respondWith(
    caches.match(req).then((res) => {
      if (res) return res;
      return fetch(req).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return response;
      });
    })
  );
});
