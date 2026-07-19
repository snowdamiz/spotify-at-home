import { describe, expect, it, vi } from 'vitest'
import { TrackSourceCache } from '@/lib/playback/track-sources'

type TestTrack = { id: string }

function createCache(overrides: {
  getOfflineBlob?: (track: TestTrack) => Promise<Blob | null>
} = {}) {
  let objectUrlCounter = 0
  const revoked: string[] = []
  const getOfflineBlob = vi.fn(
    overrides.getOfflineBlob ?? (async () => null),
  )
  const cache = new TrackSourceCache<TestTrack>({
    createObjectUrl: () => `blob:fake-${objectUrlCounter++}`,
    getOfflineBlob,
    revokeObjectUrl: (url) => revoked.push(url),
    streamUrl: (id) => `/api/songs/${id}/stream`,
  })

  return { cache, getOfflineBlob, revoked }
}

const blob = () => new Blob(['audio-bytes'], { type: 'audio/mpeg' })

describe('TrackSourceCache', () => {
  it('returns the stream url before anything is preloaded', () => {
    const { cache } = createCache()

    expect(cache.getSync({ id: 'song-1' })).toEqual({
      kind: 'stream',
      url: '/api/songs/song-1/stream',
    })
  })

  it('returns a preloaded offline object url synchronously', async () => {
    const { cache } = createCache({ getOfflineBlob: async () => blob() })

    await cache.preload({ id: 'song-1' })

    expect(cache.getSync({ id: 'song-1' })).toEqual({
      kind: 'offline',
      url: 'blob:fake-0',
    })
  })

  it('falls back to the stream url when no offline copy exists', async () => {
    const { cache } = createCache({ getOfflineBlob: async () => null })

    await cache.preload({ id: 'song-1' })

    expect(cache.getSync({ id: 'song-1' })).toEqual({
      kind: 'stream',
      url: '/api/songs/song-1/stream',
    })
  })

  it('falls back to the stream url when the offline read fails', async () => {
    const { cache } = createCache({
      getOfflineBlob: async () => {
        throw new Error('indexeddb unavailable')
      },
    })

    await expect(cache.preload({ id: 'song-1' })).resolves.toBeUndefined()
    expect(cache.getSync({ id: 'song-1' })).toEqual({
      kind: 'stream',
      url: '/api/songs/song-1/stream',
    })
  })

  it('only reads the offline copy once per song while cached', async () => {
    const { cache, getOfflineBlob } = createCache({
      getOfflineBlob: async () => blob(),
    })

    await Promise.all([
      cache.preload({ id: 'song-1' }),
      cache.preload({ id: 'song-1' }),
    ])
    await cache.preload({ id: 'song-1' })

    expect(getOfflineBlob).toHaveBeenCalledTimes(1)
  })

  it('revokes object urls when entries are pruned', async () => {
    const { cache, revoked } = createCache({
      getOfflineBlob: async () => blob(),
    })

    await cache.preload({ id: 'song-1' })
    await cache.preload({ id: 'song-2' })

    cache.prune(['song-2'])

    expect(revoked).toEqual(['blob:fake-0'])
    expect(cache.getSync({ id: 'song-1' })).toEqual({
      kind: 'stream',
      url: '/api/songs/song-1/stream',
    })
    expect(cache.getSync({ id: 'song-2' })).toEqual({
      kind: 'offline',
      url: 'blob:fake-1',
    })
  })

  it('reloads the offline copy after being pruned', async () => {
    const { cache, getOfflineBlob } = createCache({
      getOfflineBlob: async () => blob(),
    })

    await cache.preload({ id: 'song-1' })
    cache.prune([])
    await cache.preload({ id: 'song-1' })

    expect(getOfflineBlob).toHaveBeenCalledTimes(2)
    expect(cache.getSync({ id: 'song-1' }).kind).toBe('offline')
  })

  it('clears everything and revokes urls on dispose', async () => {
    const { cache, revoked } = createCache({
      getOfflineBlob: async () => blob(),
    })

    await cache.preload({ id: 'song-1' })
    cache.dispose()

    expect(revoked).toEqual(['blob:fake-0'])
    expect(cache.getSync({ id: 'song-1' }).kind).toBe('stream')
  })
})
