// Nova Gallery service worker
// Strategy overview:
//   - App shell (index.html, manifest, icon): cache-first, so the app boots instantly
//     and works offline once visited.
//   - data.json / thumbnails.json (describe which static photos exist): network-first
//     with a cache fallback, so freshly-regenerated manifests are picked up quickly
//     while still working offline.
//   - Static gallery images/thumbnails: stale-while-revalidate — instant from cache,
//     quietly refreshed in the background.
//   - Everything else (CDN scripts/fonts/icons): network-first with a cache fallback.
//
// Uploaded photos/videos/audio are NOT handled here — they live entirely in
// IndexedDB (see the app's own storage layer), not the network, so the service
// worker has nothing to do with them.

const SHELL_CACHE = 'nova-gallery-shell-v1';
const RUNTIME_CACHE = 'nova-gallery-runtime-v1';

const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
            .catch(() => {}) // don't fail install if an optional shell asset (e.g. icon.png) is missing
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

function isDataEndpoint(url) {
    return url.pathname.endsWith('/data.json') || url.pathname.endsWith('data.json') ||
           url.pathname.endsWith('/thumbnails.json') || url.pathname.endsWith('thumbnails.json');
}

function isStaticMedia(url) {
    return url.pathname.includes('/images/') || url.pathname.includes('/thumbnails/');
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch { return; }

    // Network-first for the manifests describing which photos exist, so a
    // freshly-regenerated data.json/thumbnails.json is picked up quickly. Falls
    // back to cache when offline.
    if (isDataEndpoint(url)) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req))
        );
        return;
    }

    // Stale-while-revalidate for static gallery images/thumbnails: instant from
    // cache, refreshed quietly in the background.
    if (isStaticMedia(url) && url.origin === self.location.origin) {
        event.respondWith(
            caches.open(RUNTIME_CACHE).then((cache) =>
                cache.match(req).then((cached) => {
                    const network = fetch(req).then((res) => {
                        if (res && res.ok) cache.put(req, res.clone());
                        return res;
                    }).catch(() => cached);
                    return cached || network;
                })
            )
        );
        return;
    }

    // Cache-first for same-origin app shell files.
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => cached || fetch(req).then((res) => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
                }
                return res;
            }).catch(() => cached))
        );
        return;
    }

    // Cross-origin (CDN) assets: network-first with a cache fallback, so the app
    // still boots offline once these have been fetched at least once.
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});
