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
  fetchCsvImportBatch,
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
  type CollectionRef,
  type Song,
  type View,
} from '@/lib/music-types'

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
const OFFLINE_DOWNLOAD_CONCURRENCY = 3
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
    (download.status === 'downloading' || download.status === 'error') &&
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
    userMatchItems: items.filter((item) => item.userMatchRequired).length,
  }
}

function csvImportStatusText(summary: ReturnType<typeof summarizeCsvImportStates>) {
  if (summary.isRunning && summary.failedItems > 0) {
    return summary.failedItems === 1
      ? `${summary.completedItems} done, 1 row needs attention`
      : `${summary.completedItems} done, ${summary.failedItems} rows need attention`
  }

  if (!summary.isRunning && summary.pendingItems > 0) {
    return `${summary.completedItems} done, ${summary.failedItems} failed, ${summary.pendingItems} paused`
  }

  return `${summary.completedItems} done, ${summary.failedItems} failed`
}

function csvImportActiveMessage(summary: ReturnType<typeof summarizeCsvImportStates>) {
  if (!summary.isRunning || summary.userMatchItems === 0) {
    return undefined
  }

  return summary.userMatchItems === 1
    ? '1 row needs a match; import is still running'
    : `${summary.userMatchItems} rows need matches; import is still running`
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
  const [storedNavigation] = useState(readStoredNavigation)
  const [view, setView] = useState<View>(storedNavigation.view)
  const [collection, setCollection] = useState<CollectionRef | null>(
    storedNavigation.collection,
  )
  const [queue, setQueue] = useState<Song[]>([])
  const [currentSongId, setCurrentSongId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
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
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null)
  const [likingSongId, setLikingSongId] = useState<string | null>(null)
  const [likedOverrides, setLikedOverrides] = useState<Record<string, boolean>>(
    {},
  )
  const [locallyDeletedSongIds, setLocallyDeletedSongIds] = useState<Set<string>>(
    () => new Set(),
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

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaLoadIdRef = useRef(0)
  const playNextRef = useRef<() => void>(() => undefined)
  const repeatModeRef = useRef<RepeatMode>(repeatMode)
  const canceledCsvImportIdsRef = useRef<Set<string>>(new Set())
  const csvImportDismissTimeoutsRef = useRef<Map<string, number>>(new Map())
  const promptedCsvManualMatchIdsRef = useRef<Set<string>>(new Set())
  const resumedCsvImportIdsRef = useRef<Set<string>>(new Set())
  const activeCsvManualMatchItemIdRef = useRef<string | null>(null)
  const promptCsvManualMatchRef = useRef<
    (downloadId: string, item: CsvImportItem) => void
  >(() => undefined)
  const activeSongIdsRef = useRef<Set<string>>(new Set())
  const wasOnlineRef = useRef(isOnline)

  const reloadOfflineServerSongs = useCallback(async () => {
    try {
      setOfflineServerSongs(await getOfflineAudioServerSongs())
    } catch {
      setOfflineServerSongs([])
    }
  }, [])

  const offlineOnlyMode =
    songsState.status !== 'loading' &&
    songsState.status !== 'authenticated' &&
    offlineServerSongs.length > 0

  const activeServerSongs = offlineOnlyMode ? offlineServerSongs : songsState.songs

  const serverSongs = useMemo(
    () =>
      activeServerSongs.map((song) =>
        likedOverrides[song.id] === undefined
          ? song
          : { ...song, liked: likedOverrides[song.id] },
      ),
    [activeServerSongs, likedOverrides],
  )
  const likedAwareSummary = useMemo(() => {
    if (songsState.status === 'authenticated' || offlineOnlyMode) {
      const likedSongs = serverSongs.filter((song) => song.liked)

      return {
        ...library.summary,
        counts: {
          ...library.summary.counts,
          likedSongs: likedSongs.length,
          playlists: offlineOnlyMode ? 0 : library.summary.counts.playlists,
          songs: serverSongs.length,
        },
        isEmpty: serverSongs.length === 0,
        likedSongs,
        playlists: offlineOnlyMode ? [] : library.summary.playlists,
        recentSongs: offlineOnlyMode
          ? serverSongs.slice(0, 6)
          : library.summary.recentSongs,
      }
    }

    return {
      ...library.summary,
      likedSongs: library.summary.likedSongs.map((song) =>
        likedOverrides[song.id] === undefined
          ? song
          : { ...song, liked: likedOverrides[song.id] },
      ),
    }
  }, [
    library.summary,
    likedOverrides,
    offlineOnlyMode,
    serverSongs,
    songsState.status,
  ])
  const userSongs = useMemo(
    () =>
      serverSongs
        .map(serverSongToSong)
        .filter((song) => !locallyDeletedSongIds.has(song.id)),
    [locallyDeletedSongIds, serverSongs],
  )
  const playlists = likedAwareSummary.playlists
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
  const openAddMusic = useCallback(() => {
    if (!requireOnlineAction('Reconnect to add or import music.')) return
    setAddOpen(true)
  }, [requireOnlineAction])

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

    const onTime = () => setProgress(audio.currentTime)
    const onLoaded = () => setDuration(audio.duration || currentSong?.duration || 0)
    const onEnded = () => {
      if (repeatModeRef.current === 'one') {
        const a = audioRef.current
        if (a) {
          a.currentTime = 0
          a.play().catch(() => undefined)
        }
        return
      }
      playNextRef.current()
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('durationchange', onLoaded)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('durationchange', onLoaded)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [currentSong?.duration])

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
    const audio = audioRef.current
    if (!audio) return

    const loadId = mediaLoadIdRef.current + 1
    mediaLoadIdRef.current = loadId

    if (!currentSong) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      setProgress(0)
      setDuration(0)
      return
    }

    let disposed = false
    let objectUrl: string | null = null
    const songToLoad = currentSong
    const shouldAutoplay = isPlaying

    const loadSong = async () => {
      setProgress(0)
      setDuration(songToLoad.duration || 0)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()

      try {
        const offlineBlob = await getOfflineAudioBlob(songToLoad)

        if (disposed || mediaLoadIdRef.current !== loadId) return

        if (offlineBlob) {
          objectUrl = URL.createObjectURL(offlineBlob)
          audio.removeAttribute('crossorigin')
          audio.src = objectUrl
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
      if (objectUrl) URL.revokeObjectURL(objectUrl)
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
      updatePlaybackState({
        positionMs: 0,
        repeatMode,
        shuffleEnabled,
        songId: song.id,
      }).catch(() => undefined)

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
    [currentSongId, repeatMode, shuffleEnabled],
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

  const playNext = useCallback(() => {
    const list = queue.length > 0 ? queue : userSongs
    if (list.length === 0) return
    const idx = list.findIndex((song) => song.id === currentSongId)
    if (idx === -1) return
    const isLast = idx === list.length - 1
    if (isLast && repeatMode === 'off') {
      // Stop at the end of the queue when repeat is off.
      audioRef.current?.pause()
      return
    }
    const next = list[(idx + 1) % list.length]
    if (next) playSong(next, list, undefined, { preserveQueueOrder: true })
  }, [currentSongId, playSong, queue, repeatMode, userSongs])

  useEffect(() => {
    playNextRef.current = playNext
  }, [playNext])

  const playPrev = useCallback(() => {
    const list = queue.length > 0 ? queue : userSongs
    if (list.length === 0) return
    const audio = audioRef.current

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }

    const idx = list.findIndex((song) => song.id === currentSongId)
    const prev = list[(idx - 1 + list.length) % list.length]
    if (prev) playSong(prev, list, undefined, { preserveQueueOrder: true })
  }, [currentSongId, playSong, queue, userSongs])

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
    setProgress(value)
  }, [])

  const refreshLibrary = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    const wasOnline = wasOnlineRef.current

    wasOnlineRef.current = isOnline

    if (!wasOnline && isOnline) {
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
        setProgress(0)
        setDuration(0)
        updatePlaybackState({
          positionMs: 0,
          repeatMode: 'off',
          shuffleEnabled: false,
          songId: null,
        }).catch(() => undefined)
      }

      setLibrarySync({
        completed: 0,
        failed: 0,
        status: 'idle',
        total: 0,
      })
    },
    [currentSongId, reloadOfflineServerSongs],
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
        removeSongsFromDeviceState([message.songId])
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

  const deleteSongFromLibrary = useCallback(
    async (song: Song) => {
      if (deletingSongId) return
      if (!requireOnlineAction('Reconnect to remove songs from your library.')) {
        return
      }

      setDeletingSongId(song.id)

      try {
        const result = await deleteSong(song.id)

        if (result.status === 'anonymous') {
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the song could be removed.',
            variant: 'destructive',
          })
          return
        }

        removeSongsFromDeviceState([song.id])
        refreshLibrary()
        toast({
          title:
            result.status === 'not-found'
              ? 'Song already removed'
              : 'Removed from your library',
          description: 'Any local offline copy was removed too.',
        })
      } catch (error) {
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
      deletingSongId,
      refreshLibrary,
      removeSongsFromDeviceState,
      requireOnlineAction,
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
      if (!requireOnlineAction('Reconnect to update Liked Songs.')) return

      const wasLiked = songLiked(song)
      const nextLiked = !wasLiked

      setLikingSongId(song.id)
      setLikedOverrides((current) => ({ ...current, [song.id]: nextLiked }))
      setQueue((current) =>
        current.map((item) =>
          item.id === song.id ? applyLikedToSong(item, nextLiked) : item,
        ),
      )

      try {
        const result = nextLiked
          ? await likeSong(song.id)
          : await unlikeSong(song.id)

        if (result.status === 'anonymous') {
          setLikedOverrides((current) => ({ ...current, [song.id]: wasLiked }))
          setQueue((current) =>
            current.map((item) =>
              item.id === song.id ? applyLikedToSong(item, wasLiked) : item,
            ),
          )
          toast({
            title: 'Sign in again',
            description: 'Your session expired before the song could be updated.',
            variant: 'destructive',
          })
          return
        }

        if (result.status === 'not-found') {
          setLikedOverrides((current) => ({ ...current, [song.id]: wasLiked }))
          setQueue((current) =>
            current.map((item) =>
              item.id === song.id ? applyLikedToSong(item, wasLiked) : item,
            ),
          )
          toast({
            title: 'Song not found',
            description: 'This song may have already been removed.',
            variant: 'destructive',
          })
          refreshLibrary()
          return
        }

        refreshLibrary()
        toast({
          title: nextLiked ? 'Added to Liked Songs' : 'Removed from Liked Songs',
          description: `"${song.title}" ${
            nextLiked ? 'is now in' : 'left'
          } your Liked Songs.`,
        })
      } catch (error) {
        setLikedOverrides((current) => ({ ...current, [song.id]: wasLiked }))
        setQueue((current) =>
          current.map((item) =>
            item.id === song.id ? applyLikedToSong(item, wasLiked) : item,
          ),
        )
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
    [likingSongId, refreshLibrary, requireOnlineAction],
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
              const next = await fetchCsvImportBatch(state.batch.id)

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
          if (state.items.length > 0) {
            return state
          }

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

      if (summary.failedItems === 0) {
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
    setCsvManualMatchTarget(null)
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

      if (summary.failedItems === 0) {
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

      const id = `link-import-${result.sourceId}-${Date.now()}`

      setDownloads((prev) => [
        {
          artist: result.creator ?? 'YouTube',
          id,
          platform: 'youtube',
          progress: 0.65,
          status: 'downloading',
          thumbnailUrl: result.thumbnailUrl,
          title: result.title,
          url: result.canonicalUrl,
        },
        ...prev,
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
    [refreshLibrary, requireOnlineAction],
  )

  const openCollection = useCallback((ref: CollectionRef) => {
    setCollection(ref)
  }, [])

  const goToView = useCallback((nextView: View) => {
    setCollection(null)
    setView(nextView)
  }, [])

  const handleCreatePlaylistSubmit = useCallback(
    async (input: { name: string; description: string | null }) => {
      if (!requireOnlineAction('Reconnect to create playlists.')) return

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
        setPendingSongForPlaylist(null)

        if (songToAdd) {
          try {
            await addSongToPlaylist(newPlaylist.id, songToAdd.id)
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

        refreshLibrary()
        setCollection({ kind: 'playlist', id: newPlaylist.id })
        setView('library')
      } catch (error) {
        toast({
          title: 'Could not create playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
        throw error
      }
    },
    [pendingSongForPlaylist, refreshLibrary, requireOnlineAction],
  )

  const handleAddSongToPlaylist = useCallback(
    async (song: Song, playlistId: string) => {
      if (!requireOnlineAction('Reconnect to update playlists.')) return

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

        toast({
          title: 'Added to playlist',
          description: `"${song.title}" added to ${playlistName}.`,
        })
        refreshLibrary()
      } catch (error) {
        toast({
          title: 'Could not add to playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [playlists, refreshLibrary, requireOnlineAction],
  )

  const handleRemoveSongFromPlaylist = useCallback(
    async (playlistId: string, song: Song) => {
      if (!requireOnlineAction('Reconnect to update playlists.')) return

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

        toast({
          title: 'Removed from playlist',
          description: `"${song.title}" was removed.`,
        })
        refreshLibrary()
      } catch (error) {
        toast({
          title: 'Could not remove from playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [refreshLibrary, requireOnlineAction],
  )

  const handleEditPlaylistSubmit = useCallback(
    async (input: { name: string; description: string | null }) => {
      const target = editingPlaylist
      if (!target) return
      if (!requireOnlineAction('Reconnect to edit playlists.')) return

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
        refreshLibrary()
      } catch (error) {
        toast({
          title: 'Could not save changes',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
        throw error
      }
    },
    [editingPlaylist, refreshLibrary, requireOnlineAction],
  )

  const handleDeletePlaylist = useCallback(
    async (playlist: ServerPlaylist) => {
      if (!requireOnlineAction('Reconnect to delete playlists.')) return

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
        setCollection((current) =>
          current?.kind === 'playlist' && current.id === playlist.id
            ? null
            : current,
        )
        refreshLibrary()
      } catch (error) {
        toast({
          title: 'Could not delete playlist',
          description:
            error instanceof Error ? error.message : 'Try again in a moment.',
          variant: 'destructive',
        })
      }
    },
    [refreshLibrary, requireOnlineAction],
  )

  const openCreatePlaylist = useCallback(() => {
    if (!requireOnlineAction('Reconnect to create playlists.')) return

    setPendingSongForPlaylist(null)
    setCreatePlaylistOpen(true)
  }, [requireOnlineAction])

  const openCreatePlaylistWithSong = useCallback((song: Song) => {
    if (!requireOnlineAction('Reconnect to create playlists.')) return

    setPendingSongForPlaylist(song)
    setCreatePlaylistOpen(true)
  }, [requireOnlineAction])

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
            {collection ? (
              <CollectionView
                collection={collection}
                songs={userSongs}
                summary={likedAwareSummary}
                playlists={playlists}
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
              />
            ) : view === 'settings' ? (
              <SettingsView
                offlineAudio={offlineAudio}
                songs={userSongs}
                syncState={librarySync}
                onSignedOut={() => setView('home')}
                onSyncLibraryOffline={syncLibraryToDevice}
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
        </main>
      </div>

      <div className="shrink-0">
        <PlayerBar
          song={currentSong}
          isPlaying={isPlaying}
          progress={progress}
          duration={duration}
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
        progress={progress}
        duration={duration}
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
        hidden={addOpen}
        onCancelImport={cancelCsvImport}
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
