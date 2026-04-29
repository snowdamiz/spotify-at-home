'use client'

import { requestSongCacheIntent } from '@/lib/api'
import type { Song } from '@/lib/music-types'

const DB_NAME = 'broadside-offline-audio'
const DB_VERSION = 1
const STORE_NAME = 'tracks'

export type OfflineAudioStatus =
  | 'idle'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type OfflineAudioState = {
  message?: string
  progress?: number
  sizeBytes?: number
  status: OfflineAudioStatus
  storedAt?: number
}

export type OfflineAudioStateMap = Record<string, OfflineAudioState>

type OfflineAudioRecord = {
  artist: string
  blob: Blob
  cacheKey: string
  checksum: string | null
  mimeType: string
  sizeBytes: number
  songId: string
  storedAt: number
  title: string
}

type DownloadOptions = {
  onProgress?: (progress: number) => void
}

let dbPromise: Promise<IDBDatabase> | null = null
let persistPromise: Promise<boolean> | null = null

export function canStoreOffline(song: Song) {
  return !song.isMock && Boolean(song.serverSong)
}

export async function getOfflineAudioStates(
  songs: Song[],
): Promise<OfflineAudioStateMap> {
  if (!isIndexedDbAvailable()) {
    return Object.fromEntries(
      songs.map((song) => [
        song.id,
        {
          message: 'Offline downloads are not available in this browser.',
          status: 'idle' as const,
        },
      ]),
    )
  }

  const states: OfflineAudioStateMap = {}

  await Promise.all(
    songs.map(async (song) => {
      if (!canStoreOffline(song)) {
        states[song.id] = { status: 'idle' }
        return
      }

      const record = await readRecord(song.id)

      if (record && isRecordCurrent(song, record)) {
        states[song.id] = {
          sizeBytes: record.sizeBytes,
          status: 'downloaded',
          storedAt: record.storedAt,
        }
        return
      }

      if (record) {
        await deleteRecord(song.id)
      }

      states[song.id] = { status: 'idle' }
    }),
  )

  return states
}

export async function getOfflineAudioBlob(song: Song) {
  if (!canStoreOffline(song) || !isIndexedDbAvailable()) return null

  const record = await readRecord(song.id)

  if (!record) return null

  if (!isRecordCurrent(song, record)) {
    await deleteRecord(song.id)
    return null
  }

  return record.blob
}

export async function downloadOfflineAudio(
  song: Song,
  options: DownloadOptions = {},
): Promise<OfflineAudioState> {
  if (!canStoreOffline(song)) {
    throw new Error('Only server-backed songs can be downloaded.')
  }

  if (!isIndexedDbAvailable()) {
    throw new Error('Offline downloads are not available in this browser.')
  }

  const existing = await readRecord(song.id)

  if (existing && isRecordCurrent(song, existing)) {
    return {
      sizeBytes: existing.sizeBytes,
      status: 'downloaded',
      storedAt: existing.storedAt,
    }
  }

  await requestPersistentStorage()

  const intent = await requestSongCacheIntent(song.id)

  if (intent.status !== 'accepted' || !intent.cacheIntent) {
    throw new Error('Could not prepare this song for offline download.')
  }

  const response = await fetch(intent.cacheIntent.streamUrl, {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}.`)
  }

  const expectedSize =
    intent.cacheIntent.sizeBytes ??
    song.serverSong?.sizeBytes ??
    numberFromHeader(response.headers.get('content-length'))
  const mimeType =
    intent.cacheIntent.mimeType ??
    cleanMimeType(response.headers.get('content-type')) ??
    song.serverSong?.mimeType ??
    'audio/mpeg'
  const blob = await readResponseBlob(response, expectedSize, options)

  if (expectedSize && blob.size !== expectedSize) {
    throw new Error('The downloaded audio did not match the server copy.')
  }

  const record: OfflineAudioRecord = {
    artist: song.artist,
    blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
    cacheKey: cacheKeyForSong(song),
    checksum: intent.cacheIntent.checksum ?? song.serverSong?.checksum ?? null,
    mimeType,
    sizeBytes: blob.size,
    songId: song.id,
    storedAt: Date.now(),
    title: song.title,
  }

  await writeRecord(record)

  return {
    sizeBytes: record.sizeBytes,
    status: 'downloaded',
    storedAt: record.storedAt,
  }
}

export async function deleteOfflineAudio(songId: string) {
  if (!isIndexedDbAvailable()) return

  await deleteRecord(songId)
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
          db.createObjectStore(STORE_NAME, { keyPath: 'songId' })
        }
      }
    })
  }

  return dbPromise
}

async function readRecord(songId: string) {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const request = tx.objectStore(STORE_NAME).get(songId)

  return requestResult<OfflineAudioRecord | undefined>(request)
}

async function writeRecord(record: OfflineAudioRecord) {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')

  tx.objectStore(STORE_NAME).put(record)

  await transactionDone(tx)
}

async function deleteRecord(songId: string) {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')

  tx.objectStore(STORE_NAME).delete(songId)

  await transactionDone(tx)
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

function isRecordCurrent(song: Song, record: OfflineAudioRecord) {
  const serverSong = song.serverSong

  if (!serverSong) return false

  return (
    record.cacheKey === cacheKeyForSong(song) &&
    record.sizeBytes === serverSong.sizeBytes &&
    record.mimeType === serverSong.mimeType
  )
}

function cacheKeyForSong(song: Song) {
  const serverSong = song.serverSong
  const checksum = serverSong?.checksum || 'no-checksum'
  const sizeBytes = serverSong?.sizeBytes ?? 0
  const mimeType = serverSong?.mimeType ?? 'application/octet-stream'

  return `${song.id}:${checksum}:${sizeBytes}:${mimeType}`
}

async function readResponseBlob(
  response: Response,
  expectedSize: number | null,
  options: DownloadOptions,
) {
  if (!response.body) {
    const blob = await response.blob()
    options.onProgress?.(1)
    return blob
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) break
    if (!value) continue

    chunks.push(value)
    received += value.byteLength

    if (expectedSize) {
      options.onProgress?.(Math.min(received / expectedSize, 0.99))
    }
  }

  options.onProgress?.(1)

  return new Blob(chunks, {
    type: cleanMimeType(response.headers.get('content-type')) ?? 'audio/mpeg',
  })
}

function numberFromHeader(value: string | null) {
  if (!value) return null

  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null
}

function cleanMimeType(value: string | null) {
  return value?.split(';')[0]?.trim() || null
}

async function requestPersistentStorage() {
  if (persistPromise) return persistPromise

  persistPromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return false
    }

    try {
      return navigator.storage.persist()
    } catch {
      return false
    }
  })()

  return persistPromise
}
