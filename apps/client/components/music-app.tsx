'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Plus, Settings } from 'lucide-react'
import type { ExternalDiscoveryResult } from '@broadside/shared'
import { Sidebar } from '@/components/sidebar'
import { MobileNav } from '@/components/mobile-nav'
import { PlayerBar } from '@/components/player-bar'
import { NowPlaying } from '@/components/now-playing'
import { HomeView } from '@/components/home-view'
import { LibraryView } from '@/components/library-view'
import { SearchView } from '@/components/search-view'
import { CollectionView } from '@/components/collection-view'
import { AddMusicDialog, type Download } from '@/components/add-music-dialog'
import { CsvImportStatusToast } from '@/components/csv-import-status-toast'
import {
  SettingsView,
  type LibraryDeviceSyncState,
} from '@/components/settings-view'
import { LoginScreen } from '@/components/login-screen'
import { EntryKeyScreen } from '@/components/entry-key-screen'
import { AdminView } from '@/components/admin-view'
import { OnVibeLogo } from '@/components/onvibe-logo'
import {
  CreatePlaylistDialog,
  EditPlaylistDialog,
} from '@/components/playlist-dialogs'
import { Button } from '@/components/ui/button'
import {
  apiUrl,
  addSongToPlaylist,
  cancelCsvImportBatch,
  createCsvImportBatches,
  createPlaylist,
  deletePlaylist,
  deleteSong,
  discoverYouTubeUrl,
  fetchActiveCsvImportBatches,
  fetchCsvImportBatch,
  fetchExternalImportJob,
  fetchPlaylist,
  importCsvImportItemDiscovery,
  importYouTubeDiscovery,
  importAudioFiles,
  likeSong,
  removeSongFromPlaylist,
  requestSongCacheIntent,
  retryCsvImportBatch,
  searchYouTube,
  serverSongToSong,
  songStreamUrl,
  unlikeSong,
  updatePlaybackState,
  updatePlaylist,
  type CsvImportBatch,
  type CsvImportItem,
  type ServerPlaylist,
  type ServerPlaylistDetail,
  type ServerSong,
} from '@/lib/api'
import { AuthProvider, useAuth } from '@/lib/auth'
import { useImportPolicy, useLibrarySummary, useSongs } from '@/lib/library-hooks'
import { isLikelyYouTubeUrl } from '@/lib/url-import'
import { toast } from '@/hooks/use-toast'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { cacheTrackThumbnails } from '@/lib/track-thumbnail-cache'
import {
  canStoreOffline,
  deleteOfflineAudio,
  deleteOfflineAudioExcept,
  downloadOfflineAudio,
  getOfflineAudioBlob,
  getOfflineAudioServerSongs,
  getOfflineAudioStates,
  type OfflineAudioStateMap,
} from '@/lib/offline-audio-cache'
import {
  cacheOfflineLibrarySnapshot,
  getOfflineLibrarySnapshot,
  type OfflineLibrarySnapshot,
} from '@/lib/offline-library-cache'
import {
  createLocalPlaylistId,
  enqueueMutation,
  flushPendingMutations,
  isLocalPlaylistId,
  isOfflineSyncError,
  pendingLibraryState,
  readPendingMutations,
  remapPlaylistId,
  writePendingMutations,
  type PendingMutation,
  type QueuedMutation,
} from '@/lib/offline-mutation-queue'
import {
  type CollectionRef,
  type Song,
  type View,
} from '@/lib/music-types'
import { selectNextTrack, selectPrevTrack } from '@/lib/playback/queue'
import {
  applyMediaSessionMetadata,
  getNavigatorMediaSession,
  registerMediaSessionHandlers,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
} from '@/lib/playback/media-session'
import { TrackSourceCache } from '@/lib/playback/track-sources'
import { playbackProgressStore } from '@/lib/playback/progress-store'

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function mergeOfflineStates(
  current: OfflineAudioStateMap,
  fresh: OfflineAudioStateMap,
) {
  const next = { ...fresh }

  for (const [songId, state] of Object.entries(current)) {
    if (state.status === 'downloading' && songId in fresh) {
      next[songId] = state
    }
  }

  return next
}

function playlistSummaryFromDetail(
  playlist: ServerPlaylistDetail,
): ServerPlaylist {
  return {
    color: playlist.color,
    createdAt: playlist.createdAt,
    description: playlist.description,
    id: playlist.id,
    name: playlist.name,
    songCount: playlist.songs.length,
    updatedAt: playlist.updatedAt,
    userId: playlist.userId,
  }
}

function applyLikedOverrideToServerSong(
  song: ServerSong,
  likedOverrides: Record<string, boolean>,
) {
  const likedOverride = likedOverrides[song.id]

  return likedOverride === undefined ? song : { ...song, liked: likedOverride }
}

function applyPlaylistSongRemovals(
  playlist: ServerPlaylist,
  removedSongIds: string[] | undefined,
) {
  if (!removedSongIds || removedSongIds.length === 0) {
    return playlist
  }

  return {
    ...playlist,
    songCount: Math.max(0, playlist.songCount - removedSongIds.length),
  }
}

type LibraryChangedMessage = {
  reason?: string
  songId?: string
}

function parseLibraryChangedMessage(event: Event): LibraryChangedMessage | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
    return null
  }

  try {
    const payload = JSON.parse(event.data) as unknown

    if (!payload || typeof payload !== 'object') {
      return null
    }

    return payload as LibraryChangedMessage
  } catch {
    return null
  }
}

function applyLikedToSong(song: Song, liked: boolean): Song {
  return {
    ...song,
    liked,
    serverSong: song.serverSong ? { ...song.serverSong, liked } : song.serverSong,
  }
}

function songLiked(song: Song) {
  return Boolean(song.serverSong?.liked ?? song.liked)
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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

const CSV_IMPORT_STATUS_REFRESH_FAILURE_LIMIT = 4
const CSV_IMPORT_CANCEL_DISMISS_DELAY_MS = 5000
const EXTERNAL_IMPORT_STATUS_REFRESH_FAILURE_LIMIT = 4
const OFFLINE_DOWNLOAD_CONCURRENCY = 3
const OFFLINE_SYNC_RETRY_INTERVAL_MS = 30_000
const DEFAULT_VOLUME = 0.8
const PLAYER_VOLUME_STORAGE_KEY = 'onvibe:player-volume:v1'
const PLAYER_NAVIGATION_STORAGE_KEY = 'onvibe:navigation:v1'
const PLAYER_SHUFFLE_STORAGE_KEY = 'onvibe:player-shuffle:v1'
const PLAYER_REPEAT_STORAGE_KEY = 'onvibe:player-repeat:v1'
const CSV_IMPORT_DOWNLOADS_STORAGE_KEY = 'onvibe:csv-import-downloads:v1'

type RepeatMode = 'off' | 'all' | 'one'
const REPEAT_MODES = new Set<RepeatMode>(['off', 'all', 'one'])

export type PlayingFromLabel = {
  kind: 'library' | 'playlist' | 'liked' | 'search' | 'home'
  name?: string
}

type StoredNavigation = {
  collection: CollectionRef | null
  view: View
}

type StoredCsvImportDownloads = {
  downloads: Partial<Download>[]
  userId: string
}

const VIEWS = new Set<View>(['home', 'search', 'library', 'settings', 'admin'])
const DOWNLOAD_STATUSES = new Set<Download['status']>([
  'canceled',
  'complete',
  'downloading',
  'error',
])

function clampVolume(value: number) {
  return Math.min(1, Math.max(0, value))
}

function readStoredVolume() {
  if (typeof window === 'undefined') {
    return DEFAULT_VOLUME
  }

  try {
    const storedVolume = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY)
    if (storedVolume === null) {
      return DEFAULT_VOLUME
    }

    const parsedVolume = Number(storedVolume)
    return Number.isFinite(parsedVolume)
      ? clampVolume(parsedVolume)
      : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function writeStoredVolume(volume: number) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      PLAYER_VOLUME_STORAGE_KEY,
      String(clampVolume(volume)),
    )
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

function readStoredShuffle(): boolean {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(PLAYER_SHUFFLE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredShuffle(enabled: boolean) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      PLAYER_SHUFFLE_STORAGE_KEY,
      enabled ? '1' : '0',
    )
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

function readStoredRepeat(): RepeatMode {
  if (typeof window === 'undefined') return 'off'

  try {
    const value = window.localStorage.getItem(PLAYER_REPEAT_STORAGE_KEY)
    return REPEAT_MODES.has(value as RepeatMode)
      ? (value as RepeatMode)
      : 'off'
  } catch {
    return 'off'
  }
}

function writeStoredRepeat(mode: RepeatMode) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(PLAYER_REPEAT_STORAGE_KEY, mode)
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

function isStoredView(value: unknown): value is View {
  return typeof value === 'string' && VIEWS.has(value as View)
}

function isStoredCollection(value: unknown): value is CollectionRef {
  if (!value || typeof value !== 'object') {
    return false
  }

  const collection = value as { id?: unknown; kind?: unknown }

  if (collection.kind === 'system') {
    return collection.id === 'liked-songs'
  }

  return (
    (collection.kind === 'playlist' || collection.kind === 'category') &&
    typeof collection.id === 'string' &&
    collection.id.length > 0
  )
}

function readStoredNavigation(): StoredNavigation {
  const fallback: StoredNavigation = { collection: null, view: 'home' }

  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const storedNavigation = window.localStorage.getItem(
      PLAYER_NAVIGATION_STORAGE_KEY,
    )
    if (!storedNavigation) {
      return fallback
    }

    const parsedNavigation = JSON.parse(storedNavigation) as {
      collection?: unknown
      view?: unknown
    }

    return {
      collection: isStoredCollection(parsedNavigation.collection)
        ? parsedNavigation.collection
        : null,
      view: isStoredView(parsedNavigation.view) ? parsedNavigation.view : 'home',
    }
  } catch {
    return fallback
  }
}

function writeStoredNavigation(navigation: StoredNavigation) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      PLAYER_NAVIGATION_STORAGE_KEY,
      JSON.stringify(navigation),
    )
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

function readStoredCsvImportDownloads(userId: string | undefined) {
  if (!userId || typeof window === 'undefined') {
    return []
  }

  try {
    const storedDownloads = window.localStorage.getItem(
      CSV_IMPORT_DOWNLOADS_STORAGE_KEY,
    )
    if (!storedDownloads) {
      return []
    }

    const parsedDownloads = JSON.parse(
      storedDownloads,
    ) as Partial<StoredCsvImportDownloads>

    if (
      parsedDownloads.userId !== userId ||
      !Array.isArray(parsedDownloads.downloads)
    ) {
      return []
    }

    return parsedDownloads.downloads
      .map(csvImportDownloadFromStoredValue)
      .filter((download): download is Download => Boolean(download))
  } catch {
    return []
  }
}

function writeStoredCsvImportDownloads(
  userId: string | undefined,
  downloads: Download[],
) {
  if (!userId || typeof window === 'undefined') return

  const csvDownloads = downloads
    .filter(shouldPersistCsvImportDownload)
    .map(csvImportDownloadToStoredValue)

  try {
    if (csvDownloads.length === 0) {
      window.localStorage.removeItem(CSV_IMPORT_DOWNLOADS_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      CSV_IMPORT_DOWNLOADS_STORAGE_KEY,
      JSON.stringify({ downloads: csvDownloads, userId }),
    )
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

function csvImportDownloadFromStoredValue(
  value: Partial<Download>,
): Download | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const batchIds = Array.isArray(value.batchIds)
    ? value.batchIds.filter((batchId) => typeof batchId === 'string')
    : []
  const csvImportBatches = Array.isArray(value.csvImportBatches)
    ? value.csvImportBatches
    : undefined
  const csvImportItems = Array.isArray(value.csvImportItems)
    ? value.csvImportItems
    : undefined
  const status = DOWNLOAD_STATUSES.has(value.status as Download['status'])
    ? (value.status as Download['status'])
    : 'downloading'

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    status !== 'downloading' ||
    (batchIds.length === 0 && !csvImportBatches?.length)
  ) {
    return null
  }

  return {
    artist: typeof value.artist === 'string' ? value.artist : 'CSV playlists',
    batchIds,
    cancelable: true,
    canceling: false,
    csvImportBatches,
    csvImportItems,
    id: value.id,
    message: typeof value.message === 'string' ? value.message : undefined,
    platform: 'url' as const,
    progress:
      typeof value.progress === 'number' && Number.isFinite(value.progress)
        ? Math.min(1, Math.max(0, value.progress))
        : 0.1,
    retrying: false,
    status,
    title: value.title,
    url: '',
  } satisfies Download
}

function csvImportDownloadToStoredValue(download: Download) {
  return {
    artist: download.artist,
    batchIds: csvImportBatchIds(download),
    csvImportBatches: download.csvImportBatches,
    csvImportItems: download.csvImportItems,
    id: download.id,
    message: download.message,
    progress: download.progress,
    status: download.status,
    title: download.title,
  } satisfies Partial<Download>
}

function shouldPersistCsvImportDownload(download: Download) {
  return (
    isCsvImportDownload(download) &&
    download.status === 'downloading' &&
    csvImportBatchIds(download).length > 0
  )
}

function isCsvImportDownload(download: Download) {
  return (
    download.id.startsWith('csv-import-') ||
    Boolean(
      download.batchIds?.length ||
        download.csvImportBatches?.length ||
        download.csvImportItems?.length,
    )
  )
}

function csvImportBatchIds(download: Download) {
  const ids = [
    ...(download.batchIds ?? []),
    ...(download.csvImportBatches?.map((batch) => batch.id) ?? []),
  ]

  return [...new Set(ids)]
}

async function loadCsvImportStatesForDownload(download: Download) {
  const existingBatches = new Map(
    download.csvImportBatches?.map((batch) => [batch.id, batch]) ?? [],
  )
  const existingItems = download.csvImportItems ?? []
  const states = await Promise.all(
    csvImportBatchIds(download).map(async (batchId) => {
      try {
        const next = await fetchCsvImportBatch(batchId)

        if (next.status === 'authenticated' && next.batch) {
          return {
            batch: next.batch,
            items: next.items,
          }
        }
      } catch {
        // Fall back to the last stored snapshot below.
      }

      const batch = existingBatches.get(batchId)
      if (!batch) {
        return null
      }

      return {
        batch,
        items: existingItems.filter((item) => item.batchId === batchId),
      }
    }),
  )

  return states.filter((state): state is CsvImportBatchState => Boolean(state))
}

function summarizeCsvImportBatches(batches: CsvImportBatch[]) {
  return batches.reduce(
    (summary, batch) => ({
      completedItems: summary.completedItems + batch.completedItems,
      failedItems: summary.failedItems + batch.failedItems,
      isRunning:
        summary.isRunning ||
        batch.status === 'pending' ||
        batch.status === 'running',
      pendingItems:
        summary.pendingItems +
        Math.max(0, batch.totalItems - batch.completedItems - batch.failedItems),
      totalItems: summary.totalItems + batch.totalItems,
    }),
    {
      completedItems: 0,
      failedItems: 0,
      isRunning: false,
      pendingItems: 0,
      totalItems: 0,
    },
  )
}

type CsvImportBatchState = {
  batch: CsvImportBatch
  items: CsvImportItem[]
}

type CsvManualMatchTarget = {
  downloadId: string
  item: CsvImportItem
}

function summarizeCsvImportStates(states: CsvImportBatchState[]) {
  const summary = summarizeCsvImportBatches(states.map((state) => state.batch))
  const items = states.flatMap((state) => state.items)

  return {
    ...summary,
    autoRetryableItems: items.filter((item) => item.autoRetryable).length,
    reviewableItems: items.filter((item) => item.status === 'failed').length,
    userMatchItems: items.filter((item) => item.userMatchRequired).length,
  }
}

function csvImportStatusText(summary: ReturnType<typeof summarizeCsvImportStates>) {
  if (summary.isRunning) {
    if (summary.userMatchItems > 0) {
      return summary.userMatchItems === 1
        ? `${summary.completedItems} done, 1 needs your pick`
        : `${summary.completedItems} done, ${summary.userMatchItems} need your picks`
    }

    if (summary.reviewableItems > 0) {
      return summary.reviewableItems === 1
        ? `${summary.completedItems} done, 1 row to review`
        : `${summary.completedItems} done, ${summary.reviewableItems} rows to review`
    }

    if (summary.failedItems > 0) {
      return summary.failedItems === 1
        ? `${summary.completedItems} done, 1 row failed`
        : `${summary.completedItems} done, ${summary.failedItems} rows failed`
    }

    return `${summary.completedItems} done`
  }

  if (summary.pendingItems > 0) {
    return `${summary.completedItems} done, ${summary.failedItems} failed, ${summary.pendingItems} paused`
  }

  return `${summary.completedItems} done, ${summary.failedItems} failed`
}

function csvImportActiveMessage(summary: ReturnType<typeof summarizeCsvImportStates>) {
  if (!summary.isRunning) {
    return undefined
  }

  if (summary.userMatchItems > 0) {
    return summary.userMatchItems === 1
      ? '1 row needs your pick; import is still running'
      : `${summary.userMatchItems} rows need your picks; import is still running`
  }

  if (summary.reviewableItems > 0) {
    return summary.reviewableItems === 1
      ? 'Tap to review 1 stuck row; import is still running'
      : `Tap to review ${summary.reviewableItems} stuck rows; import is still running`
  }

  return undefined
}

function csvImportFinalMessage(summary: ReturnType<typeof summarizeCsvImportStates>) {
  if (summary.pendingItems > 0) {
    return `${summary.completedItems} imported, ${summary.failedItems} failed, ${summary.pendingItems} waiting to resume`
  }

  return summary.failedItems > 0
    ? `${summary.completedItems} imported, ${summary.failedItems} failed`
    : 'CSV playlists imported'
}

function csvImportMessage(summary: ReturnType<typeof summarizeCsvImportStates>) {
  return summary.isRunning
    ? csvImportActiveMessage(summary)
    : csvImportFinalMessage(summary)
}

function csvImportDownloadStatus(
  summary: ReturnType<typeof summarizeCsvImportStates>,
): Download['status'] {
  if (summary.isRunning) {
    return 'downloading'
  }

  return summary.failedItems > 0 || summary.pendingItems > 0
    ? 'error'
    : 'complete'
}

function shouldDismissCsvImportDownload(
  summary: ReturnType<typeof summarizeCsvImportStates>,
) {
  return (
    !summary.isRunning &&
    summary.failedItems === 0 &&
    summary.pendingItems === 0
  )
}

function csvImportProgress(
  summary: ReturnType<typeof summarizeCsvImportStates>,
  fallback: number,
) {
  return summary.totalItems > 0
    ? (summary.completedItems + summary.failedItems) / summary.totalItems
    : fallback
}

function csvImportItemsForBatch(
  existingItems: CsvImportItem[] | undefined,
  batchId: string,
  nextItems: CsvImportItem[],
) {
  return [
    ...(existingItems?.filter((item) => item.batchId !== batchId) ?? []),
    ...nextItems,
  ]
}

function externalImportFailureMessage(errorCode: string | null) {
  switch (errorCode) {
    case 'unsupported_audio_type':
      return 'The resolved audio type is not supported.'
    case 'audio_file_too_large':
      return 'The resolved audio file is too large.'
    case 'missing_audio_metadata':
      return 'The resolved audio metadata is incomplete.'
    case 'external_audio_download_empty':
      return 'The downloaded audio file was empty.'
    case 'external_audio_download_missing':
      return 'The downloader did not produce an audio file.'
    case 'external_audio_download_failed':
      return 'Could not download audio from YouTube.'
    case 'audio_processing_failed':
      return 'The downloaded audio could not be normalized.'
    default:
      return 'External import failed.'
  }
}

function nextCsvManualMatchItem(
  states: CsvImportBatchState[],
  promptedItemIds: Set<string>,
  activeItemId: string | null,
) {
  return states
    .flatMap((state) => state.items)
    .find(
      (item) =>
        item.userMatchRequired &&
        item.id !== activeItemId &&
        !promptedItemIds.has(item.id),
    )
}

export function MusicApp() {
  return (
    <AuthProvider>
      <MusicAppInner />
    </AuthProvider>
  )
}

function MusicAppInner() {
  const { status, user } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
        Loading OnVibe...
      </div>
    )
  }

  if (status === 'anonymous') {
    return <LoginScreen />
  }

  if (user && !user.hasEntryAccess) {
    return <EntryKeyScreen />
  }

  return <AuthenticatedMusicApp />
}

function AuthenticatedMusicApp() {
  const { user } = useAuth()
  const isOnline = useOnlineStatus()
  const [revision, setRevision] = useState(0)
  const songsState = useSongs(revision)
  const library = useLibrarySummary(revision)
  const importPolicy = useImportPolicy()
  const [offlineServerSongs, setOfflineServerSongs] = useState<ServerSong[]>([])
  const [offlineLibrarySnapshot, setOfflineLibrarySnapshot] =
    useState<OfflineLibrarySnapshot | null>(null)
  const [offlineSnapshotHydrated, setOfflineSnapshotHydrated] = useState(false)
  // Library changes made while offline wait here until the server is
  // reachable again; they also seed the optimistic UI state below so the
  // changes survive an offline reload.
  const [pendingMutations, setPendingMutations] = useState<QueuedMutation[]>(
    () => readPendingMutations(user?.id),
  )
  const [seededPendingState] = useState(() =>
    pendingLibraryState(readPendingMutations(user?.id)),
  )
  const [playlistDetailOverrides, setPlaylistDetailOverrides] = useState<
    Record<string, ServerPlaylistDetail>
  >({})
  const [playlistSongRemovals, setPlaylistSongRemovals] = useState<
    Record<string, string[]>
  >(() => seededPendingState.playlistSongRemovals)
  const [locallyDeletedPlaylistIds, setLocallyDeletedPlaylistIds] = useState<
    Set<string>
  >(() => new Set(seededPendingState.deletedPlaylistIds))
  const [storedNavigation] = useState(readStoredNavigation)
  const [view, setView] = useState<View>(storedNavigation.view)
  const [collection, setCollection] = useState<CollectionRef | null>(
    storedNavigation.collection,
  )
  const [queue, setQueue] = useState<Song[]>([])
  const [currentSongId, setCurrentSongId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(readStoredVolume)
  const [muted, setMuted] = useState(false)
  const [shuffleEnabled, setShuffleEnabled] = useState(readStoredShuffle)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(readStoredRepeat)
  const [playingFromLabel, setPlayingFromLabel] = useState<PlayingFromLabel | null>(
    null,
  )
  const [showQueue, setShowQueue] = useState(false)
  const [showNowPlaying, setShowNowPlaying] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [downloads, setDownloads] = useState<Download[]>(() =>
    readStoredCsvImportDownloads(user?.id),
  )
  const [dismissedCsvImportToastIds, setDismissedCsvImportToastIds] = useState<
    Set<string>
  >(() => new Set())
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null)
  const [likingSongId, setLikingSongId] = useState<string | null>(null)
  const [likedOverrides, setLikedOverrides] = useState<Record<string, boolean>>(
    () => seededPendingState.likedOverrides,
  )
  const [locallyDeletedSongIds, setLocallyDeletedSongIds] = useState<Set<string>>(
    () => new Set(seededPendingState.deletedSongIds),
  )
  const [offlineAudio, setOfflineAudio] = useState<OfflineAudioStateMap>({})
  const [librarySync, setLibrarySync] = useState<LibraryDeviceSyncState>({
    completed: 0,
    failed: 0,
    status: 'idle',
    total: 0,
  })
  const [externalResults, setExternalResults] = useState<
    ExternalDiscoveryResult[]
  >([])
  const [csvManualMatchTarget, setCsvManualMatchTarget] =
    useState<CsvManualMatchTarget | null>(null)
  const [isDiscoveringLink, setIsDiscoveringLink] = useState(false)
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false)
  const [pendingSongForPlaylist, setPendingSongForPlaylist] =
    useState<Song | null>(null)
  const [editingPlaylist, setEditingPlaylist] =
    useState<ServerPlaylistDetail | null>(null)
  const [revealSongInLibrary, setRevealSongInLibrary] = useState<{
    songId: string
    nonce: number
  } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaLoadIdRef = useRef(0)
  const playNextRef = useRef<() => void>(() => undefined)
  const playPrevRef = useRef<() => void>(() => undefined)
  const handleTrackEndedRef = useRef<() => void>(() => undefined)
  const recoverFromAudioErrorRef = useRef<() => void>(() => undefined)
  const repeatModeRef = useRef<RepeatMode>(repeatMode)
  const isPlayingRef = useRef(false)
  // Song id whose source was swapped onto the audio element synchronously
  // by the ended-handler; tells the load effect to leave the element alone.
  const syncLoadedSongIdRef = useRef<string | null>(null)
  const audioErrorRecoverySongIdRef = useRef<string | null>(null)
  const trackSourceCacheRef = useRef<TrackSourceCache<Song> | null>(null)
  if (!trackSourceCacheRef.current) {
    trackSourceCacheRef.current = new TrackSourceCache<Song>({
      createObjectUrl: (blob) => URL.createObjectURL(blob),
      getOfflineBlob: (song) => getOfflineAudioBlob(song),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      streamUrl: (songId) => songStreamUrl(songId),
    })
  }
  const trackSourceCache = trackSourceCacheRef.current
  const canceledCsvImportIdsRef = useRef<Set<string>>(new Set())
  const csvImportDismissTimeoutsRef = useRef<Map<string, number>>(new Map())
  const promptedCsvManualMatchIdsRef = useRef<Set<string>>(new Set())
  const resumedCsvImportIdsRef = useRef<Set<string>>(new Set())
  const activeCsvManualMatchItemIdRef = useRef<string | null>(null)
  const promptCsvManualMatchRef = useRef<
    (downloadId: string, item: CsvImportItem) => void
  >(() => undefined)
  const activeSongIdsRef = useRef<Set<string>>(new Set())
  const offlineServerSongsRef = useRef<ServerSong[]>([])
  const locallyHandledSongRemovalIdsRef = useRef<Set<string>>(new Set())
  const wasOnlineRef = useRef(isOnline)
  const pendingMutationsRef = useRef<QueuedMutation[]>(pendingMutations)
  const flushingPendingMutationsRef = useRef(false)
  const syncAuthNoticeShownRef = useRef(false)
  const seededPlaylistOverridesRef = useRef(false)

  const reloadOfflineServerSongs = useCallback(async () => {
    try {
      setOfflineServerSongs(await getOfflineAudioServerSongs())
    } catch {
      setOfflineServerSongs([])
    }
  }, [])

  const reloadOfflineLibrarySnapshot = useCallback(
    async (availableSongIds: Iterable<string> = []) => {
      try {
        setOfflineLibrarySnapshot(
          await getOfflineLibrarySnapshot(availableSongIds),
        )
      } catch {
        setOfflineLibrarySnapshot(null)
      } finally {
        setOfflineSnapshotHydrated(true)
      }
    },
    [],
  )

  const offlineOnlyMode =
    songsState.status !== 'loading' &&
    songsState.status !== 'authenticated' &&
    (offlineServerSongs.length > 0 ||
      (offlineLibrarySnapshot?.summary.playlists.length ?? 0) > 0)

  const activeServerSongs = offlineOnlyMode ? offlineServerSongs : songsState.songs

  const serverSongs = useMemo(
    () =>
      activeServerSongs.map((song) =>
        applyLikedOverrideToServerSong(song, likedOverrides),
      ),
    [activeServerSongs, likedOverrides],
  )
  const visibleServerSongs = useMemo(
    () =>
      serverSongs.filter((song) => !locallyDeletedSongIds.has(song.id)),
    [locallyDeletedSongIds, serverSongs],
  )
  const likedAwareSummary = useMemo(() => {
    if (songsState.status === 'authenticated' || offlineOnlyMode) {
      const likedSongs = visibleServerSongs.filter((song) => song.liked)
      const summary = offlineOnlyMode
        ? (offlineLibrarySnapshot?.summary ?? library.summary)
        : library.summary
      const recentSongs = offlineOnlyMode
        ? visibleServerSongs.slice(0, 6)
        : summary.recentSongs
            .filter((song) => !locallyDeletedSongIds.has(song.id))
            .map((song) =>
              applyLikedOverrideToServerSong(song, likedOverrides),
            )

      return {
        ...summary,
        counts: {
          ...summary.counts,
          likedSongs: likedSongs.length,
          playlists: summary.playlists.length,
          songs: visibleServerSongs.length,
        },
        isEmpty:
          visibleServerSongs.length === 0 && summary.playlists.length === 0,
        likedSongs,
        playlists: summary.playlists,
        recentSongs,
      }
    }

    return {
      ...library.summary,
      likedSongs: library.summary.likedSongs
        .filter((song) => !locallyDeletedSongIds.has(song.id))
        .map((song) => applyLikedOverrideToServerSong(song, likedOverrides)),
      recentSongs: library.summary.recentSongs
        .filter((song) => !locallyDeletedSongIds.has(song.id))
        .map((song) => applyLikedOverrideToServerSong(song, likedOverrides)),
    }
  }, [
    library.summary,
    likedOverrides,
    locallyDeletedSongIds,
    offlineLibrarySnapshot,
    offlineOnlyMode,
    songsState.status,
    visibleServerSongs,
  ])
  const userSongs = useMemo(
    () =>
      visibleServerSongs.map(serverSongToSong),
    [visibleServerSongs],
  )
  const playlistDetailOverrideList = useMemo(
    () => Object.values(playlistDetailOverrides),
    [playlistDetailOverrides],
  )
  const playlists = useMemo(() => {
    const summaryPlaylists = likedAwareSummary.playlists.filter(
      (playlist) => !locallyDeletedPlaylistIds.has(playlist.id),
    )

    if (
      playlistDetailOverrideList.length === 0 &&
      Object.keys(playlistSongRemovals).length === 0
    ) {
      return summaryPlaylists
    }

    const overridesById = new Map(
      playlistDetailOverrideList
        .filter((playlist) => !locallyDeletedPlaylistIds.has(playlist.id))
        .map((playlist) => [playlist.id, playlist]),
    )
    const existingPlaylistIds = new Set<string>()
    const nextPlaylists = summaryPlaylists.map((playlist) => {
      existingPlaylistIds.add(playlist.id)

      const override = overridesById.get(playlist.id)
      const nextPlaylist = override
        ? playlistSummaryFromDetail(override)
        : playlist

      return applyPlaylistSongRemovals(
        nextPlaylist,
        playlistSongRemovals[playlist.id],
      )
    })

    for (const playlist of playlistDetailOverrideList) {
      if (locallyDeletedPlaylistIds.has(playlist.id)) {
        continue
      }

      if (!existingPlaylistIds.has(playlist.id)) {
        nextPlaylists.push(
          applyPlaylistSongRemovals(
            playlistSummaryFromDetail(playlist),
            playlistSongRemovals[playlist.id],
          ),
        )
      }
    }

    return nextPlaylists
  }, [
    likedAwareSummary.playlists,
    locallyDeletedPlaylistIds,
    playlistDetailOverrideList,
    playlistSongRemovals,
  ])
  // Overrides win over the offline snapshot so playlist changes made on this
  // device (including while offline) survive until they sync.
  const playlistDetails = useMemo(() => {
    const overrides = playlistDetailOverrideList.filter(
      (playlist) => !locallyDeletedPlaylistIds.has(playlist.id),
    )

    if (!offlineOnlyMode) {
      return overrides
    }

    const overrideIds = new Set(overrides.map((playlist) => playlist.id))

    return [
      ...overrides,
      ...(offlineLibrarySnapshot?.playlistDetails ?? []).filter(
        (playlist) =>
          !overrideIds.has(playlist.id) &&
          !locallyDeletedPlaylistIds.has(playlist.id),
      ),
    ]
  }, [
    locallyDeletedPlaylistIds,
    offlineLibrarySnapshot,
    offlineOnlyMode,
    playlistDetailOverrideList,
  ])
  const libraryStatus =
    offlineOnlyMode || (!isOnline && songsState.status === 'error')
      ? 'offline'
      : songsState.status
  const currentSong = useMemo(
    () =>
      userSongs.find((song) => song.id === currentSongId) ??
      queue.find((song) => song.id === currentSongId) ??
      null,
    [currentSongId, queue, userSongs],
  )
  const activeCollectionId = collection?.id ?? null
  const requireOnlineAction = useCallback(
    (description: string) => {
      if (isOnline) return true

      toast({
        title: 'Offline mode',
        description,
        variant: 'destructive',
      })
      return false
    },
    [isOnline],
  )

  useEffect(() => {
    pendingMutationsRef.current = pendingMutations
    writePendingMutations(user?.id, pendingMutations)
  }, [pendingMutations, user?.id])

  const enqueuePendingMutation = useCallback((mutation: PendingMutation) => {
    setPendingMutations((current) => enqueueMutation(current, mutation))
  }, [])

  const syncPlaybackState = useCallback(
    (input: {
      songId: string | null
      positionMs: number
      shuffleEnabled: boolean
      repeatMode: RepeatMode
    }) => {
      if (!isOnline) {
        enqueuePendingMutation({ kind: 'playback-state', ...input })
        return
      }

      updatePlaybackState(input).catch((error) => {
        if (isOfflineSyncError(error)) {
          enqueuePendingMutation({ kind: 'playback-state', ...input })
        }
      })
    },
    [enqueuePendingMutation, isOnline],
  )

  // Playback-state updates sync silently; only library changes are worth
  // surfacing as "waiting to sync".
  const pendingSyncCount = useMemo(
    () =>
      pendingMutations.filter((mutation) => mutation.kind !== 'playback-state')
        .length,
    [pendingMutations],
  )
  const openAddMusic = useCallback(() => {
    if (!requireOnlineAction('Reconnect to add or import music.')) return
    setAddOpen(true)
  }, [requireOnlineAction])

  const csvImportToastIds = useMemo(
    () => downloads.filter(isCsvImportDownload).map((download) => download.id),
    [downloads],
  )
  const isCsvImportToastDismissed =
    csvImportToastIds.length > 0 &&
    csvImportToastIds.every((downloadId) =>
      dismissedCsvImportToastIds.has(downloadId),
    )
  const dismissCsvImportToast = useCallback(() => {
    setDismissedCsvImportToastIds(new Set(csvImportToastIds))
  }, [csvImportToastIds])

  const scheduleCsvImportDismiss = useCallback((downloadId: string) => {
    const existingTimeout = csvImportDismissTimeoutsRef.current.get(downloadId)

    if (existingTimeout !== undefined) {
      window.clearTimeout(existingTimeout)
    }

    const timeoutId = window.setTimeout(() => {
      csvImportDismissTimeoutsRef.current.delete(downloadId)
      setDownloads((prev) =>
        prev.filter((download) => download.id !== downloadId),
      )
    }, CSV_IMPORT_CANCEL_DISMISS_DELAY_MS)

    csvImportDismissTimeoutsRef.current.set(downloadId, timeoutId)
  }, [])

  useEffect(() => {
    void reloadOfflineServerSongs()
  }, [reloadOfflineServerSongs])

  useEffect(() => {
    return () => {
      for (const timeoutId of csvImportDismissTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId)
      }

      csvImportDismissTimeoutsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    writeStoredCsvImportDownloads(user?.id, downloads)
  }, [downloads, user?.id])

  useEffect(() => {
    const activeIds = new Set(csvImportToastIds)

    setDismissedCsvImportToastIds((current) => {
      let changed = false
      const next = new Set<string>()

      for (const downloadId of current) {
        if (activeIds.has(downloadId)) {
          next.add(downloadId)
        } else {
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [csvImportToastIds])

  useEffect(() => {
    if (!user?.id || !isOnline) {
      return
    }

    let canceled = false

    void fetchActiveCsvImportBatches()
      .then((result) => {
        if (
          canceled ||
          result.status !== 'authenticated' ||
          result.batches.length === 0
        ) {
          return
        }

        setDownloads((prev) => {
          const existingBatchIds = new Set(prev.flatMap(csvImportBatchIds))
          const restored = result.batches
            .filter((state) => !existingBatchIds.has(state.batch.id))
            .map((state) => {
              const summary = summarizeCsvImportStates([state])

              return {
                artist: csvImportStatusText(summary),
                batchIds: [state.batch.id],
                cancelable: true,
                canceling: false,
                csvImportBatches: [state.batch],
                csvImportItems: state.items,
                id: `csv-import-${state.batch.id}`,
                message: csvImportMessage(summary),
                platform: 'url' as const,
                progress: csvImportProgress(summary, 0.1),
                retrying: false,
                status: csvImportDownloadStatus(summary),
                title: 'CSV playlists',
                url: '',
              } satisfies Download
            })

          return restored.length > 0 ? [...restored, ...prev] : prev
        })
      })
      .catch(() => {
        // Active import restoration is best-effort; stored downloads still load normally.
      })

    return () => {
      canceled = true
    }
  }, [isOnline, user?.id])

  useEffect(() => {
    if (view !== 'admin' || user?.isAdmin) {
      return
    }

    setCollection(null)
    setView('home')
  }, [user?.isAdmin, view])

  useEffect(() => {
    writeStoredNavigation({ collection, view })
  }, [collection, view])

  useEffect(() => {
    setLikedOverrides((current) => {
      let changed = false
      const next = { ...current }

      for (const song of songsState.songs) {
        if (next[song.id] === song.liked) {
          delete next[song.id]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [songsState.songs])

  useEffect(() => {
    activeCsvManualMatchItemIdRef.current = csvManualMatchTarget?.item.id ?? null
  }, [csvManualMatchTarget])

  useEffect(() => {
    activeSongIdsRef.current = new Set(userSongs.map((song) => song.id))
  }, [userSongs])

  useEffect(() => {
    offlineServerSongsRef.current = offlineServerSongs
    void reloadOfflineLibrarySnapshot(offlineServerSongs.map((song) => song.id))
  }, [offlineServerSongs, reloadOfflineLibrarySnapshot])

  // Rebuild optimistic playlist details for changes that were queued offline
  // and survived a reload: playlists created offline plus queued additions
  // and renames layered over the cached snapshot.
  useEffect(() => {
    if (seededPlaylistOverridesRef.current) return

    const hasStructuralChanges =
      seededPendingState.createdPlaylists.length > 0 ||
      Object.keys(seededPendingState.playlistAdditions).length > 0 ||
      Object.keys(seededPendingState.playlistUpdates).length > 0

    if (!hasStructuralChanges) {
      seededPlaylistOverridesRef.current = true
      return
    }

    if (songsState.status === 'loading') return
    if (songsState.status !== 'authenticated' && !offlineSnapshotHydrated) {
      return
    }

    seededPlaylistOverridesRef.current = true

    // The flush may already have synced some of these ops (fast reconnect on
    // an online reload); only seed what is still queued so a remapped local
    // playlist is not resurrected under its stale local id.
    const queuedCreateIds = new Set<string>()
    const queuedPlaylistIds = new Set<string>()

    for (const op of pendingMutationsRef.current) {
      if ('playlistId' in op) {
        queuedPlaylistIds.add(op.playlistId)

        if (op.kind === 'playlist-create') {
          queuedCreateIds.add(op.playlistId)
        }
      }
    }

    const songById = new Map(activeServerSongs.map((song) => [song.id, song]))
    const snapshotDetails = offlineLibrarySnapshot?.playlistDetails ?? []
    const nowIso = new Date().toISOString()
    const seededDetails = new Map<string, ServerPlaylistDetail>()

    for (const created of seededPendingState.createdPlaylists) {
      if (!queuedCreateIds.has(created.playlistId)) continue

      seededDetails.set(created.playlistId, {
        color: null,
        createdAt: nowIso,
        description: created.description,
        id: created.playlistId,
        name: created.name,
        songCount: 0,
        songs: [],
        updatedAt: nowIso,
        userId: user?.id,
      })
    }

    for (const [playlistId, songIds] of Object.entries(
      seededPendingState.playlistAdditions,
    )) {
      if (!queuedPlaylistIds.has(playlistId)) continue

      const base =
        seededDetails.get(playlistId) ??
        snapshotDetails.find((playlist) => playlist.id === playlistId)

      if (!base) continue

      const songs = [...base.songs]

      for (const songId of songIds) {
        const song = songById.get(songId)

        if (!song || songs.some((entry) => entry.id === songId)) continue

        songs.push({ ...song, addedAt: nowIso, position: songs.length })
      }

      seededDetails.set(playlistId, {
        ...base,
        songCount: songs.length,
        songs,
      })
    }

    for (const [playlistId, update] of Object.entries(
      seededPendingState.playlistUpdates,
    )) {
      if (!queuedPlaylistIds.has(playlistId)) continue

      const base =
        seededDetails.get(playlistId) ??
        snapshotDetails.find((playlist) => playlist.id === playlistId)

      if (!base) continue

      seededDetails.set(playlistId, {
        ...base,
        description: update.description,
        name: update.name,
      })
    }

    if (seededDetails.size === 0) return

    setPlaylistDetailOverrides((current) => {
      const next = { ...current }

      for (const [playlistId, detail] of seededDetails) {
        next[playlistId] = next[playlistId] ?? detail
      }

      return next
    })
  }, [
    activeServerSongs,
    offlineLibrarySnapshot,
    offlineSnapshotHydrated,
    seededPendingState,
    songsState.status,
    user?.id,
  ])

  useEffect(() => {
    if (
      songsState.status !== 'authenticated' ||
      library.status !== 'authenticated'
    ) {
      return
    }

    let cancelled = false

    async function cacheLibrarySnapshot() {
      const playlistDetails = (
        await Promise.all(
          library.summary.playlists.map(async (playlist) => {
            try {
              const result = await fetchPlaylist(playlist.id)
              return result.status === 'authenticated' ? result.playlist : null
            } catch {
              return null
            }
          }),
        )
      ).filter((playlist): playlist is ServerPlaylistDetail =>
        Boolean(playlist),
      )

      if (cancelled) return

      await cacheOfflineLibrarySnapshot(library.summary, playlistDetails)

      if (!cancelled) {
        await reloadOfflineLibrarySnapshot(
          offlineServerSongsRef.current.map((song) => song.id),
        )
      }
    }

    void cacheLibrarySnapshot()

    return () => {
      cancelled = true
    }
  }, [
    library.status,
    library.summary,
    reloadOfflineLibrarySnapshot,
    songsState.status,
  ])

  useEffect(() => {
    let cancelled = false

    async function syncOfflineAudioStates() {
      try {
        if (songsState.status === 'authenticated') {
          await deleteOfflineAudioExcept(userSongs.map((song) => song.id))
          if (cancelled) return
          await reloadOfflineServerSongs()
        }

        const states = await getOfflineAudioStates(userSongs)
        if (!cancelled) {
          setOfflineAudio((current) => mergeOfflineStates(current, states))
        }
      } catch {
        if (cancelled) return

        getOfflineAudioStates(userSongs)
          .then((states) => {
            if (cancelled) return
            setOfflineAudio((current) => mergeOfflineStates(current, states))
          })
          .catch(() => undefined)
      }
    }

    void syncOfflineAudioStates()

    return () => {
      cancelled = true
    }
  }, [reloadOfflineServerSongs, songsState.status, userSongs])

  useEffect(() => {
    cacheTrackThumbnails(userSongs.map((song) => song.coverImageUrl))
  }, [userSongs])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let lastPositionStateSecond = -1
    const syncPositionState = () => {
      const session = getNavigatorMediaSession()
      if (session) {
        updateMediaSessionPositionState(session, {
          duration: audio.duration,
          position: audio.currentTime,
        })
      }
    }
    const onTime = () => {
      playbackProgressStore.set({ position: audio.currentTime })
      // The lock screen only needs ~1s accuracy; timeupdate fires ~4x/s.
      const second = Math.floor(audio.currentTime)
      if (second !== lastPositionStateSecond) {
        lastPositionStateSecond = second
        syncPositionState()
      }
    }
    const onLoaded = () => {
      // Fall back to the song-metadata duration already in the store
      // (written when the load started) until the element knows better.
      playbackProgressStore.set({
        duration: audio.duration || playbackProgressStore.get().duration,
      })
      syncPositionState()
    }
    const onEnded = () => handleTrackEndedRef.current()
    const onError = () => recoverFromAudioErrorRef.current()
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('durationchange', onLoaded)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('durationchange', onLoaded)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted])

  useEffect(() => {
    writeStoredVolume(volume)
  }, [volume])

  useEffect(() => {
    writeStoredShuffle(shuffleEnabled)
  }, [shuffleEnabled])

  useEffect(() => {
    writeStoredRepeat(repeatMode)
    repeatModeRef.current = repeatMode
  }, [repeatMode])

  useEffect(() => {
    const session = getNavigatorMediaSession()
    if (session) {
      updateMediaSessionPlaybackState(session, isPlaying)
    }
  }, [isPlaying])

  // Lock-screen / notification metadata. Besides the controls themselves,
  // an active media session is what convinces mobile OSes to keep a
  // backgrounded PWA's audio alive between tracks.
  useEffect(() => {
    const session = getNavigatorMediaSession()
    if (!session || typeof MediaMetadata === 'undefined') return

    applyMediaSessionMetadata(
      session,
      currentSong
        ? {
            album: currentSong.album,
            artist: currentSong.artist,
            artworkUrl: currentSong.coverImageUrl,
            title: currentSong.title,
          }
        : null,
      (init) => new MediaMetadata(init),
    )
  }, [currentSong])

  useEffect(() => {
    const session = getNavigatorMediaSession()
    if (!session) return

    return registerMediaSessionHandlers(session, {
      onNext: () => playNextRef.current(),
      onPause: () => audioRef.current?.pause(),
      onPlay: () => {
        audioRef.current?.play().catch(() => undefined)
      },
      onPrev: () => playPrevRef.current(),
      onSeek: (seconds) => {
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = seconds
        playbackProgressStore.set({ position: seconds })
      },
    })
  }, [])

  // Coming back to the app after the OS suspended us mid-track: if the UI
  // still believes we are playing but the element stalled, nudge it.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const audio = audioRef.current
      if (!audio || !audio.src) return
      if (isPlayingRef.current && audio.paused && !audio.ended) {
        audio.play().catch(() => setIsPlaying(false))
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // Each load is a fresh chance for the once-per-song error recovery.
    audioErrorRecoverySongIdRef.current = null

    if (currentSong && syncLoadedSongIdRef.current === currentSong.id) {
      // The ended-handler already swapped the element to this song
      // synchronously (background auto-advance). Reloading it here would
      // interrupt playback and reintroduce the async gap the swap avoids.
      syncLoadedSongIdRef.current = null
      return
    }
    syncLoadedSongIdRef.current = null

    const loadId = mediaLoadIdRef.current + 1
    mediaLoadIdRef.current = loadId

    if (!currentSong) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      playbackProgressStore.reset()
      return
    }

    let disposed = false
    const songToLoad = currentSong
    const shouldAutoplay = isPlaying

    const loadSong = async () => {
      playbackProgressStore.set({
        duration: songToLoad.duration || 0,
        position: 0,
      })
      audio.pause()
      audio.removeAttribute('src')
      audio.load()

      try {
        // The cache owns offline object URLs (pruned when the song leaves
        // the current/up-next window), so this path and the synchronous
        // auto-advance path share one source-resolution mechanism.
        await trackSourceCache.preload(songToLoad)

        if (disposed || mediaLoadIdRef.current !== loadId) return

        const offlineSource = trackSourceCache.getSync(songToLoad)

        if (offlineSource.kind === 'offline') {
          audio.removeAttribute('crossorigin')
          audio.src = offlineSource.url
        } else {
          setOfflineAudio((states) =>
            states[songToLoad.id]?.status === 'downloaded'
              ? { ...states, [songToLoad.id]: { status: 'idle' } }
              : states,
          )

          const cacheIntent = await requestSongCacheIntent(songToLoad.id)
          const streamUrl =
            cacheIntent.status === 'accepted' && cacheIntent.cacheIntent
              ? cacheIntent.cacheIntent.streamUrl
              : songStreamUrl(songToLoad.id)

          if (disposed || mediaLoadIdRef.current !== loadId) return

          audio.crossOrigin = 'use-credentials'
          audio.src = streamUrl
        }
        audio.load()

        if (shouldAutoplay) {
          await audio.play()
        }
      } catch {
        if (disposed || mediaLoadIdRef.current !== loadId) return
        audio.crossOrigin = 'use-credentials'
        audio.src = songToLoad.url
        audio.load()
        if (shouldAutoplay) {
          audio.play().catch(() => {
            if (mediaLoadIdRef.current === loadId) {
              setIsPlaying(false)
            }
          })
        }
      }
    }

    loadSong()

    return () => {
      disposed = true
    }
    // The song id is the only thing that should reload the media element.
    // Play/pause uses the existing element so controls do not restart tracks.
  }, [currentSongId])

  const playSong = useCallback(
    (
      song: Song,
      contextQueue?: Song[],
      from?: PlayingFromLabel,
      options: { preserveQueueOrder?: boolean } = {},
    ) => {
      const isCurrentSong = song.id === currentSongId

      setCurrentSongId(song.id)
      setIsPlaying(true)
      const baseQueue =
        contextQueue && contextQueue.length > 0 ? contextQueue : [song]
      // If shuffle is on and the queue has more than one item, shuffle the
      // remaining items but keep the requested song at the front.
      let resolvedQueue = baseQueue
      if (
        shuffleEnabled &&
        baseQueue.length > 1 &&
        !options.preserveQueueOrder
      ) {
        const rest = baseQueue.filter((item) => item.id !== song.id)
        resolvedQueue = [song, ...shuffleArray(rest)]
      }
      setQueue(resolvedQueue)
      if (from !== undefined) {
        setPlayingFromLabel(from)
      }
      syncPlaybackState({
        positionMs: 0,
        repeatMode,
        shuffleEnabled,
        songId: song.id,
      })

      if (isCurrentSong) {
        const audio = audioRef.current

        if (audio?.src) {
          if (audio.ended) {
            audio.currentTime = 0
          }

          audio.play().catch(() => setIsPlaying(false))
        }
      }
    },
    [currentSongId, repeatMode, shuffleEnabled, syncPlaybackState],
  )

  const togglePlay = useCallback(() => {
    if (!currentSong) return
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false))
    } else {
      audio.pause()
    }
  }, [currentSong])

  const playCollection = useCallback(
    (songs: Song[], shuffle = false, from?: PlayingFromLabel) => {
      if (songs.length === 0) return
      const ordered = shuffle ? shuffleArray(songs) : songs
      const alreadyHere = ordered.find((song) => song.id === currentSongId)

      if (alreadyHere) {
        setQueue(ordered)
        if (from !== undefined) setPlayingFromLabel(from)
        togglePlay()
        return
      }

      playSong(ordered[0], ordered, from)
    },
    [currentSongId, playSong, togglePlay],
  )

  // The list playback advances through: the explicit queue, else the library.
  const activePlaybackList = useMemo(
    () => (queue.length > 0 ? queue : userSongs),
    [queue, userSongs],
  )

  const playNext = useCallback(() => {
    const result = selectNextTrack(activePlaybackList, currentSongId, repeatMode)

    if (result.action === 'stop') {
      // Stop at the end of the queue when repeat is off.
      audioRef.current?.pause()
      return
    }
    if (result.action === 'play') {
      playSong(result.song, activePlaybackList, undefined, {
        preserveQueueOrder: true,
      })
    }
  }, [activePlaybackList, currentSongId, playSong, repeatMode])

  const playPrev = useCallback(() => {
    if (activePlaybackList.length === 0) return
    const audio = audioRef.current

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }

    const result = selectPrevTrack(activePlaybackList, currentSongId)
    if (result.action === 'play') {
      playSong(result.song, activePlaybackList, undefined, {
        preserveQueueOrder: true,
      })
    }
  }, [activePlaybackList, currentSongId, playSong])

  // Points the audio element at `song` and starts it without a single
  // await. Mobile browsers only allow a backgrounded PWA to continue to
  // the next track if the source swap and play() happen synchronously
  // inside the `ended` event — any IndexedDB read or fetch in between
  // and the OS revokes the audio session until the app is reopened.
  const startSongSynchronously = useCallback(
    (song: Song) => {
      const audio = audioRef.current
      if (!audio) return false

      const source = trackSourceCache.getSync(song)
      const loadId = mediaLoadIdRef.current + 1
      mediaLoadIdRef.current = loadId
      syncLoadedSongIdRef.current = song.id

      if (source.kind === 'offline') {
        audio.removeAttribute('crossorigin')
      } else {
        audio.crossOrigin = 'use-credentials'
      }
      audio.src = source.url
      playbackProgressStore.set({ duration: song.duration || 0, position: 0 })
      audio.play().catch(() => {
        if (mediaLoadIdRef.current === loadId) {
          // The fast path failed — clear the skip marker so the async
          // load effect can attempt a full load on the next commit.
          syncLoadedSongIdRef.current = null
          setIsPlaying(false)
        }
      })

      if (source.kind === 'stream') {
        // Parity with the async load path, without an await before
        // play(): reset stale offline state and register the server
        // cache intent for this stream.
        setOfflineAudio((states) =>
          states[song.id]?.status === 'downloaded'
            ? { ...states, [song.id]: { status: 'idle' } }
            : states,
        )
        requestSongCacheIntent(song.id).catch(() => undefined)
      }

      return true
    },
    [trackSourceCache],
  )

  const handleTrackEnded = useCallback(() => {
    if (repeatModeRef.current === 'one') {
      const audio = audioRef.current
      if (audio) {
        audio.currentTime = 0
        audio.play().catch(() => undefined)
      }
      return
    }

    const result = selectNextTrack(
      activePlaybackList,
      currentSongId,
      repeatModeRef.current,
    )

    if (result.action !== 'play') {
      audioRef.current?.pause()
      setIsPlaying(false)
      return
    }

    startSongSynchronously(result.song)
    playSong(result.song, activePlaybackList, undefined, {
      preserveQueueOrder: true,
    })
    if (result.song.id === currentSongId) {
      // Same-song advance (single-track repeat "all"): currentSongId does
      // not change, so the load effect never consumes the skip marker.
      syncLoadedSongIdRef.current = null
    }
  }, [
    activePlaybackList,
    currentSongId,
    playSong,
    startSongSynchronously,
  ])

  // If a stream source fails (offline device, expired session, flaky
  // network), fall back to the locally saved copy once per song load.
  const recoverFromAudioError = useCallback(() => {
    const song = currentSong
    const audio = audioRef.current
    if (!song || !audio || !audio.src) return
    if (audioErrorRecoverySongIdRef.current === song.id) {
      setIsPlaying(false)
      return
    }
    audioErrorRecoverySongIdRef.current = song.id
    const observedLoadId = mediaLoadIdRef.current

    const resume = async () => {
      await trackSourceCache.preload(song)
      // Abort if another load claimed the element while we were reading
      // the offline copy (user skipped to a different track).
      if (mediaLoadIdRef.current !== observedLoadId || !audioRef.current) {
        return
      }
      const source = trackSourceCache.getSync(song)
      if (source.kind !== 'offline') {
        setIsPlaying(false)
        return
      }
      // Claim the element so the load effect's in-flight catch fallback
      // cannot race this swap with a second src assignment.
      const loadId = observedLoadId + 1
      mediaLoadIdRef.current = loadId
      const element = audioRef.current
      element.removeAttribute('crossorigin')
      element.src = source.url
      element.play().catch(() => {
        if (mediaLoadIdRef.current === loadId) {
          setIsPlaying(false)
        }
      })
    }

    resume().catch(() => setIsPlaying(false))
  }, [currentSong, trackSourceCache])

  // Latest-callback refs: stable event listeners (audio events, media
  // session, visibilitychange) call through these to reach fresh closures.
  useEffect(() => {
    playNextRef.current = playNext
    playPrevRef.current = playPrev
    handleTrackEndedRef.current = handleTrackEnded
    recoverFromAudioErrorRef.current = recoverFromAudioError
    isPlayingRef.current = isPlaying
  })

  // Keep the upcoming track's offline copy resolved so the ended-handler
  // can swap sources synchronously, and drop object URLs we outgrew.
  useEffect(() => {
    const upNext = selectNextTrack(activePlaybackList, currentSongId, 'all')
    const keepIds: string[] = []

    if (currentSongId) keepIds.push(currentSongId)
    if (upNext.action === 'play') {
      keepIds.push(upNext.song.id)
      trackSourceCache.preload(upNext.song)
    }

    trackSourceCache.prune(keepIds)
  }, [activePlaybackList, currentSongId, trackSourceCache])

  useEffect(
    () => () => trackSourceCache.dispose(),
    [trackSourceCache],
  )

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((current) => {
      const next = !current
      if (next) {
        // Reshuffle queue but pin the current song at position 0.
        setQueue((q) => {
          if (q.length <= 1) return q
          const idx = q.findIndex((song) => song.id === currentSongId)
          if (idx === -1) return shuffleArray(q)
          const before = q.slice(0, idx)
          const here = q[idx]
          const after = q.slice(idx + 1)
          return [here, ...shuffleArray([...before, ...after])]
        })
      }
      return next
    })
  }, [currentSongId])

  const cycleRepeat = useCallback(() => {
    setRepeatMode((current) => {
      if (current === 'off') return 'all'
      if (current === 'all') return 'one'
      return 'off'
    })
  }, [])

  const removeFromQueue = useCallback(
    (songId: string) => {
      if (songId === currentSongId) return
      setQueue((q) => q.filter((s) => s.id !== songId))
    },
    [currentSongId],
  )

  const derivePlayingFromLabel = useCallback((): PlayingFromLabel => {
    if (collection?.kind === 'system' && collection.id === 'liked-songs') {
      return { kind: 'liked', name: 'Liked Songs' }
    }
    if (collection?.kind === 'playlist') {
      const match = playlists.find((p) => p.id === collection.id)
      return { kind: 'playlist', name: match?.name }
    }
    if (collection?.kind === 'category') {
      return { kind: 'library' }
    }
    if (view === 'search') return { kind: 'search' }
    if (view === 'home') return { kind: 'home' }
    return { kind: 'library' }
  }, [collection, playlists, view])

  const seek = useCallback((value: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    playbackProgressStore.set({ position: value })
  }, [])

  const refreshLibrary = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  const cachePlaylistDetail = useCallback((playlist: ServerPlaylistDetail) => {
    setPlaylistDetailOverrides((current) => ({
      ...current,
      [playlist.id]: playlist,
    }))
    setLocallyDeletedPlaylistIds((current) => {
      if (!current.has(playlist.id)) return current

      const next = new Set(current)
      next.delete(playlist.id)
      return next
    })
    setPlaylistSongRemovals((current) => {
      if (!(playlist.id in current)) return current

      const next = { ...current }
      delete next[playlist.id]
      return next
    })
  }, [])

  const hideSongFromPlaylist = useCallback(
    (playlistId: string, songId: string) => {
      setPlaylistSongRemovals((current) => {
        const removedSongIds = current[playlistId] ?? []

        if (removedSongIds.includes(songId)) {
          return current
        }

        return {
          ...current,
          [playlistId]: [...removedSongIds, songId],
        }
      })
    },
    [],
  )

  const flushOfflineMutations = useCallback(async () => {
    if (flushingPendingMutationsRef.current) return

    const snapshot = pendingMutationsRef.current

    if (snapshot.length === 0) return

    flushingPendingMutationsRef.current = true

    try {
      const result = await flushPendingMutations(snapshot, {
        addSongToPlaylist,
        createPlaylist,
        deletePlaylist,
        deleteSong,
        likeSong,
        removeSongFromPlaylist,
        unlikeSong,
        updatePlaybackState,
        updatePlaylist,
      })
      const snapshotIds = new Set(snapshot.map((op) => op.id))

      setPendingMutations((current) => {
        // Mutations enqueued while the flush was in flight survive it.
        let enqueuedDuringFlush = current.filter(
          (op) => !snapshotIds.has(op.id),
        )

        for (const remap of result.remapped) {
          enqueuedDuringFlush = remapPlaylistId(
            enqueuedDuringFlush,
            remap.localId,
            remap.playlistId,
          )
        }

        return [...result.remaining, ...enqueuedDuringFlush]
      })

      if (result.remapped.length > 0) {
        // Playlists created offline now exist on the server: move their
        // local overrides (and an open collection view) to the server ids.
        setPlaylistDetailOverrides((current) => {
          const next = { ...current }

          for (const remap of result.remapped) {
            const detail = next[remap.localId]

            delete next[remap.localId]

            if (detail) {
              next[remap.playlistId] = { ...detail, id: remap.playlistId }
            }
          }

          return next
        })
        setCollection((current) => {
          if (current?.kind !== 'playlist') return current

          const remap = result.remapped.find(
            (item) => item.localId === current.id,
          )

          return remap ? { id: remap.playlistId, kind: 'playlist' } : current
        })
      }

      if (result.blocked === 'auth' && !syncAuthNoticeShownRef.current) {
        syncAuthNoticeShownRef.current = true
        toast({
          title: 'Sign in to finish syncing',
          description:
            'Changes made offline are saved on this device and will sync after you sign in again.',
          variant: 'destructive',
        })
      }

      if (result.applied > 0) {
        syncAuthNoticeShownRef.current = false
        refreshLibrary()

        const syncedLibraryChanges = snapshot.some(
          (op) => op.kind !== 'playback-state',
        )

        if (
          syncedLibraryChanges &&
          result.blocked === null &&
          result.remaining.length === 0
        ) {
          toast({
            title: 'Offline changes synced',
            description: 'Changes made offline are now saved to your library.',
          })
        }
      }
    } finally {
      flushingPendingMutationsRef.current = false
    }
  }, [refreshLibrary])

  useEffect(() => {
    if (!isOnline || pendingMutations.length === 0) return

    void flushOfflineMutations()

    const retryTimer = window.setInterval(() => {
      void flushOfflineMutations()
    }, OFFLINE_SYNC_RETRY_INTERVAL_MS)

    return () => window.clearInterval(retryTimer)
  }, [flushOfflineMutations, isOnline, pendingMutations.length])

  useEffect(() => {
    const wasOnline = wasOnlineRef.current

    wasOnlineRef.current = isOnline

    if (!wasOnline && isOnline && pendingMutationsRef.current.length === 0) {
      // With pending offline changes the flush refreshes after it syncs;
      // refreshing here too would briefly show pre-sync server state.
      refreshLibrary()
    }
  }, [isOnline, refreshLibrary])

  const removeSongsFromDeviceState = useCallback(
    (songIds: string[]) => {
      const removedSongIds = new Set(songIds.filter(Boolean))

      if (removedSongIds.size === 0) return

      for (const songId of removedSongIds) {
        activeSongIdsRef.current.delete(songId)
      }

      setLocallyDeletedSongIds((current) => {
        const next = new Set(current)

        for (const songId of removedSongIds) {
          next.add(songId)
        }

        return next
      })
      setLikedOverrides((current) => {
        const next = { ...current }

        for (const songId of removedSongIds) {
          delete next[songId]
        }

        return next
      })
      setQueue((current) =>
        current.filter((item) => !removedSongIds.has(item.id)),
      )
      setOfflineAudio((states) => {
        const next = { ...states }

        for (const songId of removedSongIds) {
          next[songId] = { status: 'idle' }
        }

        return next
      })
      Promise.all(
        [...removedSongIds].map((songId) =>
          deleteOfflineAudio(songId).catch(() => undefined),
        ),
      )
        .then(reloadOfflineServerSongs)
        .catch(() => undefined)

      if (currentSongId && removedSongIds.has(currentSongId)) {
        const audio = audioRef.current
        audio?.pause()
        audio?.removeAttribute('src')
        audio?.load()
        setCurrentSongId(null)
        setIsPlaying(false)
        playbackProgressStore.reset()
        syncPlaybackState({
          positionMs: 0,
          repeatMode: 'off',
          shuffleEnabled: false,
          songId: null,
        })
      }

      setLibrarySync({
        completed: 0,
        failed: 0,
        status: 'idle',
        total: 0,
      })
    },
    [currentSongId, reloadOfflineServerSongs, syncPlaybackState],
  )

  useEffect(() => {
    if (offlineOnlyMode || !user?.id || typeof EventSource === 'undefined') {
      return
    }

    const events = new EventSource(apiUrl('/api/library/events'), {
      withCredentials: true,
    })
    let refreshTimer: number | null = null

    const scheduleRefresh = () => {
      if (refreshTimer !== null) {
        return
      }

      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        refreshLibrary()
      }, 150)
    }

    const handleLibraryChanged = (event: Event) => {
      const message = parseLibraryChangedMessage(event)

      if (message?.reason === 'song_removed' && message.songId) {
        const wasHandledLocally =
          locallyHandledSongRemovalIdsRef.current.delete(message.songId)

        removeSongsFromDeviceState([message.songId])

        if (wasHandledLocally) {
          return
        }
      }

      if (message?.reason === 'account_tracks_wiped') {
        setLibrarySync({
          completed: 0,
          failed: 0,
          status: 'idle',
          total: 0,
        })
      }

      scheduleRefresh()
    }

    events.addEventListener('library_changed', handleLibraryChanged)

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }

      events.removeEventListener('library_changed', handleLibraryChanged)
      events.close()
    }
  }, [offlineOnlyMode, refreshLibrary, removeSongsFromDeviceState, user?.id])

  const downloadSongForOffline = useCallback(
    async (song: Song, notify = true) => {
      if (!requireOnlineAction('Reconnect to save this song on this device.')) {
        return false
      }

      setOfflineAudio((states) => ({
        ...states,
        [song.id]: { progress: 0, status: 'downloading' },
      }))

      try {
        const state = await downloadOfflineAudio(song, {
          onProgress(progress) {
            setOfflineAudio((states) => ({
              ...states,
              [song.id]: { progress, status: 'downloading' },
            }))
          },
        })

        if (!activeSongIdsRef.current.has(song.id)) {
          await deleteOfflineAudio(song.id)
          setOfflineAudio((states) => ({
            ...states,
            [song.id]: { status: 'idle' },
          }))
          void reloadOfflineServerSongs()
          return false
        }

        setOfflineAudio((states) => ({
          ...states,
          [song.id]: state,
        }))
        void reloadOfflineServerSongs()

        if (notify) {
          toast({
            title: 'Saved for offline listening',
            description: `${song.title} will play from this device when available.`,
          })
        }

        return true
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Offline download failed.'

        setOfflineAudio((states) => ({
          ...states,
          [song.id]: { message, progress: 1, status: 'error' },
        }))

        if (notify) {
          toast({
            title: 'Download failed',
            description: message,
            variant: 'destructive',
          })
        }

        return false
      }
    },
    [reloadOfflineServerSongs, requireOnlineAction],
  )

  const deleteSongLocally = useCallback(
    (song: Song) => {
      enqueuePendingMutation({ kind: 'song-delete', songId: song.id })
      removeSongsFromDeviceState([song.id])
      toast({
        title: 'Removed from your library',
        description:
          'Any local offline copy was removed; the server copy will be removed when you reconnect.',
      })
    },
    [enqueuePendingMutation, removeSongsFromDeviceState],
  )

  const deleteSongFromLibrary = useCallback(
    async (song: Song) => {
      if (deletingSongId) return

      if (!isOnline) {
        deleteSongLocally(song)
        return
      }

      setDeletingSongId(song.id)
      locallyHandledSongRemovalIdsRef.current.add(song.id)

      try {
        const result = await deleteSong(song.id)

        if (result.status === 'anonymous') {
          locallyHandledSongRemovalIdsRef.current.delete(song.id)
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the song could be removed.',
            variant: 'destructive',
          })
          return
        }

        removeSongsFromDeviceState([song.id])
        window.setTimeout(() => {
          locallyHandledSongRemovalIdsRef.current.delete(song.id)
        }, 5000)
        toast({
          title:
            result.status === 'not-found'
              ? 'Song already removed'
              : 'Removed from your library',
          description: 'Any local offline copy was removed too.',
        })
      } catch (error) {
        locallyHandledSongRemovalIdsRef.current.delete(song.id)

        if (isOfflineSyncError(error)) {
          deleteSongLocally(song)
          return
        }

        toast({
          title: 'Could not remove song',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      } finally {
        setDeletingSongId(null)
      }
    },
    [
      deleteSongLocally,
      deletingSongId,
      isOnline,
      removeSongsFromDeviceState,
    ],
  )

  const handleTracksWiped = useCallback(
    (songIds: string[]) => {
      removeSongsFromDeviceState(songIds)
      refreshLibrary()
    },
    [refreshLibrary, removeSongsFromDeviceState],
  )

  const toggleSongLike = useCallback(
    async (song: Song) => {
      if (!song.serverSong || likingSongId) return

      const wasLiked = songLiked(song)
      const nextLiked = !wasLiked
      const applyLiked = (liked: boolean) => {
        setLikedOverrides((current) => ({ ...current, [song.id]: liked }))
        setQueue((current) =>
          current.map((item) =>
            item.id === song.id ? applyLikedToSong(item, liked) : item,
          ),
        )
      }
      const queueForSync = () => {
        enqueuePendingMutation({
          kind: 'song-like',
          liked: nextLiked,
          songId: song.id,
        })
        toast({
          title: nextLiked ? 'Added to Liked Songs' : 'Removed from Liked Songs',
          description: `"${song.title}" is saved on this device and will sync when you reconnect.`,
        })
      }

      applyLiked(nextLiked)

      if (!isOnline) {
        queueForSync()
        return
      }

      setLikingSongId(song.id)

      try {
        const result = nextLiked
          ? await likeSong(song.id)
          : await unlikeSong(song.id)

        if (result.status === 'anonymous') {
          applyLiked(wasLiked)
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the song could be updated.',
            variant: 'destructive',
          })
          return
        }

        if (result.status === 'not-found') {
          removeSongsFromDeviceState([song.id])
          toast({
            title: 'Song not found',
            description: 'This song may have already been removed.',
            variant: 'destructive',
          })
          return
        }

        toast({
          title: nextLiked ? 'Added to Liked Songs' : 'Removed from Liked Songs',
          description: `"${song.title}" ${
            nextLiked ? 'is now in' : 'left'
          } your Liked Songs.`,
        })
      } catch (error) {
        if (isOfflineSyncError(error)) {
          queueForSync()
          return
        }

        applyLiked(wasLiked)
        toast({
          title: 'Could not update Liked Songs',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      } finally {
        setLikingSongId(null)
      }
    },
    [enqueuePendingMutation, isOnline, likingSongId, removeSongsFromDeviceState],
  )

  const toggleSongOffline = useCallback(async (song: Song) => {
    if (!canStoreOffline(song)) return

    const current = offlineAudio[song.id]

    if (current?.status === 'downloading') return

    if (current?.status === 'downloaded') {
      await deleteOfflineAudio(song.id)
      void reloadOfflineServerSongs()
      setOfflineAudio((states) => ({
        ...states,
        [song.id]: { status: 'idle' },
      }))
      toast({
        title: 'Offline download removed',
        description: `${song.title} will stream from the server again.`,
      })
      return
    }

    if (!requireOnlineAction('Reconnect to save this song on this device.')) {
      return
    }

    await downloadSongForOffline(song)
  }, [
    downloadSongForOffline,
    offlineAudio,
    reloadOfflineServerSongs,
    requireOnlineAction,
  ])

  const toggleCollectionOffline = useCallback(
    async (songs: Song[]) => {
      const downloadable = songs.filter(canStoreOffline)

      if (downloadable.length === 0) return

      const allDownloaded = downloadable.every(
        (song) => offlineAudio[song.id]?.status === 'downloaded',
      )

      if (allDownloaded) {
        await Promise.all(downloadable.map((song) => deleteOfflineAudio(song.id)))
        void reloadOfflineServerSongs()
        setOfflineAudio((states) => {
          const next = { ...states }
          downloadable.forEach((song) => {
            next[song.id] = { status: 'idle' }
          })
          return next
        })
        toast({
          title: 'Collection downloads removed',
          description: `${downloadable.length} ${
            downloadable.length === 1 ? 'song' : 'songs'
          } will stream next time.`,
        })
        return
      }

      if (!requireOnlineAction('Reconnect to save this collection on this device.')) {
        return
      }

      const pending = downloadable.filter((song) => {
        const state = offlineAudio[song.id]?.status
        return state !== 'downloaded' && state !== 'downloading'
      })
      let savedCount = 0

      await runWithConcurrency(
        pending,
        OFFLINE_DOWNLOAD_CONCURRENCY,
        async (song) => {
          if (await downloadSongForOffline(song, false)) {
            savedCount += 1
          }
        },
      )

      toast({
        title: savedCount > 0 ? 'Collection saved offline' : 'Nothing new to download',
        description:
          savedCount > 0
            ? `${savedCount} ${
                savedCount === 1 ? 'song' : 'songs'
              } saved on this device.`
            : 'The available songs were already saved or downloading.',
      })
    },
    [
      downloadSongForOffline,
      offlineAudio,
      reloadOfflineServerSongs,
      requireOnlineAction,
    ],
  )

  const syncLibraryToDevice = useCallback(async () => {
    if (librarySync.status === 'syncing') return
    if (!requireOnlineAction('Reconnect to sync songs to this device.')) return

    const downloadable = userSongs.filter(canStoreOffline)

    if (downloadable.length === 0) {
      toast({
        title: 'Nothing to sync',
        description: 'Your library does not have any server-backed songs yet.',
      })
      return
    }

    const alreadyReady = downloadable.filter((song) =>
      ['downloaded', 'downloading'].includes(offlineAudio[song.id]?.status ?? ''),
    ).length
    const pending = downloadable.filter((song) => {
      const status = offlineAudio[song.id]?.status
      return status !== 'downloaded' && status !== 'downloading'
    })

    if (pending.length === 0) {
      toast({
        title: 'Library already synced',
        description: `${downloadable.length} ${
          downloadable.length === 1 ? 'song is' : 'songs are'
        } saved or downloading on this device.`,
      })
      return
    }

    let completed = alreadyReady
    let failed = 0

    setLibrarySync({
      completed,
      failed,
      status: 'syncing',
      total: downloadable.length,
    })

    await runWithConcurrency(
      pending,
      OFFLINE_DOWNLOAD_CONCURRENCY,
      async (song) => {
        const saved = await downloadSongForOffline(song, false)

        completed += 1
        if (!saved) failed += 1

        setLibrarySync({
          completed,
          failed,
          status: 'syncing',
          total: downloadable.length,
        })
      },
    )

    setLibrarySync({
      completed,
      failed,
      status: 'idle',
      total: downloadable.length,
    })

    toast({
      title: failed > 0 ? 'Library sync finished with errors' : 'Library synced',
      description:
        failed > 0
          ? `${downloadable.length - failed} saved, ${failed} failed.`
          : `${downloadable.length} ${
              downloadable.length === 1 ? 'song is' : 'songs are'
            } saved on this device.`,
      variant: failed > 0 ? 'destructive' : 'default',
    })
  }, [
    downloadSongForOffline,
    librarySync.status,
    offlineAudio,
    requireOnlineAction,
    userSongs,
  ])

  const onFilesSelected = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      if (!requireOnlineAction('Reconnect to import audio.')) return

      const id = `upload-${Date.now()}`
      setDownloads((prev) => [
        {
          artist: 'OnVibe server',
          id,
          platform: 'upload',
          progress: 0.2,
          status: 'downloading',
          title: list.length === 1 ? list[0].name : `${list.length} audio files`,
          url: '',
        },
        ...prev,
      ])

      try {
        const result = await importAudioFiles(list, importPolicy.policy.mode)

        if (result.status === 'anonymous') {
          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    message: 'Sign in again to import audio.',
                    progress: 1,
                    status: 'error',
                  }
                : download,
            ),
          )
          return
        }

        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? { ...download, progress: 1, status: 'complete' }
              : download,
          ),
        )
        refreshLibrary()
        setCollection(null)
        setView('library')
        setTimeout(() => {
          setDownloads((prev) => prev.filter((download) => download.id !== id))
        }, 4000)
      } catch (error) {
        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Audio import failed.',
                  progress: 1,
                  status: 'error',
                }
              : download,
          ),
        )
      }
    },
    [importPolicy.policy.mode, refreshLibrary, requireOnlineAction],
  )

  const monitorCsvImportBatches = useCallback(
    async (downloadId: string, initialStates: CsvImportBatchState[]) => {
      let states = initialStates
      let summary = summarizeCsvImportStates(states)
      let refreshedCompletedItems = summary.completedItems

      setDownloads((prev) =>
        prev.map((download) =>
            download.id === downloadId
              ? {
                  ...download,
                  artist: csvImportStatusText(summary),
                  csvImportBatches: states.map((state) => state.batch),
                  csvImportItems: states.flatMap((state) => state.items),
                  message: csvImportMessage(summary),
                  progress: csvImportProgress(summary, download.progress),
                  retrying: false,
                  status: csvImportDownloadStatus(summary),
                }
              : download,
        ),
      )

      let pollLostBatch = false
      let consecutiveRefreshFailures = 0

      while (
        summary.isRunning &&
        !canceledCsvImportIdsRef.current.has(downloadId)
      ) {
        await wait(1500)

        if (canceledCsvImportIdsRef.current.has(downloadId)) {
          break
        }

        const refreshedStates = await Promise.all(
          states.map(async (state) => {
            if (
              state.batch.status !== 'pending' &&
              state.batch.status !== 'running'
            ) {
              return { failed: false, state }
            }

            try {
              const next = await fetchCsvImportBatch(state.batch.id, {
                items: 'attention',
              })

              if (next.status !== 'authenticated' || !next.batch) {
                return { failed: true, state }
              }

              return {
                failed: false,
                state: {
                  batch: next.batch,
                  items: next.items,
                },
              }
            } catch {
              return { failed: true, state }
            }
          }),
        )

        if (refreshedStates.some((result) => result.failed)) {
          consecutiveRefreshFailures += 1
          pollLostBatch =
            consecutiveRefreshFailures >=
            CSV_IMPORT_STATUS_REFRESH_FAILURE_LIMIT
        } else {
          consecutiveRefreshFailures = 0
        }

        states = refreshedStates.map((result) => result.state)
        summary = summarizeCsvImportStates(states)

        if (summary.completedItems > refreshedCompletedItems) {
          refreshedCompletedItems = summary.completedItems
          refreshLibrary()
        }

        setDownloads((prev) =>
          prev.map((download) =>
            download.id === downloadId
              ? {
                  ...download,
                  artist: csvImportStatusText(summary),
                  csvImportBatches: states.map((state) => state.batch),
                  csvImportItems: states.flatMap((state) => state.items),
                  message: csvImportMessage(summary),
                  progress: csvImportProgress(summary, download.progress),
                  retrying: false,
                  status: csvImportDownloadStatus(summary),
                }
              : download,
          ),
        )

        if (pollLostBatch) {
          break
        }

        if (!activeCsvManualMatchItemIdRef.current) {
          const manualMatchItem = nextCsvManualMatchItem(
            states,
            promptedCsvManualMatchIdsRef.current,
            activeCsvManualMatchItemIdRef.current,
          )

          if (manualMatchItem) {
            promptedCsvManualMatchIdsRef.current.add(manualMatchItem.id)
            promptCsvManualMatchRef.current(downloadId, manualMatchItem)
          }
        }
      }

      if (canceledCsvImportIdsRef.current.has(downloadId)) {
        return { canceled: true, states, summary }
      }

      if (pollLostBatch) {
        throw new Error('CSV import status could not be refreshed.')
      }

      states = await Promise.all(
        states.map(async (state) => {
          const next = await fetchCsvImportBatch(state.batch.id)

          if (next.status !== 'authenticated' || !next.batch) {
            return state
          }

          return {
            batch: next.batch,
            items: next.items,
          }
        }),
      )
      summary = summarizeCsvImportStates(states)

      setDownloads((prev) =>
        prev.map((download) =>
          download.id === downloadId
            ? {
                ...download,
                canceling: false,
                csvImportBatches: states.map((state) => state.batch),
                csvImportItems: states.flatMap((state) => state.items),
                message: csvImportMessage(summary),
                progress: csvImportProgress(summary, 1),
                retrying: false,
                status: csvImportDownloadStatus(summary),
              }
            : download,
        ),
      )

      if (!activeCsvManualMatchItemIdRef.current) {
        const manualMatchItem = nextCsvManualMatchItem(
          states,
          promptedCsvManualMatchIdsRef.current,
          activeCsvManualMatchItemIdRef.current,
        )

        if (manualMatchItem) {
          promptedCsvManualMatchIdsRef.current.add(manualMatchItem.id)
          promptCsvManualMatchRef.current(downloadId, manualMatchItem)
        }
      }
      refreshLibrary()
      setCollection(null)
      setView('library')

      if (shouldDismissCsvImportDownload(summary)) {
        window.setTimeout(() => {
          setDownloads((prev) =>
            prev.filter((download) => download.id !== downloadId),
          )
        }, 5000)
      }

      return { canceled: false, states, summary }
    },
    [refreshLibrary],
  )

  useEffect(() => {
    for (const download of downloads) {
      if (
        download.status !== 'downloading' ||
        resumedCsvImportIdsRef.current.has(download.id) ||
        csvImportBatchIds(download).length === 0
      ) {
        continue
      }

      resumedCsvImportIdsRef.current.add(download.id)
      void loadCsvImportStatesForDownload(download).then((states) => {
        if (states.length === 0) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === download.id
                ? {
                    ...item,
                    message: 'CSV import could not be restored.',
                    progress: 1,
                    status: 'error',
                  }
                : item,
            ),
          )
          return
        }

        void monitorCsvImportBatches(download.id, states).catch((error) => {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === download.id
                ? {
                    ...item,
                    message:
                      error instanceof Error
                        ? error.message
                        : 'CSV import status could not be refreshed.',
                    progress: 1,
                    retrying: false,
                    status: 'error',
                  }
                : item,
            ),
          )
        })
      })
    }
  }, [downloads, monitorCsvImportBatches])

  const monitorExternalImport = useCallback(
    async (downloadId: string, jobId: string, sourceId: string) => {
      let progress = 0.35
      let consecutiveRefreshFailures = 0

      while (true) {
        await wait(2000)

        try {
          const result = await fetchExternalImportJob(jobId)

          if (result.status === 'anonymous') {
            setDownloads((prev) =>
              prev.map((download) =>
                download.id === downloadId
                  ? {
                      ...download,
                      message: 'Sign in again to import from links.',
                      progress: 1,
                      status: 'error',
                    }
                  : download,
              ),
            )
            return
          }

          if (result.status === 'not-found' || !result.job) {
            throw new Error('Import status could not be found.')
          }

          consecutiveRefreshFailures = 0

          if (result.job.status === 'pending') {
            progress = Math.min(0.92, progress + 0.08)
            setDownloads((prev) =>
              prev.map((download) =>
                download.id === downloadId
                  ? {
                      ...download,
                      externalImportJobId: jobId,
                      message: 'Importing audio...',
                      progress,
                      status: 'downloading',
                    }
                  : download,
              ),
            )
            continue
          }

          if (result.job.status === 'failed') {
            setDownloads((prev) =>
              prev.map((download) =>
                download.id === downloadId
                  ? {
                      ...download,
                      message: externalImportFailureMessage(result.job.errorCode),
                      progress: 1,
                      status: 'error',
                    }
                  : download,
              ),
            )
            return
          }

          setDownloads((prev) =>
            prev.map((download) =>
              download.id === downloadId
                ? {
                    ...download,
                    message: 'Added to your library',
                    progress: 1,
                    status: 'complete',
                  }
                : download,
            ),
          )
          setExternalResults((prev) =>
            prev.filter((discovery) => discovery.sourceId !== sourceId),
          )
          refreshLibrary()
          setCollection(null)
          setView('library')
          window.setTimeout(() => {
            setDownloads((prev) =>
              prev.filter((download) => download.id !== downloadId),
            )
          }, 4000)
          return
        } catch (error) {
          consecutiveRefreshFailures += 1

          if (
            consecutiveRefreshFailures <
            EXTERNAL_IMPORT_STATUS_REFRESH_FAILURE_LIMIT
          ) {
            continue
          }

          throw error
        }
      }
    },
    [refreshLibrary],
  )

  const onCsvFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      if (!requireOnlineAction('Reconnect to import CSV playlists.')) return

      const id = `csv-import-${Date.now()}`
      canceledCsvImportIdsRef.current.delete(id)
      resumedCsvImportIdsRef.current.add(id)
      setDownloads((prev) => [
        {
          artist: 'CSV playlists',
          batchIds: [],
          cancelable: true,
          canceling: false,
          id,
          platform: 'url',
          progress: 0.05,
          status: 'downloading',
          title: files.length === 1 ? files[0].name : `${files.length} CSV files`,
          url: '',
        },
        ...prev,
      ])

      try {
        const result = await createCsvImportBatches(files)

        if (result.status === 'anonymous' || result.batches.length === 0) {
          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    message: 'Sign in again to import CSV playlists.',
                    progress: 1,
                    status: 'error',
                  }
                : download,
            ),
          )
          return
        }

        const batches = result.batches
        const batchIds = batches.map((batch) => batch.id)

        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  batchIds,
                }
              : download,
          ),
        )

        if (canceledCsvImportIdsRef.current.has(id)) {
          const canceled = await Promise.all(
            batchIds.map((batchId) => cancelCsvImportBatch(batchId)),
          )
          const canceledBatches = canceled
            .map((item) => item.batch)
            .filter((batch): batch is CsvImportBatch => Boolean(batch))
          const canceledItems = canceled.flatMap((item) => item.items)
          const canceledSummary = summarizeCsvImportBatches(canceledBatches)

          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    artist: `${canceledSummary.completedItems} done, ${canceledSummary.failedItems} canceled`,
                    canceling: false,
                    csvImportBatches: canceledBatches,
                    csvImportItems: canceledItems,
                    message: 'CSV import canceled.',
                    progress:
                      canceledSummary.totalItems > 0
                        ? (canceledSummary.completedItems +
                            canceledSummary.failedItems) /
                          canceledSummary.totalItems
                        : 1,
                    status: 'canceled',
                  }
                : download,
            ),
          )
          refreshLibrary()
          scheduleCsvImportDismiss(id)
          return
        }

        const initialStates = batches.map((batch) => ({
          batch,
          items: [] as CsvImportItem[],
        }))
        const summary = summarizeCsvImportStates(initialStates)
        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  csvImportBatches: batches,
                  artist: `${summary.totalItems} queued`,
                  progress:
                    summary.totalItems > 0
                      ? (summary.completedItems + summary.failedItems) /
                        summary.totalItems
                      : 0.1,
                }
              : download,
          ),
        )

        await monitorCsvImportBatches(id, initialStates)
      } catch (error) {
        if (canceledCsvImportIdsRef.current.has(id)) {
          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    artist: 'CSV import canceled',
                    canceling: false,
                    message: 'CSV import canceled.',
                    progress: 1,
                    status: 'canceled',
                  }
                : download,
            ),
          )
          scheduleCsvImportDismiss(id)
          return
        }

        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'CSV import failed.',
                  progress: 1,
                  status: 'error',
                }
              : download,
          ),
        )
      }
    },
    [
      monitorCsvImportBatches,
      refreshLibrary,
      requireOnlineAction,
      scheduleCsvImportDismiss,
    ],
  )

  const cancelCsvImport = useCallback(
    async (download: Download) => {
      if (download.status !== 'downloading' || download.canceling) return
      if (!requireOnlineAction('Reconnect to cancel CSV imports.')) return

      canceledCsvImportIdsRef.current.add(download.id)
      setDownloads((prev) =>
        prev.map((item) =>
          item.id === download.id
            ? {
                ...item,
                artist: 'Canceling CSV import',
                canceling: true,
                message: 'Canceling CSV import.',
              }
            : item,
        ),
      )

      const batchIds = download.batchIds ?? []

      if (batchIds.length === 0) {
        return
      }

      try {
        const results = await Promise.all(
          batchIds.map((batchId) => cancelCsvImportBatch(batchId)),
        )
        const batches = results
          .map((result) => result.batch)
          .filter((batch): batch is CsvImportBatch => Boolean(batch))
        const items = results.flatMap((result) => result.items)
        const summary = summarizeCsvImportBatches(batches)

        setDownloads((prev) =>
          prev.map((item) =>
            item.id === download.id
              ? {
                  ...item,
                  artist: `${summary.completedItems} done, ${summary.failedItems} canceled`,
                  canceling: false,
                  csvImportBatches: batches,
                  csvImportItems: items,
                  message: 'CSV import canceled.',
                  progress:
                    summary.totalItems > 0
                      ? (summary.completedItems + summary.failedItems) /
                        summary.totalItems
                      : 1,
                  status: 'canceled',
                }
              : item,
          ),
        )
        refreshLibrary()
        scheduleCsvImportDismiss(download.id)
      } catch (error) {
        canceledCsvImportIdsRef.current.delete(download.id)
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === download.id
              ? {
                  ...item,
                  canceling: false,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'CSV import could not be canceled.',
                }
              : item,
          ),
        )
        toast({
          title: 'Could not cancel CSV import',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [refreshLibrary, requireOnlineAction, scheduleCsvImportDismiss],
  )

  const retryCsvImport = useCallback(
    async (download: Download) => {
      const batchIds = download.batchIds ?? []

      if (download.retrying || batchIds.length === 0) return
      if (!requireOnlineAction('Reconnect to retry CSV imports.')) return

      canceledCsvImportIdsRef.current.delete(download.id)
      resumedCsvImportIdsRef.current.add(download.id)
      setDownloads((prev) =>
        prev.map((item) =>
          item.id === download.id
            ? {
                ...item,
                artist: 'Retrying CSV import',
                message: undefined,
                retrying: true,
                status: 'downloading',
              }
            : item,
        ),
      )

      try {
        const results = await Promise.all(
          batchIds.map((batchId) => retryCsvImportBatch(batchId)),
        )
        const states = results
          .filter((result) => result.status === 'authenticated' && result.batch)
          .map((result) => ({
            batch: result.batch as CsvImportBatch,
            items: result.items,
          }))
        const retriedItems = results.reduce(
          (total, result) => total + result.retriedItems,
          0,
        )
        const pendingItems = states
          .flatMap((state) => state.items)
          .filter((item) => item.status === 'pending').length

        if (states.length === 0) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === download.id
                ? {
                    ...item,
                    message: 'Sign in again to retry CSV imports.',
                    progress: 1,
                    retrying: false,
                    status: 'error',
                  }
                : item,
            ),
          )
          return
        }

        if (retriedItems === 0 && pendingItems === 0) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === download.id
                ? {
                    ...item,
                    csvImportBatches: states.map((state) => state.batch),
                    csvImportItems: states.flatMap((state) => state.items),
                    message: 'No retryable CSV rows remain.',
                    progress: 1,
                    retrying: false,
                    status: 'error',
                  }
                : item,
            ),
          )
          return
        }

        await monitorCsvImportBatches(download.id, states)
      } catch (error) {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === download.id
              ? {
                  ...item,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'CSV import retry failed.',
                  progress: 1,
                  retrying: false,
                  status: 'error',
                }
              : item,
          ),
        )
      }
    },
    [monitorCsvImportBatches, requireOnlineAction],
  )

  const onSubmitUrl = useCallback(async (rawInput: string) => {
    if (!requireOnlineAction('Reconnect to search external sources.')) return

    setIsDiscoveringLink(true)
    setExternalResults([])
    const id = `link-discovery-${Date.now()}`
    const isUrl = isLikelyYouTubeUrl(rawInput)

    setDownloads((prev) => [
      {
        artist: isUrl ? 'Checking import policy' : 'Searching YouTube',
        id,
        platform: 'youtube',
        progress: 0.45,
        status: 'downloading',
        title: rawInput,
        url: rawInput,
      },
      ...prev,
    ])

    try {
      const result = isUrl
        ? await discoverYouTubeUrl(rawInput)
        : await searchYouTube(rawInput)
      const discoveries = result.discovery?.results ?? []
      const firstDiscovery = discoveries[0]

      setExternalResults(discoveries)

      if (discoveries.length === 0) {
        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  message: 'No YouTube results found.',
                  progress: 1,
                  status: 'error',
                }
              : download,
          ),
        )
        return
      }

      setDownloads((prev) =>
        prev.map((download) =>
          download.id === id
            ? {
                ...download,
                artist: firstDiscovery?.creator ?? 'YouTube',
                message:
                  discoveries.length > 1
                    ? `${discoveries.length} results ready`
                    : firstDiscovery?.eligibility?.message ??
                      'Discovery is ready. Add it to your library when allowed by policy.',
                progress: 1,
                status: 'complete',
                thumbnailUrl: firstDiscovery?.thumbnailUrl ?? download.thumbnailUrl,
                title: firstDiscovery?.title ?? rawInput,
              }
            : download,
        ),
      )
    } catch (error) {
      setDownloads((prev) =>
        prev.map((download) =>
          download.id === id
            ? {
                ...download,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Could not find YouTube results.',
                progress: 1,
                status: 'error',
              }
            : download,
          ),
      )
    } finally {
      setIsDiscoveringLink(false)
    }
  }, [requireOnlineAction])

  const searchCsvManualMatchQuery = useCallback(async (rawInput: string) => {
    if (!requireOnlineAction('Reconnect to search CSV matches.')) return

    setIsDiscoveringLink(true)
    setExternalResults([])

    try {
      const result = isLikelyYouTubeUrl(rawInput)
        ? await discoverYouTubeUrl(rawInput)
        : await searchYouTube(rawInput, 12)
      const discoveries = result.discovery?.results ?? []

      setExternalResults(discoveries)

      if (result.status === 'anonymous') {
        toast({
          title: 'Could not search YouTube',
          description: 'Sign in again to choose a CSV match.',
          variant: 'destructive',
        })
        return
      }

      if (discoveries.length === 0) {
        toast({
          title: 'No YouTube results found',
          description: 'Try editing the search text or paste a direct link.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Could not search YouTube',
        description:
          error instanceof Error ? error.message : 'Try another search.',
        variant: 'destructive',
      })
    } finally {
      setIsDiscoveringLink(false)
    }
  }, [requireOnlineAction])

  const promptCsvManualMatch = useCallback(
    (downloadId: string, item: CsvImportItem) => {
      setCsvManualMatchTarget({ downloadId, item })
      void searchCsvManualMatchQuery(item.searchQuery)
    },
    [searchCsvManualMatchQuery],
  )

  useEffect(() => {
    promptCsvManualMatchRef.current = promptCsvManualMatch
  }, [promptCsvManualMatch])

  const openCsvManualMatch = useCallback(
    (download: Download, item: CsvImportItem) => {
      if (!requireOnlineAction('Reconnect to match CSV rows.')) return

      promptedCsvManualMatchIdsRef.current.add(item.id)
      setAddOpen(true)
      promptCsvManualMatch(download.id, item)
    },
    [promptCsvManualMatch, requireOnlineAction],
  )

  const clearCsvManualMatch = useCallback(() => {
    setCsvManualMatchTarget((current) => {
      if (current) {
        promptedCsvManualMatchIdsRef.current.delete(current.item.id)
      }
      return null
    })
    setExternalResults([])
  }, [])

  const onImportCsvMatch = useCallback(
    async (item: CsvImportItem, result: ExternalDiscoveryResult) => {
      if (!requireOnlineAction('Reconnect to import CSV matches.')) return

      const target = csvManualMatchTarget

      if (!target || target.item.id !== item.id) return

      let matched: Awaited<ReturnType<typeof importCsvImportItemDiscovery>>

      try {
        matched = await importCsvImportItemDiscovery({
          batchId: item.batchId,
          discovery: result,
          itemId: item.id,
        })
      } catch (error) {
        toast({
          title: 'Could not import CSV match',
          description:
            error instanceof Error ? error.message : 'Try another result.',
          variant: 'destructive',
        })
        return
      }

      if (matched.status !== 'authenticated' || !matched.batch) {
        toast({
          title: 'Could not import CSV match',
          description: 'Sign in again and try the match once more.',
          variant: 'destructive',
        })
        return
      }

      const items = csvImportItemsForBatch(
        downloads.find((download) => download.id === target.downloadId)
          ?.csvImportItems,
        matched.batch.id,
        matched.items,
      )
      const batches = [
        ...(downloads
          .find((download) => download.id === target.downloadId)
          ?.csvImportBatches?.filter((batch) => batch.id !== matched.batch.id) ??
          []),
        matched.batch,
      ]
      const summary = summarizeCsvImportStates(
        batches.map((batch) => ({
          batch,
          items: items.filter((csvItem) => csvItem.batchId === batch.id),
        })),
      )

      setDownloads((prev) =>
        prev.map((download) =>
          download.id === target.downloadId
            ? {
                ...download,
                artist: csvImportStatusText(summary),
                csvImportBatches: batches,
                csvImportItems: items,
                message: csvImportMessage(summary),
                progress: csvImportProgress(summary, download.progress),
                status: csvImportDownloadStatus(summary),
              }
            : download,
        ),
      )
      const nextManualMatchItem = nextCsvManualMatchItem(
        batches.map((batch) => ({
          batch,
          items: items.filter((csvItem) => csvItem.batchId === batch.id),
        })),
        promptedCsvManualMatchIdsRef.current,
        item.id,
      )

      if (nextManualMatchItem) {
        promptedCsvManualMatchIdsRef.current.add(nextManualMatchItem.id)
        promptCsvManualMatch(target.downloadId, nextManualMatchItem)
      } else {
        setExternalResults((prev) =>
          prev.filter((discovery) => discovery.sourceId !== result.sourceId),
        )
        setCsvManualMatchTarget(null)
      }
      refreshLibrary()
      setCollection(null)
      setView('library')

      if (shouldDismissCsvImportDownload(summary)) {
        window.setTimeout(() => {
          setDownloads((prev) =>
            prev.filter((download) => download.id !== target.downloadId),
          )
        }, 5000)
      }

      toast({
        title: 'CSV match imported',
        description: `"${item.title}" was added.`,
      })
    },
    [
      csvManualMatchTarget,
      downloads,
      promptCsvManualMatch,
      refreshLibrary,
      requireOnlineAction,
    ],
  )

  const onImportExternalResult = useCallback(
    async (result: ExternalDiscoveryResult) => {
      if (!requireOnlineAction('Reconnect to import from external sources.')) {
        return
      }

      const id = `link-import-${result.sourceId}`
      const initialDownload = {
        artist: result.creator ?? 'YouTube',
        externalSourceId: result.sourceId,
        id,
        message: 'Starting import...',
        platform: 'youtube' as const,
        progress: 0.15,
        status: 'downloading' as const,
        thumbnailUrl: result.thumbnailUrl,
        title: result.title,
        url: result.canonicalUrl,
      }

      setDownloads((prev) => [
        initialDownload,
        ...prev.filter(
          (download) =>
            download.id !== id && download.externalSourceId !== result.sourceId,
        ),
      ])

      try {
        const imported = await importYouTubeDiscovery(result)

        if (imported.status === 'anonymous') {
          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    message: 'Sign in again to import from links.',
                    progress: 1,
                    status: 'error',
                  }
                : download,
            ),
          )
          return
        }

        const importedJob = imported.job

        if (importedJob?.status === 'pending') {
          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    externalImportJobId: importedJob.id,
                    message: 'Importing audio...',
                    progress: 0.3,
                    status: 'downloading',
                  }
              : download,
            ),
          )
          await monitorExternalImport(id, importedJob.id, result.sourceId)
          return
        }

        if (importedJob?.status === 'failed') {
          setDownloads((prev) =>
            prev.map((download) =>
              download.id === id
                ? {
                    ...download,
                    message: externalImportFailureMessage(
                      importedJob.errorCode,
                    ),
                    progress: 1,
                    status: 'error',
                  }
                : download,
            ),
          )
          return
        }

        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  message: imported.alreadyInLibrary
                    ? 'Already in your library'
                    : 'Added to your library',
                  progress: 1,
                  status: 'complete',
                }
              : download,
          ),
        )
        setExternalResults((prev) =>
          prev.filter((discovery) => discovery.sourceId !== result.sourceId),
        )
        refreshLibrary()
        setCollection(null)
        setView('library')
        setTimeout(() => {
          setDownloads((prev) => prev.filter((download) => download.id !== id))
        }, 4000)
      } catch (error) {
        setDownloads((prev) =>
          prev.map((download) =>
            download.id === id
              ? {
                  ...download,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'External import failed.',
                  progress: 1,
                  status: 'error',
                }
              : download,
          ),
        )
      }
    },
    [monitorExternalImport, refreshLibrary, requireOnlineAction],
  )

  const openCollection = useCallback((ref: CollectionRef) => {
    setCollection(ref)
  }, [])

  const goToView = useCallback((nextView: View) => {
    setCollection(null)
    setView(nextView)
  }, [])

  const playSongFromSidebar = useCallback(
    (song: Song) => {
      playSong(
        song,
        [song, ...userSongs.filter((item) => item.id !== song.id)],
        { kind: 'library' },
      )
      setCollection(null)
      setView('library')
      setRevealSongInLibrary({ songId: song.id, nonce: Date.now() })
    },
    [playSong, userSongs],
  )

  const createPlaylistLocally = useCallback(
    (input: { name: string; description: string | null }) => {
      const playlistId = createLocalPlaylistId()
      const nowIso = new Date().toISOString()
      const songToAdd = pendingSongForPlaylist
      const songEntry = songToAdd?.serverSong
        ? [{ ...songToAdd.serverSong, addedAt: nowIso, position: 0 }]
        : []

      cachePlaylistDetail({
        color: null,
        createdAt: nowIso,
        description: input.description,
        id: playlistId,
        name: input.name,
        songCount: songEntry.length,
        songs: songEntry,
        updatedAt: nowIso,
        userId: user?.id,
      })
      enqueuePendingMutation({
        description: input.description,
        kind: 'playlist-create',
        name: input.name,
        playlistId,
      })

      if (songToAdd?.serverSong) {
        enqueuePendingMutation({
          kind: 'playlist-add-song',
          playlistId,
          songId: songToAdd.id,
        })
      }

      setPendingSongForPlaylist(null)
      toast({
        title: 'Playlist created',
        description: songToAdd
          ? `${input.name} with "${songToAdd.title}" is saved on this device and will sync when you reconnect.`
          : `${input.name} is saved on this device and will sync when you reconnect.`,
      })
      setCollection({ id: playlistId, kind: 'playlist' })
      setView('library')
    },
    [
      cachePlaylistDetail,
      enqueuePendingMutation,
      pendingSongForPlaylist,
      user?.id,
    ],
  )

  const handleCreatePlaylistSubmit = useCallback(
    async (input: { name: string; description: string | null }) => {
      if (!isOnline) {
        createPlaylistLocally(input)
        return
      }

      try {
        const result = await createPlaylist(input)

        if (result.status === 'anonymous' || !result.playlist) {
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the playlist was saved.',
            variant: 'destructive',
          })
          return
        }

        const newPlaylist = result.playlist
        const songToAdd = pendingSongForPlaylist
        let playlistToCache = newPlaylist
        setPendingSongForPlaylist(null)

        if (songToAdd) {
          try {
            const addResult = await addSongToPlaylist(
              newPlaylist.id,
              songToAdd.id,
            )

            if (addResult.status !== 'authenticated' || !addResult.playlist) {
              throw new Error('Song could not be added to the playlist.')
            }

            playlistToCache = addResult.playlist
            toast({
              title: 'Playlist created',
              description: `Added "${songToAdd.title}" to ${newPlaylist.name}.`,
            })
          } catch {
            toast({
              title: 'Playlist created',
              description: `${newPlaylist.name} is ready, but the song could not be added.`,
              variant: 'destructive',
            })
          }
        } else {
          toast({
            title: 'Playlist created',
            description: `${newPlaylist.name} is ready for songs.`,
          })
        }

        cachePlaylistDetail(playlistToCache)
        setCollection({ kind: 'playlist', id: newPlaylist.id })
        setView('library')
      } catch (error) {
        if (isOfflineSyncError(error)) {
          createPlaylistLocally(input)
          return
        }

        toast({
          title: 'Could not create playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
        throw error
      }
    },
    [
      cachePlaylistDetail,
      createPlaylistLocally,
      isOnline,
      pendingSongForPlaylist,
    ],
  )

  // Applies an add locally when we have a detail that is already what the
  // user sees (an override, or the snapshot in offline-only mode). Otherwise
  // the queued mutation alone carries the change to the server later.
  const applyLocalPlaylistAddition = useCallback(
    (playlistId: string, song: Song) => {
      const serverSong = song.serverSong

      if (!serverSong) return 'unsupported' as const

      const detail =
        playlistDetailOverrides[playlistId] ??
        (offlineOnlyMode
          ? offlineLibrarySnapshot?.playlistDetails.find(
              (playlist) => playlist.id === playlistId,
            )
          : undefined)

      if (!detail) return 'queued' as const

      const removedSongIds = new Set(playlistSongRemovals[playlistId] ?? [])
      const baseSongs = detail.songs.filter(
        (entry) => !removedSongIds.has(entry.id),
      )

      if (baseSongs.some((entry) => entry.id === song.id)) {
        return 'duplicate' as const
      }

      const addedAt = new Date().toISOString()

      cachePlaylistDetail({
        ...detail,
        songCount: baseSongs.length + 1,
        songs: [
          ...baseSongs,
          { ...serverSong, addedAt, position: baseSongs.length },
        ],
        updatedAt: addedAt,
      })

      return 'applied' as const
    },
    [
      cachePlaylistDetail,
      offlineLibrarySnapshot,
      offlineOnlyMode,
      playlistDetailOverrides,
      playlistSongRemovals,
    ],
  )

  const queuePlaylistAddition = useCallback(
    (song: Song, playlistId: string) => {
      if (!song.serverSong) return

      const playlistName =
        playlists.find((playlist) => playlist.id === playlistId)?.name ??
        'playlist'
      const outcome = applyLocalPlaylistAddition(playlistId, song)

      if (outcome === 'duplicate') {
        toast({
          title: 'Already in playlist',
          description: `"${song.title}" is already in ${playlistName}.`,
        })
        return
      }

      enqueuePendingMutation({
        kind: 'playlist-add-song',
        playlistId,
        songId: song.id,
      })
      toast({
        title: 'Added to playlist',
        description: `"${song.title}" will sync to ${playlistName} when you reconnect.`,
      })
    },
    [applyLocalPlaylistAddition, enqueuePendingMutation, playlists],
  )

  const handleAddSongToPlaylist = useCallback(
    async (song: Song, playlistId: string) => {
      // Playlists created offline live only on this device until the queue
      // syncs, so additions to them must queue behind the pending create.
      if (!isOnline || isLocalPlaylistId(playlistId)) {
        queuePlaylistAddition(song, playlistId)
        return
      }

      try {
        const result = await addSongToPlaylist(playlistId, song.id)
        const playlistName =
          result.playlist?.name ??
          playlists.find((playlist) => playlist.id === playlistId)?.name ??
          'playlist'

        if (result.status === 'anonymous') {
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the song was added.',
            variant: 'destructive',
          })
          return
        }

        if (result.status === 'not-found') {
          toast({
            title: 'Could not add to playlist',
            description: 'The playlist or song was not found.',
            variant: 'destructive',
          })
          return
        }

        if (result.status === 'duplicate') {
          toast({
            title: 'Already in playlist',
            description: `"${song.title}" is already in ${playlistName}.`,
          })
          return
        }

        if (result.playlist) {
          cachePlaylistDetail(result.playlist)
        }

        toast({
          title: 'Added to playlist',
          description: `"${song.title}" added to ${playlistName}.`,
        })
      } catch (error) {
        if (isOfflineSyncError(error)) {
          queuePlaylistAddition(song, playlistId)
          return
        }

        toast({
          title: 'Could not add to playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [cachePlaylistDetail, isOnline, playlists, queuePlaylistAddition],
  )

  const queuePlaylistRemoval = useCallback(
    (playlistId: string, song: Song) => {
      hideSongFromPlaylist(playlistId, song.id)
      enqueuePendingMutation({
        kind: 'playlist-remove-song',
        playlistId,
        songId: song.id,
      })
      toast({
        title: 'Removed from playlist',
        description: `"${song.title}" will be removed on the server when you reconnect.`,
      })
    },
    [enqueuePendingMutation, hideSongFromPlaylist],
  )

  const handleRemoveSongFromPlaylist = useCallback(
    async (playlistId: string, song: Song) => {
      if (!isOnline || isLocalPlaylistId(playlistId)) {
        queuePlaylistRemoval(playlistId, song)
        return
      }

      try {
        const result = await removeSongFromPlaylist(playlistId, song.id)

        if (result.status === 'anonymous') {
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the song was removed.',
            variant: 'destructive',
          })
          return
        }

        if (result.status === 'not-found') {
          toast({
            title: 'Could not remove from playlist',
            description: 'The playlist was not found.',
            variant: 'destructive',
          })
          return
        }

        hideSongFromPlaylist(playlistId, song.id)
        toast({
          title: 'Removed from playlist',
          description: `"${song.title}" was removed.`,
        })
      } catch (error) {
        if (isOfflineSyncError(error)) {
          queuePlaylistRemoval(playlistId, song)
          return
        }

        toast({
          title: 'Could not remove from playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [hideSongFromPlaylist, isOnline, queuePlaylistRemoval],
  )

  const updatePlaylistLocally = useCallback(
    (target: ServerPlaylistDetail, input: { name: string; description: string | null }) => {
      cachePlaylistDetail({
        ...target,
        description: input.description,
        name: input.name,
        updatedAt: new Date().toISOString(),
      })
      enqueuePendingMutation({
        description: input.description,
        kind: 'playlist-update',
        name: input.name,
        playlistId: target.id,
      })
      toast({
        title: 'Playlist updated',
        description: `${input.name} is saved on this device and will sync when you reconnect.`,
      })
    },
    [cachePlaylistDetail, enqueuePendingMutation],
  )

  const handleEditPlaylistSubmit = useCallback(
    async (input: { name: string; description: string | null }) => {
      const target = editingPlaylist
      if (!target) return

      if (!isOnline || isLocalPlaylistId(target.id)) {
        updatePlaylistLocally(target, input)
        return
      }

      try {
        const result = await updatePlaylist(target.id, input)

        if (result.status === 'anonymous' || result.status === 'not-found') {
          toast({
            title: 'Could not save changes',
            description:
              result.status === 'anonymous'
                ? 'Your session expired.'
                : 'Playlist not found.',
            variant: 'destructive',
          })
          return
        }

        toast({
          title: 'Playlist updated',
          description: `${input.name} saved.`,
        })
        if (result.playlist) {
          cachePlaylistDetail(result.playlist)
        }
      } catch (error) {
        if (isOfflineSyncError(error)) {
          updatePlaylistLocally(target, input)
          return
        }

        toast({
          title: 'Could not save changes',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
        throw error
      }
    },
    [cachePlaylistDetail, editingPlaylist, isOnline, updatePlaylistLocally],
  )

  const removePlaylistFromLocalState = useCallback((playlistId: string) => {
    setLocallyDeletedPlaylistIds((current) => {
      const next = new Set(current)
      next.add(playlistId)
      return next
    })
    setPlaylistDetailOverrides((current) => {
      if (!(playlistId in current)) return current

      const next = { ...current }
      delete next[playlistId]
      return next
    })
    setPlaylistSongRemovals((current) => {
      if (!(playlistId in current)) return current

      const next = { ...current }
      delete next[playlistId]
      return next
    })
    setCollection((current) =>
      current?.kind === 'playlist' && current.id === playlistId
        ? null
        : current,
    )
  }, [])

  const deletePlaylistLocally = useCallback(
    (playlist: ServerPlaylist) => {
      enqueuePendingMutation({ kind: 'playlist-delete', playlistId: playlist.id })
      removePlaylistFromLocalState(playlist.id)
      toast({
        title: 'Playlist deleted',
        description: isLocalPlaylistId(playlist.id)
          ? `${playlist.name} was removed.`
          : `${playlist.name} will be removed on the server when you reconnect.`,
      })
    },
    [enqueuePendingMutation, removePlaylistFromLocalState],
  )

  const handleDeletePlaylist = useCallback(
    async (playlist: ServerPlaylist) => {
      if (!isOnline || isLocalPlaylistId(playlist.id)) {
        deletePlaylistLocally(playlist)
        return
      }

      try {
        const result = await deletePlaylist(playlist.id)

        if (result.status === 'anonymous') {
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the playlist was removed.',
            variant: 'destructive',
          })
          return
        }

        toast({
          title: 'Playlist deleted',
          description: `${playlist.name} was removed.`,
        })
        removePlaylistFromLocalState(playlist.id)
      } catch (error) {
        if (isOfflineSyncError(error)) {
          deletePlaylistLocally(playlist)
          return
        }

        toast({
          title: 'Could not delete playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [deletePlaylistLocally, isOnline, removePlaylistFromLocalState],
  )

  const openCreatePlaylist = useCallback(() => {
    setPendingSongForPlaylist(null)
    setCreatePlaylistOpen(true)
  }, [])

  const openCreatePlaylistWithSong = useCallback((song: Song) => {
    setPendingSongForPlaylist(song)
    setCreatePlaylistOpen(true)
  }, [])

  const openEditPlaylist = useCallback((playlist: ServerPlaylistDetail) => {
    setEditingPlaylist(playlist)
  }, [])

  return (
    <div className="safe-x flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          setView={goToView}
          songs={userSongs}
          playlists={playlists}
          likedCount={likedAwareSummary.counts.likedSongs}
          isAdmin={Boolean(user?.isAdmin)}
          onImportClick={openAddMusic}
          onCreatePlaylistClick={openCreatePlaylist}
          onOpenCollection={openCollection}
          onDeletePlaylist={handleDeletePlaylist}
          onPlaySong={playSongFromSidebar}
          activeCollectionId={activeCollectionId}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col rounded-none md:m-2 md:ml-0 md:rounded-xl md:border md:border-border/40 md:bg-card/30 md:backdrop-blur">
          <header className="safe-top-3 flex items-center justify-between gap-3 px-4 pb-3 md:hidden">
            <BrandLockup />
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={openAddMusic}
                aria-label="Add music"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </header>

          <div className="hidden items-center justify-between px-6 pt-4 pb-2 md:flex">
            <BrandLockup />
            <div className="flex items-center gap-2">
              <Button
                onClick={openAddMusic}
                className="h-9 rounded-full bg-foreground px-4 text-background shadow-sm transition-transform hover:bg-foreground/90 hover:scale-[1.02] active:scale-100"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add music
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => goToView('settings')}
                aria-label="Settings"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            <div
              key={
                collection
                  ? `collection:${collection.kind}:${collection.id}`
                  : view
              }
              className="ov-view-enter"
            >
              {collection ? (
                <CollectionView
                  collection={collection}
                  songs={userSongs}
                  summary={likedAwareSummary}
                  playlists={playlists}
                  playlistDetails={playlistDetails}
                  playlistSongRemovals={playlistSongRemovals}
                  hiddenSongIds={locallyDeletedSongIds}
                  currentSongId={currentSongId}
                  isPlaying={isPlaying}
                  offlineAudio={offlineAudio}
                  revision={revision}
                  onBack={() => setCollection(null)}
                  onPlay={(song, nextQueue) =>
                    playSong(song, nextQueue, derivePlayingFromLabel())
                  }
                  onPlayAll={(songs, shuffle) =>
                    playCollection(songs, shuffle, derivePlayingFromLabel())
                  }
                  onToggleCollectionOffline={toggleCollectionOffline}
                  onToggleSongLike={toggleSongLike}
                  onToggleSongOffline={toggleSongOffline}
                  onDeleteSong={deleteSongFromLibrary}
                  onAddSongToPlaylist={handleAddSongToPlaylist}
                  onCreatePlaylistWithSong={openCreatePlaylistWithSong}
                  onRemoveSongFromPlaylist={handleRemoveSongFromPlaylist}
                  onEditPlaylist={openEditPlaylist}
                  onDeletePlaylist={handleDeletePlaylist}
                  deletingSongId={deletingSongId}
                  likingSongId={likingSongId}
                />
              ) : view === 'home' ? (
                <HomeView
                  songs={userSongs}
                  libraryStatus={libraryStatus}
                  playlists={playlists}
                  summary={likedAwareSummary}
                  onPlay={(song) =>
                    playSong(
                      song,
                      [song, ...userSongs.filter((item) => item.id !== song.id)],
                      { kind: 'home' },
                    )
                  }
                  onImportClick={openAddMusic}
                  onOpenCollection={openCollection}
                />
              ) : view === 'library' ? (
                <LibraryView
                  songs={userSongs}
                  libraryStatus={libraryStatus}
                  playlists={playlists}
                  likedCount={likedAwareSummary.counts.likedSongs}
                  currentSongId={currentSongId}
                  isPlaying={isPlaying}
                  offlineAudio={offlineAudio}
                  onPlay={(song) =>
                    playSong(
                      song,
                      [song, ...userSongs.filter((item) => item.id !== song.id)],
                      { kind: 'library' },
                    )
                  }
                  onToggleSongLike={toggleSongLike}
                  onToggleSongOffline={toggleSongOffline}
                  onDeleteSong={deleteSongFromLibrary}
                  onAddSongToPlaylist={handleAddSongToPlaylist}
                  onCreatePlaylistWithSong={openCreatePlaylistWithSong}
                  onCreatePlaylistClick={openCreatePlaylist}
                  onDeletePlaylist={handleDeletePlaylist}
                  deletingSongId={deletingSongId}
                  likingSongId={likingSongId}
                  onImportClick={openAddMusic}
                  onOpenCollection={openCollection}
                  revealSong={revealSongInLibrary}
                />
              ) : view === 'settings' ? (
                <SettingsView
                  offlineAudio={offlineAudio}
                  pendingSyncCount={pendingSyncCount}
                  songs={userSongs}
                  syncState={librarySync}
                  onSignedOut={() => setView('home')}
                  onSyncLibraryOffline={syncLibraryToDevice}
                  onSyncPendingChanges={() => void flushOfflineMutations()}
                  onOpenAdmin={user?.isAdmin ? goToView : undefined}
                />
              ) : view === 'admin' && user?.isAdmin ? (
                <AdminView songs={userSongs} onTracksWiped={handleTracksWiped} />
              ) : (
                <SearchView
                  songs={userSongs}
                  playlists={playlists}
                  currentSongId={currentSongId}
                  isPlaying={isPlaying}
                  offlineAudio={offlineAudio}
                  libraryStatus={libraryStatus}
                  revision={revision}
                  onPlay={(song, nextQueue) =>
                    playSong(song, nextQueue, { kind: 'search' })
                  }
                  onToggleSongLike={toggleSongLike}
                  onToggleSongOffline={toggleSongOffline}
                  onDeleteSong={deleteSongFromLibrary}
                  onAddSongToPlaylist={handleAddSongToPlaylist}
                  onCreatePlaylistWithSong={openCreatePlaylistWithSong}
                  deletingSongId={deletingSongId}
                  likingSongId={likingSongId}
                  onOpenCollection={openCollection}
                  onImportClick={openAddMusic}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      <div className="shrink-0">
        <PlayerBar
          song={currentSong}
          isPlaying={isPlaying}
          volume={volume}
          muted={muted}
          shuffleEnabled={shuffleEnabled}
          repeatMode={repeatMode}
          onTogglePlay={togglePlay}
          onToggleShuffle={toggleShuffle}
          onCycleRepeat={cycleRepeat}
          onToggleLike={
            currentSong ? () => toggleSongLike(currentSong) : undefined
          }
          onSeek={seek}
          onPrev={playPrev}
          onNext={playNext}
          onVolumeChange={(nextVolume) => {
            setVolume(nextVolume)
            if (nextVolume > 0 && muted) setMuted(false)
          }}
          onToggleMute={() => setMuted((value) => !value)}
          onExpand={() => setShowNowPlaying(true)}
          onShowQueue={() => setShowQueue(true)}
          isLikePending={currentSong ? likingSongId === currentSong.id : false}
        />
        <MobileNav view={view} setView={goToView} />
      </div>

      <NowPlaying
        open={showNowPlaying}
        song={currentSong}
        isPlaying={isPlaying}
        shuffleEnabled={shuffleEnabled}
        repeatMode={repeatMode}
        playingFromLabel={playingFromLabel}
        queue={queue}
        currentSongId={currentSongId}
        showQueue={showQueue}
        onShowQueue={() => setShowQueue(true)}
        onCloseQueue={() => setShowQueue(false)}
        onClose={() => setShowNowPlaying(false)}
        onTogglePlay={togglePlay}
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={cycleRepeat}
        onToggleLike={
          currentSong ? () => toggleSongLike(currentSong) : undefined
        }
        onSeek={seek}
        onPrev={playPrev}
        onNext={playNext}
        onSelectQueueItem={(song) => {
          playSong(song, queue, playingFromLabel ?? undefined, {
            preserveQueueOrder: true,
          })
        }}
        onRemoveFromQueue={removeFromQueue}
        isLikePending={currentSong ? likingSongId === currentSong.id : false}
      />

      <AddMusicDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) {
            clearCsvManualMatch()
          }
        }}
        downloads={downloads}
        externalResults={externalResults}
        isDiscoveringLink={isDiscoveringLink}
        manualMatchItem={csvManualMatchTarget?.item ?? null}
        onCancelImport={cancelCsvImport}
        onClearManualMatch={clearCsvManualMatch}
        onCsvFilesSelected={onCsvFilesSelected}
        onFilesSelected={onFilesSelected}
        onImportCsvMatch={onImportCsvMatch}
        onImportExternalResult={onImportExternalResult}
        onMatchCsvImportItem={openCsvManualMatch}
        onRetryCsvImport={retryCsvImport}
        onSubmitUrl={
          csvManualMatchTarget ? searchCsvManualMatchQuery : onSubmitUrl
        }
      />

      <CsvImportStatusToast
        avoidPlayerBar={Boolean(currentSong)}
        downloads={downloads}
        hidden={addOpen || isCsvImportToastDismissed}
        onCancelImport={cancelCsvImport}
        onDismiss={dismissCsvImportToast}
        onMatchCsvImportItem={openCsvManualMatch}
        onOpenImports={() => setAddOpen(true)}
        onRetryCsvImport={retryCsvImport}
      />

      <CreatePlaylistDialog
        open={createPlaylistOpen}
        onOpenChange={(open) => {
          setCreatePlaylistOpen(open)
          if (!open) {
            setPendingSongForPlaylist(null)
          }
        }}
        onCreate={handleCreatePlaylistSubmit}
      />

      <EditPlaylistDialog
        key={editingPlaylist?.id ?? 'edit-playlist'}
        open={editingPlaylist !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPlaylist(null)
        }}
        initialName={editingPlaylist?.name ?? ''}
        initialDescription={editingPlaylist?.description ?? null}
        onSave={handleEditPlaylistSubmit}
      />

      <audio ref={audioRef} preload="metadata" />
    </div>
  )
}

function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <OnVibeLogo className="h-8 w-8 rounded-lg shadow-md shadow-primary/15" />
      <span className="text-base font-bold tracking-tight md:text-lg">
        OnVibe
      </span>
    </div>
  )
}
