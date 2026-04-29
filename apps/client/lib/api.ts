import {
  getImportPolicyModeCopy,
  SUPPORTED_AUDIO_MIME_TYPES,
  type ExternalDiscoveryResponse,
  type ExternalDiscoveryResult,
  type ImportPolicyMode,
  type SerializedExternalImportJob,
  type SerializedExternalSource,
} from '@broadside/shared'
import { pickCoverColor, type Song } from '@/lib/music-types'

export interface CurrentUser {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  entryKeyRedeemedAt: string | null
  hasEntryAccess: boolean
  isAdmin: boolean
}

export interface EntryKeySummary {
  id: string
  keyPrefix: string
  label: string | null
  createdByUserId: string | null
  createdAt: string
  consumedByUserId: string | null
  consumedByUserEmail: string | null
  consumedAt: string | null
}

export interface AccountTrackWipeDeletion {
  clearedStorageReferences: number
  deletedTracks: number
  deletedStoredObjects: number
  failedStoredObjects: number
  retainedStoredObjects: number
  storageCandidates: number
  storageDeleteRequested: boolean
}

export interface StorageObjectSummary {
  storagePath: string
  location: 'r2' | 'local'
  songCount: number
  activeSongCount: number
  sizeBytes: number
  declaredSizeBytes: number
  exists: boolean
  mimeType: string | null
  ownerEmails: string[]
  sampleTitle: string | null
  earliestCreatedAt: string
  latestUpdatedAt: string
}

export interface AdminStorageOverview {
  driver: 'r2' | 'local'
  objects: StorageObjectSummary[]
  returnedObjects: number
  totalBytes: number
  totalObjects: number
}

export interface ServerSong {
  id: string
  userId?: string
  title: string
  artist: string | null
  album: string | null
  durationMs: number | null
  mimeType: string
  sizeBytes: number
  checksum: string
  importStatus: 'ready'
  externalSource?: SerializedExternalSource | null
  liked: boolean
  createdAt: string
  updatedAt: string
}

export interface ServerPlaylist {
  id: string
  userId?: string
  name: string
  description: string | null
  color: string | null
  songCount: number
  createdAt: string
  updatedAt: string
}

export interface ServerPlaylistDetail extends ServerPlaylist {
  songs: Array<ServerSong & { addedAt: string; position: number }>
}

export interface LibrarySummary {
  counts: {
    likedSongs: number
    playlists: number
    songs: number
  }
  isEmpty: boolean
  likedSongs: ServerSong[]
  playlists: ServerPlaylist[]
  recentSongs: ServerSong[]
}

export interface LibrarySearchResults {
  playlists: ServerPlaylist[]
  songs: ServerSong[]
}

export interface ServerImportPolicy {
  configuredMode: ImportPolicyMode
  copy: ReturnType<typeof getImportPolicyModeCopy>
  environment: string
  mode: ImportPolicyMode
  openTestAllowed: boolean
}

export interface CsvImportPreviewTrack {
  album: string | null
  artist: string | null
  artworkUrl: string | null
  durationMs: number | null
  isrc: string | null
  sourceKey: string
  sourceUrl: string | null
  title: string
}

export interface CsvImportPreviewFile {
  fileName: string
  playlistName: string
  trackCount: number
  tracks: CsvImportPreviewTrack[]
  warnings: string[]
}

export interface CsvImportBatch {
  completedAt: string | null
  completedItems: number
  createdAt: string
  failedItems: number
  id: string
  importPolicyMode: ImportPolicyMode
  startedAt: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  totalItems: number
  userId: string
}

export interface CsvImportItem {
  album: string | null
  artist: string | null
  autoRetryable: boolean
  batchId: string
  createdAt: string
  errorCode: string | null
  errorMessage: string | null
  fileName: string
  id: string
  likeAfterImport: boolean
  playlistTargets: Array<{
    playlistId: string
    playlistName: string
    position: number
  }>
  playlistName: string
  searchQuery: string
  songId: string | null
  sourceKey: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  title: string
  updatedAt: string
  userId: string
  userMatchRequired: boolean
  youtubeSourceId: string | null
}

type ApiStatus = 'anonymous' | 'authenticated'
type ApiFetchOptions = {
  retryOnUnauthorized?: boolean
}
type CsvUploadedFileRef = {
  id: string
  fileName: string
}

const CSV_UPLOAD_BATCH_TARGET_BYTES = 700_000
const CSV_UPLOAD_CHUNK_BYTES = 512 * 1024
const AUDIO_IMPORT_CONCURRENCY = 2

let refreshSessionPromise: Promise<boolean> | null = null
const csvUploadReferences = new WeakMap<File, Promise<CsvUploadedFileRef>>()

export function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    ''
  )
}

export function apiUrl(pathOrUrl: string) {
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }

  const baseUrl = apiBaseUrl()

  if (!baseUrl) {
    return pathOrUrl
  }

  return `${baseUrl.replace(/\/$/, '')}/${pathOrUrl.replace(/^\//, '')}`
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
) {
  const response = await fetch(input, withCredentials(init))

  if (response.status !== 401 || options.retryOnUnauthorized === false) {
    return response
  }

  const refreshed = await refreshAuthSession()

  if (!refreshed) {
    return response
  }

  return fetch(input, withCredentials(init))
}

async function refreshAuthSession() {
  refreshSessionPromise ??= fetch(apiUrl('/api/auth/refresh'), {
    credentials: 'include',
    method: 'POST',
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshSessionPromise = null
    })

  return refreshSessionPromise
}

function withCredentials(init: RequestInit): RequestInit {
  return {
    credentials: 'include',
    ...init,
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

export async function fetchCurrentUser() {
  const response = await apiFetch(apiUrl('/api/me'))

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Session check failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { user: CurrentUser }

  return payload.user
}

export function startGoogleSignIn() {
  const returnTo = typeof window !== 'undefined' ? window.location.origin : '/'
  const startUrl = apiUrl(
    `/api/auth/google/start?${new URLSearchParams({
      mode: 'web',
      returnTo,
    }).toString()}`,
  )

  window.location.assign(startUrl)
}

export async function logout() {
  await apiFetch(apiUrl('/api/auth/logout'), {
    credentials: 'include',
    method: 'POST',
  })
}

export async function redeemEntryKey(key: string) {
  const response = await apiFetch(apiUrl('/api/entry-keys/redeem'), {
    body: JSON.stringify({ key }),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 401) {
    return { status: 'anonymous' as const, user: null }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `Entry key redeem failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { user: CurrentUser }

  return { status: 'authenticated' as const, user: payload.user }
}

export async function fetchAdminEntryKeys() {
  const response = await apiFetch(apiUrl('/api/admin/entry-keys'), {
    credentials: 'include',
  })

  if (response.status === 403) {
    return { entryKeys: [], status: 'forbidden' as const }
  }

  if (response.status === 401) {
    return { entryKeys: [], status: 'anonymous' as const }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `Entry key request failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { entryKeys: EntryKeySummary[] }

  return { entryKeys: payload.entryKeys, status: 'authenticated' as const }
}

export async function createAdminEntryKey(label: string | null) {
  const response = await apiFetch(apiUrl('/api/admin/entry-keys'), {
    body: JSON.stringify({ label }),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 403) {
    return { entryKey: null, secret: null, status: 'forbidden' as const }
  }

  if (response.status === 401) {
    return { entryKey: null, secret: null, status: 'anonymous' as const }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `Entry key create failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    entryKey: EntryKeySummary
    secret: string
  }

  return {
    entryKey: payload.entryKey,
    secret: payload.secret,
    status: 'created' as const,
  }
}

export async function fetchAdminStorageObjects() {
  const response = await apiFetch(apiUrl('/api/admin/storage-objects'), {
    credentials: 'include',
  })

  if (response.status === 403) {
    return { status: 'forbidden' as const, storage: null }
  }

  if (response.status === 401) {
    return { status: 'anonymous' as const, storage: null }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `Storage objects request failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { storage: AdminStorageOverview }

  return { status: 'authenticated' as const, storage: payload.storage }
}

export async function wipeAdminAccountTracks(input: {
  deleteStoredAudio: boolean
}) {
  const response = await apiFetch(apiUrl('/api/account/tracks/wipe'), {
    body: JSON.stringify({
      deleteStoredAudio: input.deleteStoredAudio,
    }),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 403) {
    return { deletion: null, status: 'forbidden' as const }
  }

  if (response.status === 401) {
    return { deletion: null, status: 'anonymous' as const }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `Track wipe failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    deletion: AccountTrackWipeDeletion
  }

  return { deletion: payload.deletion, status: 'authenticated' as const }
}

export async function fetchSongs() {
  const response = await apiFetch(apiUrl('/api/songs'), {
    credentials: 'include',
  })

  if (response.status === 401) {
    return { songs: [], status: 'anonymous' as const }
  }

  if (!response.ok) {
    throw new Error(`Songs request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { songs: ServerSong[] }

  return { songs: payload.songs, status: 'authenticated' as const }
}

export async function fetchLibrarySummary() {
  const response = await apiFetch(apiUrl('/api/library/summary'), {
    credentials: 'include',
  })

  if (response.status === 401) {
    return {
      status: 'anonymous' as const,
      summary: emptyLibrarySummary(),
    }
  }

  if (!response.ok) {
    throw new Error(
      `Library summary request failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { summary: LibrarySummary }

  return { status: 'authenticated' as const, summary: payload.summary }
}

export async function fetchImportPolicy() {
  const response = await apiFetch(apiUrl('/api/import-policy'), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Import policy request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { importPolicy: ServerImportPolicy }

  return payload.importPolicy
}

export async function previewCsvImportFiles(files: File[]) {
  const batches = await csvUploadReferenceBatches(files)
  const previewFiles: CsvImportPreviewFile[] = []
  let totalTracks = 0

  for (const batch of batches) {
    const response = await postCsvImportUploads('/api/csv-imports/preview', batch)

    if (response.status === 401) {
      return {
        files: [],
        status: 'anonymous' as const,
        totalTracks: 0,
      }
    }

    if (!response.ok) {
      throw new Error(
        (await readApiErrorMessage(response)) ??
          `CSV preview failed with status ${response.status}`,
      )
    }

    const payload = (await response.json()) as {
      csvImport: {
        files: CsvImportPreviewFile[]
        totalTracks: number
      }
    }

    previewFiles.push(...payload.csvImport.files)
    totalTracks += payload.csvImport.totalTracks
  }

  return {
    files: previewFiles,
    status: 'authenticated' as const,
    totalTracks,
  }
}

export async function createCsvImportBatches(files: File[]) {
  const uploadBatches = await csvUploadReferenceBatches(files)
  const batches: CsvImportBatch[] = []

  try {
    for (const batchPayload of uploadBatches) {
      const response = await postCsvImportUploads(
        '/api/csv-imports/batches',
        batchPayload,
      )

      if (response.status === 401) {
        return { batches, status: 'anonymous' as const }
      }

      if (!response.ok) {
        throw new Error(
          (await readApiErrorMessage(response)) ??
            `CSV import failed with status ${response.status}`,
        )
      }

      const payload = (await response.json()) as { batch: CsvImportBatch }
      batches.push(payload.batch)
    }
  } finally {
    for (const file of files) {
      csvUploadReferences.delete(file)
    }
  }

  return { batches, status: 'accepted' as const }
}

export async function fetchCsvImportBatch(batchId: string) {
  const response = await apiFetch(
    apiUrl(`/api/csv-imports/batches/${encodeURIComponent(batchId)}`),
    {
      credentials: 'include',
    },
  )

  if (response.status === 401) {
    return { batch: null, items: [], status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { batch: null, items: [], status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `CSV import batch failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    batch: CsvImportBatch
    items: CsvImportItem[]
  }

  return { ...payload, status: 'authenticated' as const }
}

export async function cancelCsvImportBatch(batchId: string) {
  const response = await apiFetch(
    apiUrl(`/api/csv-imports/batches/${encodeURIComponent(batchId)}/cancel`),
    {
      credentials: 'include',
      method: 'POST',
    },
  )

  if (response.status === 401) {
    return { batch: null, items: [], status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { batch: null, items: [], status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `CSV import cancel failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    batch: CsvImportBatch
    items: CsvImportItem[]
  }

  return { ...payload, status: 'authenticated' as const }
}

export async function retryCsvImportBatch(batchId: string) {
  const response = await apiFetch(
    apiUrl(`/api/csv-imports/batches/${encodeURIComponent(batchId)}/retry`),
    {
      credentials: 'include',
      method: 'POST',
    },
  )

  if (response.status === 401) {
    return {
      batch: null,
      items: [],
      retriedItems: 0,
      status: 'anonymous' as const,
    }
  }

  if (response.status === 404) {
    return {
      batch: null,
      items: [],
      retriedItems: 0,
      status: 'not-found' as const,
    }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `CSV import retry failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    batch: CsvImportBatch
    items: CsvImportItem[]
    retriedItems: number
  }

  return { ...payload, status: 'authenticated' as const }
}

export async function importCsvImportItemDiscovery(input: {
  batchId: string
  discovery: ExternalDiscoveryResult
  itemId: string
}) {
  const response = await apiFetch(
    apiUrl(
      `/api/csv-imports/batches/${encodeURIComponent(
        input.batchId,
      )}/items/${encodeURIComponent(input.itemId)}/import`,
    ),
    {
      body: JSON.stringify({ discovery: input.discovery }),
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  if (response.status === 401) {
    return { batch: null, item: null, items: [], status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { batch: null, item: null, items: [], status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(
      (await readApiErrorMessage(response)) ??
        `CSV import item failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    batch: CsvImportBatch
    item: CsvImportItem
    items: CsvImportItem[]
  }

  return { ...payload, status: 'authenticated' as const }
}

export async function searchLibrary(
  query: string,
  options: { cursor?: string | null; limit?: number } = {},
) {
  const params = new URLSearchParams({ query })

  if (options.cursor) {
    params.set('cursor', options.cursor)
  }

  if (options.limit) {
    params.set('limit', String(options.limit))
  }

  const response = await apiFetch(apiUrl(`/api/search?${params.toString()}`), {
    credentials: 'include',
  })

  if (response.status === 401) {
    return {
      nextCursor: null,
      results: { playlists: [], songs: [] },
      status: 'anonymous' as const,
    }
  }

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    nextCursor: string | null
    results: LibrarySearchResults
  }

  return {
    nextCursor: payload.nextCursor,
    results: payload.results,
    status: 'authenticated' as const,
  }
}

export async function createPlaylist(input: {
  name: string
  description?: string | null
  color?: string | null
}) {
  const response = await apiFetch(apiUrl('/api/playlists'), {
    body: JSON.stringify(input),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 401) {
    return { playlist: null, status: 'anonymous' as const }
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new Error(
      payload?.error?.message ??
        `Create playlist failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { playlist: ServerPlaylistDetail }

  return { playlist: payload.playlist, status: 'authenticated' as const }
}

export async function updatePlaylist(
  playlistId: string,
  input: {
    name?: string
    description?: string | null
    color?: string | null
  },
) {
  const response = await apiFetch(
    apiUrl(`/api/playlists/${encodeURIComponent(playlistId)}`),
    {
      body: JSON.stringify(input),
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      method: 'PUT',
    },
  )

  if (response.status === 401) {
    return { playlist: null, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { playlist: null, status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(`Update playlist failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { playlist: ServerPlaylistDetail }

  return { playlist: payload.playlist, status: 'authenticated' as const }
}

export async function deletePlaylist(playlistId: string) {
  const response = await apiFetch(
    apiUrl(`/api/playlists/${encodeURIComponent(playlistId)}`),
    {
      credentials: 'include',
      method: 'DELETE',
    },
  )

  if (response.status === 401) {
    return { status: 'anonymous' as const }
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(`Delete playlist failed with status ${response.status}`)
  }

  return { status: 'authenticated' as const }
}

export async function addSongToPlaylist(playlistId: string, songId: string) {
  const response = await apiFetch(
    apiUrl(`/api/playlists/${encodeURIComponent(playlistId)}/songs`),
    {
      body: JSON.stringify({ songId }),
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  if (response.status === 401) {
    return { playlist: null, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { playlist: null, status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(
      `Add song to playlist failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { playlist: ServerPlaylistDetail }

  return { playlist: payload.playlist, status: 'authenticated' as const }
}

export async function removeSongFromPlaylist(
  playlistId: string,
  songId: string,
) {
  const response = await apiFetch(
    apiUrl(
      `/api/playlists/${encodeURIComponent(playlistId)}/songs/${encodeURIComponent(songId)}`,
    ),
    {
      credentials: 'include',
      method: 'DELETE',
    },
  )

  if (response.status === 401) {
    return { status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { status: 'not-found' as const }
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(
      `Remove song from playlist failed with status ${response.status}`,
    )
  }

  return { status: 'authenticated' as const }
}

export async function fetchPlaylist(playlistId: string) {
  const response = await apiFetch(
    apiUrl(`/api/playlists/${encodeURIComponent(playlistId)}`),
    {
      credentials: 'include',
    },
  )

  if (response.status === 401) {
    return { playlist: null, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { playlist: null, status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(`Playlist request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { playlist: ServerPlaylistDetail }

  return { playlist: payload.playlist, status: 'authenticated' as const }
}

export async function likeSong(songId: string) {
  const response = await apiFetch(apiUrl(`/api/songs/${encodeURIComponent(songId)}/like`), {
    credentials: 'include',
    method: 'POST',
  })

  if (response.status === 401) {
    return { liked: false, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { liked: false, status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(`Like song request failed with status ${response.status}`)
  }

  return { liked: true, status: 'authenticated' as const }
}

export async function unlikeSong(songId: string) {
  const response = await apiFetch(apiUrl(`/api/songs/${encodeURIComponent(songId)}/like`), {
    credentials: 'include',
    method: 'DELETE',
  })

  if (response.status === 401) {
    return { liked: false, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { liked: false, status: 'not-found' as const }
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(`Unlike song request failed with status ${response.status}`)
  }

  return { liked: false, status: 'authenticated' as const }
}

export async function deleteSong(songId: string) {
  const response = await apiFetch(apiUrl(`/api/songs/${encodeURIComponent(songId)}`), {
    credentials: 'include',
    method: 'DELETE',
  })

  if (response.status === 401) {
    return { status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { status: 'not-found' as const }
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(`Delete song request failed with status ${response.status}`)
  }

  return { status: 'authenticated' as const }
}

export async function updatePlaybackState(input: {
  songId: string | null
  positionMs: number
  shuffleEnabled: boolean
  repeatMode: 'off' | 'one' | 'all'
}) {
  await apiFetch(apiUrl('/api/playback-state'), {
    body: JSON.stringify(input),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })
}

export async function requestSongCacheIntent(songId: string) {
  const response = await apiFetch(
    apiUrl(`/api/songs/${encodeURIComponent(songId)}/cache-intent`),
    {
      credentials: 'include',
      method: 'POST',
    },
  )

  if (response.status === 401) {
    return { cacheIntent: null, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { cacheIntent: null, status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(`Cache intent request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    cacheIntent: {
      checksum: string
      mimeType: string
      sizeBytes: number
      songId: string
      streamUrl: string
    }
  }

  return {
    cacheIntent: {
      ...payload.cacheIntent,
      streamUrl: apiUrl(payload.cacheIntent.streamUrl),
    },
    status: 'accepted' as const,
  }
}

export function songStreamUrl(songId: string) {
  return apiUrl(`/api/songs/${encodeURIComponent(songId)}/stream`)
}

export async function importAudioFiles(
  files: File[],
  importPolicyMode: ImportPolicyMode = 'licensed_only',
) {
  const importedByIndex: ServerSong[] = []
  let anonymous = false

  await runWithConcurrency(
    files.map((file, index) => ({ file, index })),
    AUDIO_IMPORT_CONCURRENCY,
    async ({ file, index }) => {
      if (anonymous) return

      const result = await importAudioFile(file, importPolicyMode)

      if (result.status === 'anonymous') {
        anonymous = true
        return
      }

      importedByIndex[index] = result.song
    },
  )

  const imported = importedByIndex.filter((song): song is ServerSong =>
    Boolean(song),
  )

  return {
    imported,
    status: anonymous ? ('anonymous' as const) : ('authenticated' as const),
  }
}

async function importAudioFile(
  file: File,
  importPolicyMode: ImportPolicyMode,
) {
  const mimeType = file.type || mimeTypeFromName(file.name)
  const params = new URLSearchParams({
    fileName: file.name,
    importPolicyMode,
    mimeType,
    sizeBytes: String(file.size),
    title: stripExtension(file.name),
  })
  const response = await apiFetch(apiUrl(`/api/songs/import?${params}`), {
    body: file,
    credentials: 'include',
    headers: {
      'content-type': mimeType,
    },
    method: 'POST',
  })

  if (response.status === 401) {
    return { song: null, status: 'anonymous' as const }
  }

  if (!response.ok) {
    throw new Error(`Import failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { song: ServerSong }

  return { song: payload.song, status: 'authenticated' as const }
}

export async function discoverYouTubeUrl(url: string) {
  return discoverYouTube({ url })
}

export async function searchYouTube(query: string, limit = 10) {
  return discoverYouTube({ limit, query })
}

async function discoverYouTube(requestPayload: {
  limit?: number
  query?: string
  url?: string
}) {
  const response = await apiFetch(apiUrl('/api/external-discovery/youtube'), {
    body: JSON.stringify(requestPayload),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 401) {
    return { discovery: null, status: 'anonymous' as const }
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new Error(
      payload?.error?.message ??
        `External discovery failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    discovery: ExternalDiscoveryResponse & { importPolicy: ServerImportPolicy }
  }

  return { discovery: payload.discovery, status: 'authenticated' as const }
}

export async function importYouTubeDiscovery(discovery: ExternalDiscoveryResult) {
  const response = await apiFetch(apiUrl('/api/external-imports/youtube'), {
    body: JSON.stringify({ discovery }),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 401) {
    return {
      alreadyInLibrary: false,
      job: null,
      song: null,
      status: 'anonymous' as const,
    }
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new Error(
      payload?.error?.message ??
        `External import failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as {
    alreadyInLibrary: boolean
    job: SerializedExternalImportJob | null
    song: ServerSong
  }

  return {
    alreadyInLibrary: payload.alreadyInLibrary,
    job: payload.job,
    song: payload.song,
    status: 'authenticated' as const,
  }
}

export async function fetchExternalImportJob(jobId: string) {
  const response = await apiFetch(
    apiUrl(`/api/external-import-jobs/${encodeURIComponent(jobId)}`),
    {
      credentials: 'include',
    },
  )

  if (response.status === 401) {
    return { job: null, song: null, status: 'anonymous' as const }
  }

  if (response.status === 404) {
    return { job: null, song: null, status: 'not-found' as const }
  }

  if (!response.ok) {
    throw new Error(`Import job request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    job: SerializedExternalImportJob
    song: ServerSong | null
  }

  return { ...payload, status: 'authenticated' as const }
}

export function serverSongToSong(song: ServerSong): Song {
  const artist = song.artist ?? song.album ?? 'Imported song'
  const external = song.externalSource

  return {
    album: song.album ?? undefined,
    artist,
    coverColor: pickCoverColor(song.title + artist),
    coverImageUrl: external?.thumbnailUrl ?? undefined,
    dateAdded: Date.parse(song.createdAt),
    duration: song.durationMs ? Math.round(song.durationMs / 1000) : 0,
    id: song.id,
    liked: Boolean(song.liked),
    serverSong: song,
    source: external?.provider ?? 'upload',
    sourceUrl: external?.canonicalUrl,
    title: song.title,
    url: songStreamUrl(song.id),
  }
}

export function emptyLibrarySummary(): LibrarySummary {
  return {
    counts: {
      likedSongs: 0,
      playlists: 0,
      songs: 0,
    },
    isEmpty: true,
    likedSongs: [],
    playlists: [],
    recentSongs: [],
  }
}

export function defaultImportPolicy(): ServerImportPolicy {
  return {
    configuredMode: 'licensed_only',
    copy: getImportPolicyModeCopy('licensed_only'),
    environment: 'production',
    mode: 'licensed_only',
    openTestAllowed: false,
  }
}

export function isSupportedAudioFile(file: File) {
  const typeAllowed = SUPPORTED_AUDIO_MIME_TYPES.includes(
    file.type as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number],
  )

  return typeAllowed || /\.(aac|flac|m4a|mp3|oga|ogg|wav)$/i.test(file.name)
}

export function isSupportedCsvFile(file: File) {
  const type = file.type.toLowerCase()

  return (
    type === 'text/csv' ||
    type === 'text/tab-separated-values' ||
    /\.(csv|tsv|txt)$/i.test(file.name)
  )
}

export function playlistSubtitle(playlist: ServerPlaylist) {
  return `${playlist.songCount} ${playlist.songCount === 1 ? 'song' : 'songs'}`
}

export function songSubtitle(song: ServerSong) {
  return song.artist ?? song.album ?? 'Imported song'
}

export type LibraryLoadStatus = ApiStatus | 'loading' | 'error' | 'offline'

async function readApiErrorMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string | { message?: string }
        message?: string
      }
    | null

  if (typeof payload?.message === 'string') {
    return payload.message
  }

  if (typeof payload?.error === 'object') {
    return payload.error.message ?? null
  }

  return null
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

async function postCsvImportUploads(path: string, uploads: CsvUploadedFileRef[]) {
  return apiFetch(apiUrl(path), {
    body: JSON.stringify({ uploads }),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
}

async function csvUploadReferenceBatches(files: File[]) {
  const batches: CsvUploadedFileRef[][] = []
  let current: CsvUploadedFileRef[] = []

  for (const file of files) {
    const upload = await csvUploadReference(file)
    const nextBytes = csvUploadEnvelopeBytes([...current, upload])

    if (
      current.length > 0 &&
      nextBytes > CSV_UPLOAD_BATCH_TARGET_BYTES
    ) {
      batches.push(current)
      current = [upload]
    } else {
      current.push(upload)
    }
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

function csvUploadReference(file: File) {
  let upload = csvUploadReferences.get(file)

  if (!upload) {
    upload = uploadCsvFile(file)
    csvUploadReferences.set(file, upload)
  }

  return upload
}

async function uploadCsvFile(file: File): Promise<CsvUploadedFileRef> {
  const start = await apiFetch(apiUrl('/api/csv-imports/uploads'), {
    body: JSON.stringify({ fileName: file.name }),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (!start.ok) {
    throw new Error(
      (await readApiErrorMessage(start)) ??
        `CSV upload failed with status ${start.status}`,
    )
  }

  const started = (await start.json()) as {
    upload: CsvUploadedFileRef & { receivedBytes: number }
  }
  let chunkIndex = 0

  for (
    let offset = 0;
    offset < file.size;
    offset += CSV_UPLOAD_CHUNK_BYTES
  ) {
    const chunk = file.slice(offset, offset + CSV_UPLOAD_CHUNK_BYTES)
    const response = await apiFetch(
      apiUrl(`/api/csv-imports/uploads/${encodeURIComponent(started.upload.id)}/chunks`),
      {
        body: JSON.stringify({
          chunkIndex,
          contentBase64: await blobToBase64(chunk),
        }),
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    if (!response.ok) {
      throw new Error(
        (await readApiErrorMessage(response)) ??
          `CSV upload chunk failed with status ${response.status}`,
      )
    }

    chunkIndex += 1
  }

  return {
    fileName: started.upload.fileName,
    id: started.upload.id,
  }
}

function csvUploadEnvelopeBytes(uploads: CsvUploadedFileRef[]) {
  return JSON.stringify({ uploads }).length
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '')
}

function mimeTypeFromName(fileName: string) {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.m4a')) return 'audio/m4a'
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.aac')) return 'audio/aac'

  return 'audio/mpeg'
}
