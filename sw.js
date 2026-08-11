// ============================================================================
// REBUILD 2.2 — Service Worker
// ----------------------------------------------------------------------------
// Caching strategy: network-first with cache fallback + cache warm-up.
//   install  -> pre-cache the core app shell (ASSETS) into a versioned cache.
//   activate -> delete any cache whose name != current CACHE constant, so old
//               deployments never keep serving stale index.html/app.js/data.json.
//   fetch    -> always try the network first (so users get the latest app.js/
//               data.json as soon as they're online), and only fall back to
//               the cache when the network request fails (offline use).
//               Every successful network response also refreshes the cache,
//               so the next offline session serves the most recent copy seen.
//
// IMPORTANT: bump CACHE below on every deploy that changes any file in
// ASSETS. Because activate() deletes any cache name other than the current
// one, bumping this string is what forces old clients to drop stale caches
// and pick up the fixed files after this REBUILD 2.2 defect-fix release.
// ============================================================================
const CACHE = 'rebuild-v2.2.2-20260811';
const ASSETS = ['./', './index.html', './app.js', './data.json', './manifest.json', './icon-192.svg', './icon-512.svg'];

self.addEventListener('install', e => {
  self.skipWaiting(); // activate this SW immediately instead of waiting for old tabs to close
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))) // drop obsolete caches
      .then(() => self.clients.claim()) // take control of any already-open pages right away
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(r => {
        let c = r.clone();
        caches.open(CACHE).then(x => x.put(e.request, c)); // refresh cache with the latest network response
        return r;
      })
      .catch(() => caches.match(e.request)) // offline fallback to whatever is cached
  );
});
