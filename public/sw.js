/* Svenska Matcher – lightweight offline shell + last matches cache */
const SHELL = 'sm-shell-v2'
const API = 'sm-api-v2'
const SHELL_URLS = ['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== API).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/matches')) {
    event.respondWith(networkFirstApi(req))
    return
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)))
    return
  }

  // Always prefer network for navigations / HTML so deploys show up in Safari.
  const accept = req.headers.get('accept') || ''
  if (req.mode === 'navigate' || accept.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstHtml(req))
    return
  }

  // Hashed Vite assets + icons: cache-first is fine.
  event.respondWith(cacheFirstShell(req))
})

async function networkFirstApi(req) {
  const cache = await caches.open(API)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    const hit = await cache.match(req)
    if (hit) return hit
    return new Response(JSON.stringify({ error: 'Offline – ingen cachad matchdata' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}

async function networkFirstHtml(req) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(SHELL)
      cache.put(req, res.clone())
      if (req.mode === 'navigate') {
        cache.put('/index.html', res.clone())
      }
    }
    return res
  } catch {
    const hit =
      (await caches.match(req)) ||
      (await caches.match('/index.html')) ||
      (await caches.match('/'))
    return hit ?? Response.error()
  }
}

async function cacheFirstShell(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res.ok && req.url.startsWith(self.location.origin)) {
      const cache = await caches.open(SHELL)
      cache.put(req, res.clone())
    }
    return res
  } catch {
    return Response.error()
  }
}
