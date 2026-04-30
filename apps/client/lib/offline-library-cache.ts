'use client'

import type {
  LibrarySummary,
  ServerPlaylist,
  ServerPlaylistDetail,
  ServerSong,
} from '@/lib/api'

const DB_NAME = 'onvibe-offline-library'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const SNAPSHOT_KEY = 'latest'

type OfflineLibrarySnapshotRecord = OfflineLibrarySnapshot & {
  key: typeof SNAPSHOT_KEY
}

export type OfflineLibrarySnapshot = {
  playlistDetails: ServerPlaylistDetail[]
  storedAt: number
  summary: LibrarySummary
}

let dbPromise: Promise<IDBDatabase> | null = null

export async function cacheOfflineLibrarySnapshot(
  summary: LibrarySummary,
  playlistDetails: ServerPlaylistDetail[],
) {
  if (!isIndexedDbAvailable()) return

  const record: OfflineLibrarySnapshotRecord = {
    key: SNAPSHOT_KEY,
    playlistDetails,
    storedAt: Date.now(),
    summary,
  }
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')

  tx.objectStore(STORE_NAME).put(record)

  await transactionDone(tx)
}

export async function getOfflineLibrarySnapshot(
  availableSongIds?: Iterable<string>,
): Promise<OfflineLibrarySnapshot | null> {
  if (!isIndexedDbAvailable()) return null

  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const request = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY)
  const record = await requestResult<OfflineLibrarySnapshotRecord | undefined>(
    request,
  )

  if (!record) return null

  return filterSnapshotForAvailableSongs(record, availableSongIds)
}

function filterSnapshotForAvailableSongs(
  snapshot: OfflineLibrarySnapshot,
  availableSongIds?: Iterable<string>,
): OfflineLibrarySnapshot {
  const availableIds =
    availableSongIds === undefined ? null : new Set(availableSongIds)
  const songIsAvailable = (song: ServerSong) =>
    availableIds === null || availableIds.has(song.id)
  const playlistDetails = snapshot.playlistDetails.map((playlist) => {
    const songs = playlist.songs.filter(songIsAvailable)

    return {
      ...playlist,
      songCount: songs.length,
      songs,
    }
  })
  const detailsById = new Map(
    playlistDetails.map((playlist) => [playlist.id, playlist]),
  )
  const playlists = [
    ...snapshot.summary.playlists.map((playlist) =>
      playlistSummaryFromDetail(detailsById.get(playlist.id), playlist),
    ),
    ...playlistDetails
      .filter(
        (playlist) =>
          !snapshot.summary.playlists.some((item) => item.id === playlist.id),
      )
      .map((playlist) => playlistSummaryFromDetail(playlist)),
  ]
  const likedSongs = snapshot.summary.likedSongs.filter(songIsAvailable)
  const recentSongs = snapshot.summary.recentSongs.filter(songIsAvailable)

  return {
    playlistDetails,
    storedAt: snapshot.storedAt,
    summary: {
      ...snapshot.summary,
      counts: {
        likedSongs: likedSongs.length,
        playlists: playlists.length,
        songs: availableIds?.size ?? snapshot.summary.counts.songs,
      },
      isEmpty:
        playlists.length === 0 &&
        likedSongs.length === 0 &&
        (availableIds?.size ?? snapshot.summary.counts.songs) === 0,
      likedSongs,
      playlists,
      recentSongs,
    },
  }
}

function playlistSummaryFromDetail(
  detail?: ServerPlaylistDetail,
  fallback?: ServerPlaylist,
): ServerPlaylist {
  const playlist = detail ?? fallback

  if (!playlist) {
    throw new Error('Playlist summary requires a playlist.')
  }

  return {
    color: playlist.color,
    createdAt: playlist.createdAt,
    description: playlist.description,
    id: playlist.id,
    name: playlist.name,
    songCount: detail?.songCount ?? playlist.songCount,
    updatedAt: playlist.updatedAt,
    userId: playlist.userId,
  }
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined'
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
    })
  }

  return dbPromise
}

function requestResult<T>(request: IDBRequest) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result as T)
  })
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => resolve()
  })
}
