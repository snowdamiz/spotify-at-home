/* global AbortController, Request, Response, caches, clearTimeout, fetch, self */

const CACHE_VERSION = 'v3'
const SHELL_CACHE = `onvibe-shell-${CACHE_VERSION}`
const RUNTIME_CACHE = `onvibe-runtime-${CACHE_VERSION}`
const TRACK_THUMBNAIL_CACHE = `onvibe-track-thumbnails-${CACHE_VERSION}`
const NAVIGATION_TIMEOUT_MS = 3500
const THUMBNAIL_CACHE_CONCURRENCY = 6
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/apple-icon.png',
  '/brand/icon-32.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/icon-maskable-192.png',
  '/brand/icon-maskable-512.png',
  '/placeholder.svg',
  '/placeholder.jpg',
  '/placeholder-logo.png',
  '/placeholder-logo.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAppShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('onvibe-') &&
                key !== SHELL_CACHE &&
                key !== RUNTIME_CACHE &&
                key !== TRACK_THUMBNAIL_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  if (event.data?.type === 'CACHE_TRACK_THUMBNAILS') {
    event.waitUntil(cacheTrackThumbnails(event.data.urls))
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    if (request.destination === 'image') {
      event.respondWith(cacheFirstThumbnail(request))
    }
    return
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOrOfflineJson(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (isStaticRequest(request, url)) {
    event.respondWith(cacheFirst(request))
  }
})

async function precacheAppShell() {
  const cache = await caches.open(SHELL_CACHE)

  await Promise.all(APP_SHELL.map((url) => cacheUrl(cache, url)))

  const shell = await cache.match('/')
  if (shell) {
    await cacheLinkedAssetsFromHtml(shell.clone(), cache)
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)

  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)

    if (response.ok) {
      await cache.put('/', response.clone())
      await cacheLinkedAssetsFromHtml(response.clone(), cache)
    }

    return response
  } catch {
    const cached = (await caches.match(request)) ?? (await caches.match('/'))

    if (cached) return cached

    return offlineShellResponse()
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)

  if (cached) return cached

  try {
    const response = await fetch(request)

    if (isCacheableResponse(response)) {
      const cache = await caches.open(cacheNameForRequest(request))
      await cache.put(request, response.clone())
    }

    return response
  } catch {
    if (request.destination === 'image') {
      const placeholder = await caches.match('/placeholder.svg')
      if (placeholder) return placeholder
    }

    throw new Error('OnVibe is offline and this asset is not cached.')
  }
}

async function cacheFirstThumbnail(request) {
  const cache = await caches.open(TRACK_THUMBNAIL_CACHE)
  const cached =
    (await cache.match(request, { ignoreVary: true })) ??
    (await cache.match(request.url, { ignoreVary: true }))

  if (cached) return cached

  try {
    const response = await fetch(request)

    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone())
    }

    return response
  } catch {
    const placeholder = await caches.match('/placeholder.svg')
    if (placeholder) return placeholder

    throw new Error('OnVibe is offline and this thumbnail is not cached.')
  }
}

async function cacheTrackThumbnails(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return

  const cache = await caches.open(TRACK_THUMBNAIL_CACHE)
  const uniqueUrls = [...new Set(urls.filter(isHttpUrl))]

  await runWithConcurrency(
    uniqueUrls,
    THUMBNAIL_CACHE_CONCURRENCY,
    async (url) => {
      const cached = await cache.match(url, { ignoreVary: true })
      if (cached) return

      try {
        const request = new Request(url, {
          cache: 'force-cache',
          credentials: 'omit',
          mode: 'no-cors',
          referrerPolicy: 'no-referrer',
        })
        const response = await fetch(request)

        if (isCacheableResponse(response)) {
          await cache.put(url, response)
        }
      } catch {
        // Thumbnail warming should never interrupt the app shell.
      }
    },
  )
}

async function networkOrOfflineJson(request) {
  try {
    return await fetch(request)
  } catch {
    return new Response(
      JSON.stringify({
        error: {
          message: 'OnVibe is offline. Reconnect to sync with the server.',
        },
      }),
      {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
        },
        status: 503,
      },
    )
  }
}

async function cacheUrl(cache, url) {
  try {
    const response = await fetch(url, { cache: 'reload' })

    if (response.ok) {
      await cache.put(url, response.clone())
    }

    return response
  } catch {
    return null
  }
}

async function cacheLinkedAssetsFromHtml(response, cache) {
  const html = await response.text().catch(() => '')
  if (!html) return

  const assetUrls = new Set()
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g
  let match = attributePattern.exec(html)

  while (match) {
    const assetUrl = normalizeShellAssetUrl(match[1])

    if (assetUrl) {
      assetUrls.add(assetUrl)
    }

    match = attributePattern.exec(html)
  }

  await Promise.all([...assetUrls].map((url) => cacheUrl(cache, url)))
}

function normalizeShellAssetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl.replace(/&amp;/g, '&'), self.location.origin)

    if (url.origin !== self.location.origin || !isShellAssetPath(url.pathname)) {
      return null
    }

    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function isStaticRequest(request, url) {
  return (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    request.destination === 'manifest' ||
    isShellAssetPath(url.pathname)
  )
}

function isShellAssetPath(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/brand/') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/icon.svg' ||
    pathname === '/apple-icon.png' ||
    pathname === '/favicon.ico' ||
    pathname === '/placeholder.svg' ||
    pathname === '/placeholder.jpg' ||
    pathname === '/placeholder-logo.png' ||
    pathname === '/placeholder-logo.svg' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  )
}

function cacheNameForRequest(request) {
  return request.destination === 'script' || request.destination === 'style'
    ? SHELL_CACHE
    : RUNTIME_CACHE
}

function isCacheableResponse(response) {
  return response.ok || response.type === 'opaque'
}

function isHttpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        await worker(item)
      }
    }),
  )
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function offlineShellResponse() {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <title>OnVibe offline</title>
    <style>
      :root {
        color-scheme: dark;
        background: #000;
        color: #f7f7f7;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        min-height: 100dvh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: max(1.25rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right)) max(1.25rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
        background: #000;
      }
      main {
        max-width: 28rem;
        border: 1px solid rgb(255 255 255 / 0.12);
        border-radius: 1rem;
        padding: 1.5rem;
        background: rgb(255 255 255 / 0.06);
      }
      h1 {
        margin: 0;
        font-size: 1.4rem;
      }
      p {
        margin: 0.75rem 0 0;
        color: rgb(255 255 255 / 0.72);
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OnVibe is offline</h1>
      <p>Reconnect once to finish installing the app shell, then saved tracks will open from this device.</p>
    </main>
  </body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
      status: 200,
    },
  )
}
