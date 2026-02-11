const CACHE_NAME = 'smart-gallery-v1';
const STATIC_ASSETS = [
  'index.html',
  'data.json',
  'thumbnails.json',
  'manifest.json',
  'icon.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
    .then(cache => cache.addAll(STATIC_ASSETS))
    .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Cache-first for our own app assets and JSON
  if (url.origin === self.location.origin &&
    (STATIC_ASSETS.includes(url.pathname) || url.pathname.startsWith('/data') || url.pathname.startsWith('/thumbnails'))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
  // Network-first for images, with fallback to cache
  else if (url.pathname.startsWith('/images/')) {
    event.respondWith(
      fetch(event.request)
      .then(response => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        return response;
      })
      .catch(() => caches.match(event.request))
    );
  }
  // Generic stale-while-revalidate for other assets
  else {
    event.respondWith(
      caches.match(event.request)
      .then(cached => {
        const fetched = fetch(event.request)
          .then(response => {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
  }
});