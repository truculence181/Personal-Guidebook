/* Vagatio service worker
 *
 * Two jobs, and the strategy differs per resource because the goals conflict:
 *
 *   - The app HTML uses NETWORK-FIRST. This is the fix for iOS serving a
 *     stale version after a deploy: the network copy always wins when it's
 *     reachable, and the cache is only a fallback for being offline.
 *
 *   - Fonts use CACHE-FIRST. They're versioned by URL and effectively never
 *     change, so refetching them on every load is pure waste.
 *
 * Getting these backwards is the classic PWA mistake: cache-first HTML is
 * what makes people think their deploys "didn't work."
 */

const VERSION = 'vagatio-v1';
const APP_CACHE = `${VERSION}-app`;
const FONT_CACHE = `${VERSION}-fonts`;

// Scope-relative so this works whether the app is served from a domain root
// or a GitHub Pages subdirectory like /Personal-Guidebook/.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      // Don't let one missing optional file abort the whole install.
      .catch(err => console.warn('[sw] Precache incomplete:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  // Lets the page tell a waiting worker to take over immediately.
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function isFontRequest(url) {
  return url.hostname === 'fonts.googleapis.com'
      || url.hostname === 'fonts.gstatic.com';
}

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return path.endsWith('/')
      || path.endsWith('/index.html')
      || path.endsWith('/manifest.json')
      || path.endsWith('/icon.svg');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Never cache live data — places, geocoding, weather, photos. Stale results
  // here would be actively misleading (a "currently open" badge computed from
  // yesterday's hours is worse than no answer at all).
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (!isFontRequest(url) && !isAppShell(url)) return;

  if (isFontRequest(url)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(FONT_CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // App shell: network-first, cache as backup.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(APP_CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
