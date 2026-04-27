import {
  getImportPolicyModeCopy,
  SUPPORTED_AUDIO_MIME_TYPES,
  type ExternalDiscoveryResponse,
  type ExternalDiscoveryResult,
  type ImportPolicyMode,
  type SerializedExternalImportJob,
  type SerializedExternalSource,
} from '@tunely/shared'
import { pickCoverColor, type Song } from '@/lib/music-types'

export interface CurrentUser {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
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
  importStatus: 'ready'
  externalSource?: SerializedExternalSource | null
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

type ApiStatus = 'anonymous' | 'authenticated'

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

export async function fetchCurrentUser() {
  const response = await fetch(apiUrl('/api/me'), {
    credentials: 'include',
  })

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
  await fetch(apiUrl('/api/auth/logout'), {
    credentials: 'include',
    method: 'POST',
  })
}

export async function fetchSongs() {
  const response = await fetch(apiUrl('/api/songs'), {
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
  const response = await fetch(apiUrl('/api/library/summary'), {
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
  const response = await fetch(apiUrl('/api/import-policy'), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Import policy request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { importPolicy: ServerImportPolicy }

  return payload.importPolicy
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

  const response = await fetch(apiUrl(`/api/search?${params.toString()}`), {
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

export async function fetchPlaylist(playlistId: string) {
  const response = await fetch(
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
  const response = await fetch(apiUrl(`/api/songs/${encodeURIComponent(songId)}/like`), {
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
  const response = await fetch(apiUrl(`/api/songs/${encodeURIComponent(songId)}/like`), {
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

export async function updatePlaybackState(input: {
  songId: string | null
  positionMs: number
  shuffleEnabled: boolean
  repeatMode: 'off' | 'one' | 'all'
}) {
  await fetch(apiUrl('/api/playback-state'), {
    body: JSON.stringify(input),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })
}

export async function requestSongCacheIntent(songId: string) {
  const response = await fetch(
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
  const imported: ServerSong[] = []

  for (const file of files) {
    const contentBase64 = await blobToBase64(file)
    const response = await fetch(apiUrl('/api/songs/import'), {
      body: JSON.stringify({
        album: null,
        artist: null,
        contentBase64,
        fileName: file.name,
        importPolicyMode,
        mimeType: file.type || mimeTypeFromName(file.name),
        sizeBytes: file.size,
        title: stripExtension(file.name),
      }),
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    if (response.status === 401) {
      return { imported, status: 'anonymous' as const }
    }

    if (!response.ok) {
      throw new Error(`Import failed with status ${response.status}`)
    }

    const payload = (await response.json()) as { song: ServerSong }
    imported.push(payload.song)
  }

  return { imported, status: 'authenticated' as const }
}

export async function discoverYouTubeUrl(url: string) {
  const response = await fetch(apiUrl('/api/external-discovery/youtube'), {
    body: JSON.stringify({ url }),
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
  const response = await fetch(apiUrl('/api/external-imports/youtube'), {
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
  const response = await fetch(
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
    dateAdded: Date.parse(song.createdAt),
    duration: song.durationMs ? Math.round(song.durationMs / 1000) : 0,
    id: song.id,
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

export function playlistSubtitle(playlist: ServerPlaylist) {
  return `${playlist.songCount} ${playlist.songCount === 1 ? 'song' : 'songs'}`
}

export function songSubtitle(song: ServerSong) {
  return song.artist ?? song.album ?? 'Imported song'
}

export type LibraryLoadStatus = ApiStatus | 'loading' | 'error'

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
