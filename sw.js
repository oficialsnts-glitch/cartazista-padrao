const CACHE_NAME = 'gb-pro-v1';
const ASSETS = [
  './',
  './index.html',
  './IMG_6828.png',
  './manifest.json',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Instalação: Salva arquivos essenciais no cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Estratégia: Tenta buscar na rede, se não houver internet, carrega do cache
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
