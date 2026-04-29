'use client'

const THUMBNAIL_CACHE_NAME = 'onvibe-track-thumbnails-v3'
const CACHE_MESSAGE_TYPE = 'CACHE_TRACK_THUMBNAILS'
const THUMBNAIL_CACHE_CONCURRENCY = 6
const MAX_THUMBNAIL_PREFETCHES = 120

export function cacheTrackThumbnails(urls: Array<string | null | undefined>) {
  if (typeof window === 'undefined') return

  const thumbnailUrls = uniqueHttpUrls(urls).slice(0, MAX_THUMBNAIL_PREFETCHES)
  if (thumbnailUrls.length === 0) return

  postThumbnailCacheMessage(thumbnailUrls)
  void cacheThumbnailsInWindow(thumbnailUrls)
}

function uniqueHttpUrls(urls: Array<string | null | undefined>) {
  const seen = new Set<string>()

  for (const rawUrl of urls) {
    if (!rawUrl) continue

    try {
      const url = new URL(rawUrl, window.location.origin)

      if (!['http:', 'https:'].includes(url.protocol)) {
        continue
      }

      seen.add(url.href)
    } catch {
      // Ignore malformed artwork URLs.
    }
  }

  return [...seen]
}

function postThumbnailCacheMessage(urls: string[]) {
  if (!('serviceWorker' in navigator)) return

  const message = {
    type: CACHE_MESSAGE_TYPE,
    urls,
  }

  navigator.serviceWorker.controller?.postMessage(message)

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage(message)
    })
    .catch(() => undefined)
}

async function cacheThumbnailsInWindow(urls: string[]) {
  if (!('caches' in window)) return

  try {
    const cache = await caches.open(THUMBNAIL_CACHE_NAME)

    await runWithConcurrency(
      urls,
      THUMBNAIL_CACHE_CONCURRENCY,
      async (url) => {
        const cached = await cache.match(url, { ignoreVary: true })
        if (cached) return

        const response = await fetch(url, {
          cache: 'force-cache',
          credentials: 'omit',
          mode: 'no-cors',
          referrerPolicy: 'no-referrer',
        })

        if (response.ok || response.type === 'opaque') {
          await cache.put(url, response)
        }
      },
    )
  } catch {
    // Thumbnail caching is opportunistic; direct image loading can still work.
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
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
