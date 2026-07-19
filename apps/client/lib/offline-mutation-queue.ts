'use client'

// Offline-first mutation queue: library changes made while the device is
// offline (or while the network is flaking) are applied to local state
// immediately, persisted here, and replayed against the server once the
// connection returns. Server endpoints for likes and playlist membership are
// idempotent, so replaying an op that already landed is harmless.

export type RepeatMode = 'off' | 'one' | 'all'

export type PendingMutation =
  | { kind: 'song-like'; songId: string; liked: boolean }
  | { kind: 'playlist-add-song'; playlistId: string; songId: string }
  | { kind: 'playlist-remove-song'; playlistId: string; songId: string }
  | {
      kind: 'playlist-create'
      playlistId: string
      name: string
      description: string | null
    }
  | {
      kind: 'playlist-update'
      playlistId: string
      name: string
      description: string | null
    }
  | { kind: 'playlist-delete'; playlistId: string }
  | { kind: 'song-delete'; songId: string }
  | {
      kind: 'playback-state'
      songId: string | null
      positionMs: number
      shuffleEnabled: boolean
      repeatMode: RepeatMode
    }

export type QueuedMutation = PendingMutation & {
  id: string
  queuedAt: number
  attempts?: number
}

export type PendingLibraryState = {
  createdPlaylists: Array<{
    playlistId: string
    name: string
    description: string | null
  }>
  deletedPlaylistIds: string[]
  deletedSongIds: string[]
  likedOverrides: Record<string, boolean>
  playlistAdditions: Record<string, string[]>
  playlistSongRemovals: Record<string, string[]>
  playlistUpdates: Record<string, { name: string; description: string | null }>
}

type SyncStatus = 'authenticated' | 'anonymous' | 'not-found' | 'duplicate'

export type MutationSyncApi = {
  addSongToPlaylist: (
    playlistId: string,
    songId: string,
  ) => Promise<{ status: SyncStatus }>
  createPlaylist: (input: {
    name: string
    description?: string | null
  }) => Promise<{ playlist: { id: string } | null; status: SyncStatus }>
  deletePlaylist: (playlistId: string) => Promise<{ status: SyncStatus }>
  deleteSong: (songId: string) => Promise<{ status: SyncStatus }>
  likeSong: (songId: string) => Promise<{ status: SyncStatus }>
  removeSongFromPlaylist: (
    playlistId: string,
    songId: string,
  ) => Promise<{ status: SyncStatus }>
  unlikeSong: (songId: string) => Promise<{ status: SyncStatus }>
  updatePlaybackState: (input: {
    songId: string | null
    positionMs: number
    shuffleEnabled: boolean
    repeatMode: RepeatMode
  }) => Promise<void>
  updatePlaylist: (
    playlistId: string,
    input: { name?: string; description?: string | null },
  ) => Promise<{ status: SyncStatus }>
}

export type FlushResult = {
  applied: number
  blocked: 'auth' | 'offline' | 'error' | null
  remaining: QueuedMutation[]
  remapped: Array<{ localId: string; playlistId: string }>
}

const STORAGE_KEY = 'onvibe:pending-mutations:v1'
const LOCAL_PLAYLIST_ID_PREFIX = 'local-playlist-'
const MAX_HARD_FAILURE_ATTEMPTS = 3
const MUTATION_KINDS = new Set<PendingMutation['kind']>([
  'song-like',
  'playlist-add-song',
  'playlist-remove-song',
  'playlist-create',
  'playlist-update',
  'playlist-delete',
  'song-delete',
  'playback-state',
])

export function createLocalPlaylistId() {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return `${LOCAL_PLAYLIST_ID_PREFIX}${random}`
}

export function isLocalPlaylistId(playlistId: string) {
  return playlistId.startsWith(LOCAL_PLAYLIST_ID_PREFIX)
}

export function enqueueMutation(
  queue: QueuedMutation[],
  mutation: PendingMutation,
): QueuedMutation[] {
  switch (mutation.kind) {
    case 'song-like':
      return [
        ...queue.filter(
          (op) => !(op.kind === 'song-like' && op.songId === mutation.songId),
        ),
        queued(mutation),
      ]

    case 'playlist-add-song': {
      const pendingRemove = queue.find(
        (op) =>
          op.kind === 'playlist-remove-song' &&
          op.playlistId === mutation.playlistId &&
          op.songId === mutation.songId,
      )

      if (pendingRemove) {
        return queue.filter((op) => op !== pendingRemove)
      }

      const alreadyQueued = queue.some(
        (op) =>
          op.kind === 'playlist-add-song' &&
          op.playlistId === mutation.playlistId &&
          op.songId === mutation.songId,
      )

      return alreadyQueued ? queue : [...queue, queued(mutation)]
    }

    case 'playlist-remove-song': {
      const pendingAdd = queue.find(
        (op) =>
          op.kind === 'playlist-add-song' &&
          op.playlistId === mutation.playlistId &&
          op.songId === mutation.songId,
      )

      if (pendingAdd) {
        return queue.filter((op) => op !== pendingAdd)
      }

      const alreadyQueued = queue.some(
        (op) =>
          op.kind === 'playlist-remove-song' &&
          op.playlistId === mutation.playlistId &&
          op.songId === mutation.songId,
      )

      return alreadyQueued ? queue : [...queue, queued(mutation)]
    }

    case 'playlist-create':
      return [...queue, queued(mutation)]

    case 'playlist-update': {
      const pendingCreate = queue.find(
        (op) =>
          op.kind === 'playlist-create' &&
          op.playlistId === mutation.playlistId,
      )

      if (pendingCreate) {
        return queue.map((op) =>
          op === pendingCreate
            ? {
                ...op,
                description: mutation.description,
                name: mutation.name,
              }
            : op,
        )
      }

      return [
        ...queue.filter(
          (op) =>
            !(
              op.kind === 'playlist-update' &&
              op.playlistId === mutation.playlistId
            ),
        ),
        queued(mutation),
      ]
    }

    case 'playlist-delete': {
      const hadPendingCreate = queue.some(
        (op) =>
          op.kind === 'playlist-create' &&
          op.playlistId === mutation.playlistId,
      )
      const withoutPlaylist = queue.filter(
        (op) => playlistIdOf(op) !== mutation.playlistId,
      )

      return hadPendingCreate
        ? withoutPlaylist
        : [...withoutPlaylist, queued(mutation)]
    }

    case 'song-delete':
      return [
        ...queue.filter((op) => {
          if (op.kind === 'song-like') return op.songId !== mutation.songId
          if (
            op.kind === 'playlist-add-song' ||
            op.kind === 'playlist-remove-song'
          ) {
            return op.songId !== mutation.songId
          }
          return true
        }),
        queued(mutation),
      ]

    case 'playback-state':
      return [
        ...queue.filter((op) => op.kind !== 'playback-state'),
        queued(mutation),
      ]
  }
}

export function pendingLibraryState(
  queue: QueuedMutation[],
): PendingLibraryState {
  const state: PendingLibraryState = {
    createdPlaylists: [],
    deletedPlaylistIds: [],
    deletedSongIds: [],
    likedOverrides: {},
    playlistAdditions: {},
    playlistSongRemovals: {},
    playlistUpdates: {},
  }

  for (const op of queue) {
    switch (op.kind) {
      case 'song-like':
        state.likedOverrides[op.songId] = op.liked
        break
      case 'playlist-add-song':
        state.playlistAdditions[op.playlistId] = [
          ...(state.playlistAdditions[op.playlistId] ?? []).filter(
            (songId) => songId !== op.songId,
          ),
          op.songId,
        ]
        state.playlistSongRemovals[op.playlistId] = (
          state.playlistSongRemovals[op.playlistId] ?? []
        ).filter((songId) => songId !== op.songId)
        if (state.playlistSongRemovals[op.playlistId].length === 0) {
          delete state.playlistSongRemovals[op.playlistId]
        }
        break
      case 'playlist-remove-song':
        state.playlistSongRemovals[op.playlistId] = [
          ...(state.playlistSongRemovals[op.playlistId] ?? []).filter(
            (songId) => songId !== op.songId,
          ),
          op.songId,
        ]
        break
      case 'playlist-create':
        state.createdPlaylists.push({
          description: op.description,
          name: op.name,
          playlistId: op.playlistId,
        })
        break
      case 'playlist-update':
        state.playlistUpdates[op.playlistId] = {
          description: op.description,
          name: op.name,
        }
        break
      case 'playlist-delete':
        state.deletedPlaylistIds.push(op.playlistId)
        state.createdPlaylists = state.createdPlaylists.filter(
          (playlist) => playlist.playlistId !== op.playlistId,
        )
        delete state.playlistAdditions[op.playlistId]
        delete state.playlistSongRemovals[op.playlistId]
        delete state.playlistUpdates[op.playlistId]
        break
      case 'song-delete':
        state.deletedSongIds.push(op.songId)
        delete state.likedOverrides[op.songId]
        for (const playlistId of Object.keys(state.playlistAdditions)) {
          state.playlistAdditions[playlistId] = state.playlistAdditions[
            playlistId
          ].filter((songId) => songId !== op.songId)
          if (state.playlistAdditions[playlistId].length === 0) {
            delete state.playlistAdditions[playlistId]
          }
        }
        break
      case 'playback-state':
        break
    }
  }

  return state
}

export async function flushPendingMutations(
  queue: QueuedMutation[],
  api: MutationSyncApi,
): Promise<FlushResult> {
  let pending = [...queue]
  const remapped: Array<{ localId: string; playlistId: string }> = []
  let applied = 0

  while (pending.length > 0) {
    const op = pending[0]

    try {
      const outcome = await applyMutation(op, api)

      if (outcome === 'auth') {
        return { applied, blocked: 'auth', remaining: pending, remapped }
      }

      if (outcome === 'applied') {
        applied += 1
      }

      if (typeof outcome === 'object') {
        applied += 1
        remapped.push(outcome)
        pending = remapPlaylistId(
          pending.slice(1),
          outcome.localId,
          outcome.playlistId,
        )
        continue
      }

      pending = pending.slice(1)
    } catch (error) {
      if (isOfflineSyncError(error)) {
        return { applied, blocked: 'offline', remaining: pending, remapped }
      }

      const attempts = (op.attempts ?? 0) + 1

      if (attempts >= MAX_HARD_FAILURE_ATTEMPTS) {
        // Poisoned mutation: give the rest of the queue a chance.
        pending = pending.slice(1)
        continue
      }

      return {
        applied,
        blocked: 'error',
        remaining: [{ ...op, attempts }, ...pending.slice(1)],
        remapped,
      }
    }
  }

  return { applied, blocked: null, remaining: pending, remapped }
}

export function remapPlaylistId(
  queue: QueuedMutation[],
  localId: string,
  playlistId: string,
): QueuedMutation[] {
  return queue.map((op) =>
    playlistIdOf(op) === localId ? { ...op, playlistId } : op,
  )
}

export function isOfflineSyncError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true
  }

  // The service worker answers API calls with a JSON 503 while offline, and
  // gateway errors are as good as offline for sync purposes.
  return error instanceof Error && /status 50[234]\b/.test(error.message)
}

export function readPendingMutations(
  userId: string | undefined,
): QueuedMutation[] {
  if (!userId || typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as {
      mutations?: unknown
      userId?: unknown
    }

    if (parsed.userId !== userId || !Array.isArray(parsed.mutations)) {
      return []
    }

    return parsed.mutations.filter(isQueuedMutation)
  } catch {
    return []
  }
}

export function writePendingMutations(
  userId: string | undefined,
  queue: QueuedMutation[],
) {
  if (!userId || typeof window === 'undefined') return

  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mutations: queue, userId }),
    )
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

async function applyMutation(
  op: QueuedMutation,
  api: MutationSyncApi,
): Promise<'applied' | 'dropped' | 'auth' | { localId: string; playlistId: string }> {
  switch (op.kind) {
    case 'song-like': {
      const result = op.liked
        ? await api.likeSong(op.songId)
        : await api.unlikeSong(op.songId)
      return statusOutcome(result.status)
    }
    case 'playlist-add-song':
      return statusOutcome(
        (await api.addSongToPlaylist(op.playlistId, op.songId)).status,
      )
    case 'playlist-remove-song':
      return statusOutcome(
        (await api.removeSongFromPlaylist(op.playlistId, op.songId)).status,
      )
    case 'playlist-create': {
      const result = await api.createPlaylist({
        description: op.description,
        name: op.name,
      })

      if (result.status === 'anonymous') return 'auth'
      if (!result.playlist) return 'dropped'

      return { localId: op.playlistId, playlistId: result.playlist.id }
    }
    case 'playlist-update':
      return statusOutcome(
        (
          await api.updatePlaylist(op.playlistId, {
            description: op.description,
            name: op.name,
          })
        ).status,
      )
    case 'playlist-delete':
      return statusOutcome((await api.deletePlaylist(op.playlistId)).status)
    case 'song-delete':
      return statusOutcome((await api.deleteSong(op.songId)).status)
    case 'playback-state':
      await api.updatePlaybackState({
        positionMs: op.positionMs,
        repeatMode: op.repeatMode,
        shuffleEnabled: op.shuffleEnabled,
        songId: op.songId,
      })
      return 'applied'
  }
}

function statusOutcome(status: SyncStatus): 'applied' | 'dropped' | 'auth' {
  if (status === 'authenticated') return 'applied'
  if (status === 'anonymous') return 'auth'
  // not-found / duplicate: the target is gone or the change already exists.
  return 'dropped'
}

function playlistIdOf(op: QueuedMutation): string | null {
  return 'playlistId' in op ? op.playlistId : null
}

function queued(mutation: PendingMutation): QueuedMutation {
  return {
    ...mutation,
    id: nextMutationId(),
    queuedAt: Date.now(),
  }
}

function nextMutationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isQueuedMutation(value: unknown): value is QueuedMutation {
  if (!value || typeof value !== 'object') return false

  const op = value as Partial<QueuedMutation>

  return (
    typeof op.id === 'string' &&
    typeof op.queuedAt === 'number' &&
    typeof op.kind === 'string' &&
    MUTATION_KINDS.has(op.kind as PendingMutation['kind'])
  )
}
