import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueMutation,
  flushPendingMutations,
  isLocalPlaylistId,
  isOfflineSyncError,
  createLocalPlaylistId,
  pendingLibraryState,
  readPendingMutations,
  remapPlaylistId,
  writePendingMutations,
  type MutationSyncApi,
  type PendingMutation,
  type QueuedMutation,
} from '@/lib/offline-mutation-queue'

function enqueueAll(mutations: PendingMutation[]) {
  return mutations.reduce<QueuedMutation[]>(
    (queue, mutation) => enqueueMutation(queue, mutation),
    [],
  )
}

function syncApi(overrides: Partial<MutationSyncApi> = {}): MutationSyncApi {
  return {
    addSongToPlaylist: vi.fn(async () => ({ status: 'authenticated' as const })),
    createPlaylist: vi.fn(async () => ({
      playlist: { id: 'server-playlist' },
      status: 'authenticated' as const,
    })),
    deletePlaylist: vi.fn(async () => ({ status: 'authenticated' as const })),
    deleteSong: vi.fn(async () => ({ status: 'authenticated' as const })),
    likeSong: vi.fn(async () => ({ status: 'authenticated' as const })),
    removeSongFromPlaylist: vi.fn(async () => ({
      status: 'authenticated' as const,
    })),
    unlikeSong: vi.fn(async () => ({ status: 'authenticated' as const })),
    updatePlaybackState: vi.fn(async () => undefined),
    updatePlaylist: vi.fn(async () => ({ status: 'authenticated' as const })),
    ...overrides,
  }
}

describe('enqueueMutation', () => {
  it('keeps only the latest like state per song', () => {
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'song-like', liked: true, songId: 's2' },
      { kind: 'song-like', liked: false, songId: 's1' },
    ])

    expect(queue).toHaveLength(2)
    expect(queue[0]).toMatchObject({ kind: 'song-like', songId: 's2' })
    expect(queue[1]).toMatchObject({
      kind: 'song-like',
      liked: false,
      songId: 's1',
    })
  })

  it('cancels a pending playlist add when the same song is removed', () => {
    const queue = enqueueAll([
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
      { kind: 'playlist-remove-song', playlistId: 'p1', songId: 's1' },
    ])

    expect(queue).toHaveLength(0)
  })

  it('cancels a pending playlist remove when the same song is re-added', () => {
    const queue = enqueueAll([
      { kind: 'playlist-remove-song', playlistId: 'p1', songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
    ])

    expect(queue).toHaveLength(0)
  })

  it('does not queue duplicate playlist additions', () => {
    const queue = enqueueAll([
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
    ])

    expect(queue).toHaveLength(1)
  })

  it('merges edits into a pending local playlist create', () => {
    const localId = createLocalPlaylistId()
    const queue = enqueueAll([
      { description: null, kind: 'playlist-create', name: 'Road trip', playlistId: localId },
      { description: 'Long drives', kind: 'playlist-update', name: 'Road Trip 2', playlistId: localId },
    ])

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      description: 'Long drives',
      kind: 'playlist-create',
      name: 'Road Trip 2',
    })
  })

  it('keeps only the latest update per server playlist', () => {
    const queue = enqueueAll([
      { description: null, kind: 'playlist-update', name: 'One', playlistId: 'p1' },
      { description: 'x', kind: 'playlist-update', name: 'Two', playlistId: 'p1' },
    ])

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ kind: 'playlist-update', name: 'Two' })
  })

  it('drops every pending op for a locally created playlist when it is deleted', () => {
    const localId = createLocalPlaylistId()
    const queue = enqueueAll([
      { description: null, kind: 'playlist-create', name: 'Temp', playlistId: localId },
      { kind: 'playlist-add-song', playlistId: localId, songId: 's1' },
      { kind: 'playlist-delete', playlistId: localId },
    ])

    expect(queue).toHaveLength(0)
  })

  it('replaces pending playlist ops with a delete for server playlists', () => {
    const queue = enqueueAll([
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
      { description: null, kind: 'playlist-update', name: 'New', playlistId: 'p1' },
      { kind: 'playlist-delete', playlistId: 'p1' },
    ])

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ kind: 'playlist-delete', playlistId: 'p1' })
  })

  it('purges references to a deleted song', () => {
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
      { kind: 'playlist-remove-song', playlistId: 'p2', songId: 's1' },
      { kind: 'song-like', liked: true, songId: 's2' },
      { kind: 'song-delete', songId: 's1' },
    ])

    expect(queue).toHaveLength(2)
    expect(queue[0]).toMatchObject({ kind: 'song-like', songId: 's2' })
    expect(queue[1]).toMatchObject({ kind: 'song-delete', songId: 's1' })
  })

  it('keeps only the latest playback state', () => {
    const queue = enqueueAll([
      {
        kind: 'playback-state',
        positionMs: 0,
        repeatMode: 'off',
        shuffleEnabled: false,
        songId: 's1',
      },
      {
        kind: 'playback-state',
        positionMs: 100,
        repeatMode: 'all',
        shuffleEnabled: true,
        songId: 's2',
      },
    ])

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ kind: 'playback-state', songId: 's2' })
  })
})

describe('pendingLibraryState', () => {
  it('folds queued mutations into seedable library state', () => {
    const localId = createLocalPlaylistId()
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'song-like', liked: false, songId: 's2' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's3' },
      { kind: 'playlist-remove-song', playlistId: 'p1', songId: 's4' },
      { description: 'Fresh', kind: 'playlist-create', name: 'New Mix', playlistId: localId },
      { kind: 'playlist-add-song', playlistId: localId, songId: 's1' },
      { description: null, kind: 'playlist-update', name: 'Renamed', playlistId: 'p2' },
      { kind: 'playlist-delete', playlistId: 'p3' },
      { kind: 'song-delete', songId: 's9' },
    ])

    const state = pendingLibraryState(queue)

    expect(state.likedOverrides).toEqual({ s1: true, s2: false })
    expect(state.playlistAdditions).toEqual({ p1: ['s3'], [localId]: ['s1'] })
    expect(state.playlistSongRemovals).toEqual({ p1: ['s4'] })
    expect(state.createdPlaylists).toEqual([
      { description: 'Fresh', name: 'New Mix', playlistId: localId },
    ])
    expect(state.playlistUpdates).toEqual({
      p2: { description: null, name: 'Renamed' },
    })
    expect(state.deletedPlaylistIds).toEqual(['p3'])
    expect(state.deletedSongIds).toEqual(['s9'])
  })

  it('does not resurrect state for deleted playlists', () => {
    const queue = enqueueAll([
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's1' },
      { kind: 'playlist-delete', playlistId: 'p1' },
    ])

    const state = pendingLibraryState(queue)

    expect(state.playlistAdditions).toEqual({})
    expect(state.deletedPlaylistIds).toEqual(['p1'])
  })
})

describe('flushPendingMutations', () => {
  it('applies mutations in order and drains the queue', async () => {
    const api = syncApi()
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's2' },
      { kind: 'song-like', liked: false, songId: 's3' },
    ])

    const result = await flushPendingMutations(queue, api)

    expect(result.applied).toBe(3)
    expect(result.remaining).toHaveLength(0)
    expect(result.blocked).toBeNull()
    expect(api.likeSong).toHaveBeenCalledWith('s1')
    expect(api.addSongToPlaylist).toHaveBeenCalledWith('p1', 's2')
    expect(api.unlikeSong).toHaveBeenCalledWith('s3')
  })

  it('remaps local playlist ids after the create syncs', async () => {
    const localId = createLocalPlaylistId()
    const api = syncApi({
      createPlaylist: vi.fn(async () => ({
        playlist: { id: 'p77' },
        status: 'authenticated' as const,
      })),
    })
    const queue = enqueueAll([
      { description: null, kind: 'playlist-create', name: 'Mix', playlistId: localId },
      { kind: 'playlist-add-song', playlistId: localId, songId: 's1' },
    ])

    const result = await flushPendingMutations(queue, api)

    expect(api.addSongToPlaylist).toHaveBeenCalledWith('p77', 's1')
    expect(result.remapped).toEqual([{ localId, playlistId: 'p77' }])
    expect(result.remaining).toHaveLength(0)
  })

  it('stops without losing the queue when the session expired', async () => {
    const api = syncApi({
      likeSong: vi.fn(async () => ({ status: 'anonymous' as const })),
    })
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'song-like', liked: true, songId: 's2' },
    ])

    const result = await flushPendingMutations(queue, api)

    expect(result.blocked).toBe('auth')
    expect(result.applied).toBe(0)
    expect(result.remaining).toHaveLength(2)
  })

  it('drops mutations whose target is gone or already applied', async () => {
    const api = syncApi({
      addSongToPlaylist: vi.fn(async () => ({ status: 'duplicate' as const })),
      likeSong: vi.fn(async () => ({ status: 'not-found' as const })),
    })
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's2' },
    ])

    const result = await flushPendingMutations(queue, api)

    expect(result.remaining).toHaveLength(0)
    expect(result.applied).toBe(0)
    expect(result.blocked).toBeNull()
  })

  it('stops on a network failure and keeps unapplied mutations', async () => {
    const api = syncApi({
      addSongToPlaylist: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's2' },
      { kind: 'song-like', liked: true, songId: 's3' },
    ])

    const result = await flushPendingMutations(queue, api)

    expect(result.blocked).toBe('offline')
    expect(result.applied).toBe(1)
    expect(result.remaining).toHaveLength(2)
    expect(result.remaining[0]).toMatchObject({ kind: 'playlist-add-song' })
  })

  it('treats the service worker offline 503 as a network failure', async () => {
    const api = syncApi({
      likeSong: vi.fn(async () => {
        throw new Error('Like song request failed with status 503')
      }),
    })
    const queue = enqueueAll([{ kind: 'song-like', liked: true, songId: 's1' }])

    const result = await flushPendingMutations(queue, api)

    expect(result.blocked).toBe('offline')
    expect(result.remaining).toHaveLength(1)
  })

  it('counts attempts on hard failures and drops the mutation when exhausted', async () => {
    const api = syncApi({
      likeSong: vi.fn(async () => {
        throw new Error('Like song request failed with status 400')
      }),
    })
    let queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'song-like', liked: true, songId: 's2' },
    ])

    const first = await flushPendingMutations(queue, api)
    expect(first.blocked).toBe('error')
    expect(first.remaining[0]).toMatchObject({ attempts: 1 })

    queue = first.remaining
    const second = await flushPendingMutations(queue, api)
    expect(second.remaining[0]).toMatchObject({ attempts: 2 })

    queue = second.remaining
    const third = await flushPendingMutations(queue, api)

    // The poisoned mutation is dropped on its final attempt and the rest of
    // the queue still gets a chance in the same flush.
    expect(third.remaining).toHaveLength(1)
    expect(third.remaining[0]).toMatchObject({ attempts: 1, songId: 's2' })
    expect(api.likeSong).toHaveBeenCalledWith('s2')
  })

  it('syncs the latest queued playback state', async () => {
    const api = syncApi()
    const queue = enqueueAll([
      {
        kind: 'playback-state',
        positionMs: 5000,
        repeatMode: 'all',
        shuffleEnabled: true,
        songId: 's1',
      },
    ])

    const result = await flushPendingMutations(queue, api)

    expect(api.updatePlaybackState).toHaveBeenCalledWith({
      positionMs: 5000,
      repeatMode: 'all',
      shuffleEnabled: true,
      songId: 's1',
    })
    expect(result.remaining).toHaveLength(0)
  })
})

describe('remapPlaylistId', () => {
  it('rewrites queued ops that reference the local playlist id', () => {
    const localId = createLocalPlaylistId()
    const queue = enqueueAll([
      { kind: 'playlist-add-song', playlistId: localId, songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's2' },
    ])

    const remapped = remapPlaylistId(queue, localId, 'p42')

    expect(remapped[0]).toMatchObject({ playlistId: 'p42' })
    expect(remapped[1]).toMatchObject({ playlistId: 'p1' })
  })
})

describe('isOfflineSyncError', () => {
  it('detects fetch network failures', () => {
    expect(isOfflineSyncError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('detects gateway/offline statuses from the service worker', () => {
    expect(
      isOfflineSyncError(new Error('Like song request failed with status 503')),
    ).toBe(true)
    expect(
      isOfflineSyncError(new Error('Request failed with status 502')),
    ).toBe(true)
    expect(
      isOfflineSyncError(new Error('Request failed with status 504')),
    ).toBe(true)
  })

  it('does not flag ordinary API errors', () => {
    expect(
      isOfflineSyncError(new Error('Like song request failed with status 404')),
    ).toBe(false)
    expect(isOfflineSyncError(new Error('boom'))).toBe(false)
    expect(isOfflineSyncError('nope')).toBe(false)
  })
})

describe('local playlist ids', () => {
  it('creates ids recognizable as local', () => {
    const id = createLocalPlaylistId()

    expect(isLocalPlaylistId(id)).toBe(true)
    expect(isLocalPlaylistId('p1')).toBe(false)
  })
})

describe('persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubLocalStorage() {
    const store = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => void store.set(key, value),
    }

    vi.stubGlobal('window', { localStorage })
    return store
  }

  it('round-trips the queue for the same user', () => {
    stubLocalStorage()
    const queue = enqueueAll([
      { kind: 'song-like', liked: true, songId: 's1' },
      { kind: 'playlist-add-song', playlistId: 'p1', songId: 's2' },
    ])

    writePendingMutations('user-1', queue)

    expect(readPendingMutations('user-1')).toEqual(queue)
  })

  it('ignores a queue stored for another user', () => {
    stubLocalStorage()
    const queue = enqueueAll([{ kind: 'song-like', liked: true, songId: 's1' }])

    writePendingMutations('user-1', queue)

    expect(readPendingMutations('user-2')).toEqual([])
  })

  it('clears the stored queue when it drains', () => {
    const store = stubLocalStorage()
    const queue = enqueueAll([{ kind: 'song-like', liked: true, songId: 's1' }])

    writePendingMutations('user-1', queue)
    writePendingMutations('user-1', [])

    expect(store.size).toBe(0)
  })

  it('survives corrupt stored data', () => {
    const store = stubLocalStorage()
    store.set('onvibe:pending-mutations:v1', '{not json')

    expect(readPendingMutations('user-1')).toEqual([])
  })
})
