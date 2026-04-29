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
import {
  SettingsView,
  type LibraryDeviceSyncState,
} from '@/components/settings-view'
import { LoginScreen } from '@/components/login-screen'
import { EntryKeyScreen } from '@/components/entry-key-screen'
import { AdminView } from '@/components/admin-view'
import {
  CreatePlaylistDialog,
  EditPlaylistDialog,
} from '@/components/playlist-dialogs'
import { Button } from '@/components/ui/button'
import {
  addSongToPlaylist,
  createPlaylist,
  deletePlaylist,
  deleteSong,
  discoverYouTubeUrl,
  importYouTubeDiscovery,
  importAudioFiles,
  likeSong,
  removeSongFromPlaylist,
  requestSongCacheIntent,
  searchYouTube,
  serverSongToSong,
  songStreamUrl,
  unlikeSong,
  updatePlaybackState,
  updatePlaylist,
  type ServerPlaylistDetail,
} from '@/lib/api'
import { AuthProvider, useAuth } from '@/lib/auth'
import { useImportPolicy, useLibrarySummary, useSongs } from '@/lib/library-hooks'
import { isLikelyYouTubeUrl } from '@/lib/url-import'
import { toast } from '@/hooks/use-toast'
import {
  canStoreOffline,
  deleteOfflineAudio,
  downloadOfflineAudio,
  getOfflineAudioBlob,
  getOfflineAudioStates,
  type OfflineAudioStateMap,
} from '@/lib/offline-audio-cache'
import {
  pickCoverColor,
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
    if (state.status === 'downloading') {
      next[songId] = state
    }
  }

  return next
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
        Loading Broadside...
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
  const [revision, setRevision] = useState(0)
  const songsState = useSongs(revision)
  const library = useLibrarySummary(revision)
  const importPolicy = useImportPolicy()
  const [view, setView] = useState<View>('home')
  const [collection, setCollection] = useState<CollectionRef | null>(null)
  const [queue, setQueue] = useState<Song[]>([])
  const [currentSongId, setCurrentSongId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [showNowPlaying, setShowNowPlaying] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [downloads, setDownloads] = useState<Download[]>([])
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
  const [isDiscoveringLink, setIsDiscoveringLink] = useState(false)
  const [isImportingLink, setIsImportingLink] = useState(false)
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false)
  const [pendingSongForPlaylist, setPendingSongForPlaylist] =
    useState<Song | null>(null)
  const [editingPlaylist, setEditingPlaylist] =
    useState<ServerPlaylistDetail | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playNextRef = useRef<() => void>(() => undefined)

  const serverSongs = useMemo(
    () =>
      songsState.songs.map((song) =>
        likedOverrides[song.id] === undefined
          ? song
          : { ...song, liked: likedOverrides[song.id] },
      ),
    [likedOverrides, songsState.songs],
  )
  const likedAwareSummary = useMemo(() => {
    if (songsState.status === 'authenticated') {
      return {
        ...library.summary,
        counts: {
          ...library.summary.counts,
          likedSongs: serverSongs.filter((song) => song.liked).length,
        },
        likedSongs: serverSongs.filter((song) => song.liked),
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
  }, [library.summary, likedOverrides, serverSongs, songsState.status])
  const userSongs = useMemo(
    () =>
      serverSongs
        .map(serverSongToSong)
        .filter((song) => !locallyDeletedSongIds.has(song.id)),
    [locallyDeletedSongIds, serverSongs],
  )
  const playlists = likedAwareSummary.playlists
  const currentSong = useMemo(
    () =>
      userSongs.find((song) => song.id === currentSongId) ??
      queue.find((song) => song.id === currentSongId) ??
      null,
    [currentSongId, queue, userSongs],
  )
  const activeCollectionId = collection?.id ?? null

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
    let cancelled = false

    getOfflineAudioStates(userSongs)
      .then((states) => {
        if (cancelled) return
        setOfflineAudio((current) => mergeOfflineStates(current, states))
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [userSongs])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setProgress(audio.currentTime)
    const onLoaded = () => setDuration(audio.duration || currentSong?.duration || 0)
    const onEnded = () => playNextRef.current()
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
    const audio = audioRef.current
    if (!audio) return

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

    const loadSong = async () => {
      setProgress(0)
      setDuration(currentSong.duration || 0)

      try {
        const offlineBlob = await getOfflineAudioBlob(currentSong)

        if (disposed) return

        if (offlineBlob) {
          objectUrl = URL.createObjectURL(offlineBlob)
          audio.removeAttribute('crossorigin')
          audio.src = objectUrl
        } else {
          setOfflineAudio((states) =>
            states[currentSong.id]?.status === 'downloaded'
              ? { ...states, [currentSong.id]: { status: 'idle' } }
              : states,
          )

          const cacheIntent = await requestSongCacheIntent(currentSong.id)
          const streamUrl =
            cacheIntent.status === 'accepted' && cacheIntent.cacheIntent
              ? cacheIntent.cacheIntent.streamUrl
              : songStreamUrl(currentSong.id)

          if (disposed) return

          audio.crossOrigin = 'use-credentials'
          audio.src = streamUrl
        }
        audio.load()

        if (isPlaying) {
          await audio.play()
        }
      } catch {
        if (disposed) return
        audio.crossOrigin = 'use-credentials'
        audio.src = currentSong.url
        audio.load()
        if (isPlaying) {
          audio.play().catch(() => setIsPlaying(false))
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
    (song: Song, contextQueue?: Song[]) => {
      setCurrentSongId(song.id)
      setIsPlaying(true)
      setQueue(contextQueue && contextQueue.length > 0 ? contextQueue : [song])
      updatePlaybackState({
        positionMs: 0,
        repeatMode: 'off',
        shuffleEnabled: false,
        songId: song.id,
      }).catch(() => undefined)
      setTimeout(() => {
        audioRef.current?.play().catch(() => setIsPlaying(false))
      }, 0)
    },
    [],
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
    (songs: Song[], shuffle = false) => {
      if (songs.length === 0) return
      const ordered = shuffle ? shuffleArray(songs) : songs
      const alreadyHere = ordered.find((song) => song.id === currentSongId)

      if (alreadyHere) {
        setQueue(ordered)
        togglePlay()
        return
      }

      playSong(ordered[0], ordered)
    },
    [currentSongId, playSong, togglePlay],
  )

  const playNext = useCallback(() => {
    const list = queue.length > 0 ? queue : userSongs
    if (list.length === 0) return
    const idx = list.findIndex((song) => song.id === currentSongId)
    const next = list[(idx + 1) % list.length]
    if (next) playSong(next, list)
  }, [currentSongId, playSong, queue, userSongs])

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
    if (prev) playSong(prev, list)
  }, [currentSongId, playSong, queue, userSongs])

  const seek = useCallback((value: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    setProgress(value)
  }, [])

  const refreshLibrary = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  const downloadSongForOffline = useCallback(
    async (song: Song, notify = true) => {
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

        setOfflineAudio((states) => ({
          ...states,
          [song.id]: state,
        }))

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
    [],
  )

  const deleteSongFromLibrary = useCallback(
    async (song: Song) => {
      if (deletingSongId) return

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

        setLocallyDeletedSongIds((current) => {
          const next = new Set(current)
          next.add(song.id)
          return next
        })
        setQueue((current) => current.filter((item) => item.id !== song.id))
        deleteOfflineAudio(song.id).catch(() => undefined)
        setOfflineAudio((states) => ({
          ...states,
          [song.id]: { status: 'idle' },
        }))

        if (currentSongId === song.id) {
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
    [currentSongId, deletingSongId, refreshLibrary],
  )

  const toggleSongLike = useCallback(
    async (song: Song) => {
      if (!song.serverSong || likingSongId) return

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
    [likingSongId, refreshLibrary],
  )

  const toggleSongOffline = useCallback(async (song: Song) => {
    if (!canStoreOffline(song)) return

    const current = offlineAudio[song.id]

    if (current?.status === 'downloading') return

    if (current?.status === 'downloaded') {
      await deleteOfflineAudio(song.id)
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

    await downloadSongForOffline(song)
  }, [downloadSongForOffline, offlineAudio])

  const toggleCollectionOffline = useCallback(
    async (songs: Song[]) => {
      const downloadable = songs.filter(canStoreOffline)

      if (downloadable.length === 0) return

      const allDownloaded = downloadable.every(
        (song) => offlineAudio[song.id]?.status === 'downloaded',
      )

      if (allDownloaded) {
        await Promise.all(downloadable.map((song) => deleteOfflineAudio(song.id)))
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

      let savedCount = 0

      for (const song of downloadable) {
        const state = offlineAudio[song.id]?.status

        if (state === 'downloaded' || state === 'downloading') continue

        if (await downloadSongForOffline(song, false)) {
          savedCount += 1
        }
      }

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
    [downloadSongForOffline, offlineAudio],
  )

  const syncLibraryToDevice = useCallback(async () => {
    if (librarySync.status === 'syncing') return

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

    for (const song of pending) {
      const saved = await downloadSongForOffline(song, false)

      completed += 1
      if (!saved) failed += 1

      setLibrarySync({
        completed,
        failed,
        status: 'syncing',
        total: downloadable.length,
      })
    }

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
  }, [downloadSongForOffline, librarySync.status, offlineAudio, userSongs])

  const onFilesSelected = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return

      const id = `upload-${Date.now()}`
      setDownloads((prev) => [
        {
          artist: 'Broadside server',
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
    [importPolicy.policy.mode, refreshLibrary],
  )

  const onSubmitUrl = useCallback(async (rawInput: string) => {
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
  }, [])

  const onImportExternalResult = useCallback(
    async (result: ExternalDiscoveryResult) => {
      const id = `link-import-${result.sourceId}-${Date.now()}`

      setIsImportingLink(true)
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
      } finally {
        setIsImportingLink(false)
      }
    },
    [refreshLibrary],
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
    [pendingSongForPlaylist, refreshLibrary],
  )

  const handleAddSongToPlaylist = useCallback(
    async (song: Song, playlistId: string) => {
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
    [playlists, refreshLibrary],
  )

  const handleRemoveSongFromPlaylist = useCallback(
    async (playlistId: string, song: Song) => {
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
    [refreshLibrary],
  )

  const handleEditPlaylistSubmit = useCallback(
    async (input: { name: string; description: string | null }) => {
      const target = editingPlaylist
      if (!target) return

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
    [editingPlaylist, refreshLibrary],
  )

  const handleDeletePlaylist = useCallback(
    async (playlist: ServerPlaylistDetail) => {
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
    [refreshLibrary],
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
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          setView={goToView}
          songs={userSongs}
          playlists={playlists}
          likedCount={likedAwareSummary.counts.likedSongs}
          isAdmin={Boolean(user?.isAdmin)}
          onImportClick={() => setAddOpen(true)}
          onCreatePlaylistClick={openCreatePlaylist}
          onOpenCollection={openCollection}
          activeCollectionId={activeCollectionId}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col rounded-none md:m-2 md:ml-0 md:rounded-xl md:bg-card/40 md:backdrop-blur">
          <header className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 md:hidden">
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
                onClick={() => setAddOpen(true)}
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
                onClick={() => setAddOpen(true)}
                className="rounded-full bg-foreground text-background hover:bg-foreground/90"
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
                onPlay={(song, nextQueue) => playSong(song, nextQueue)}
                onPlayAll={playCollection}
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
                libraryStatus={songsState.status}
                playlists={playlists}
                summary={likedAwareSummary}
                onPlay={(song) =>
                  playSong(song, [
                    song,
                    ...userSongs.filter((item) => item.id !== song.id),
                  ])
                }
                onImportClick={() => setAddOpen(true)}
                onOpenCollection={openCollection}
              />
            ) : view === 'library' ? (
              <LibraryView
                songs={userSongs}
                libraryStatus={songsState.status}
                playlists={playlists}
                likedCount={likedAwareSummary.counts.likedSongs}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                offlineAudio={offlineAudio}
                onPlay={(song) =>
                  playSong(song, [
                    song,
                    ...userSongs.filter((item) => item.id !== song.id),
                  ])
                }
                onToggleSongLike={toggleSongLike}
                onToggleSongOffline={toggleSongOffline}
                onDeleteSong={deleteSongFromLibrary}
                onAddSongToPlaylist={handleAddSongToPlaylist}
                onCreatePlaylistWithSong={openCreatePlaylistWithSong}
                onCreatePlaylistClick={openCreatePlaylist}
                deletingSongId={deletingSongId}
                likingSongId={likingSongId}
                onImportClick={() => setAddOpen(true)}
                onOpenCollection={openCollection}
              />
            ) : view === 'settings' ? (
              <SettingsView
                offlineAudio={offlineAudio}
                songs={userSongs}
                syncState={librarySync}
                onSignedOut={() => setView('home')}
                onSyncLibraryOffline={syncLibraryToDevice}
              />
            ) : view === 'admin' && user?.isAdmin ? (
              <AdminView />
            ) : (
              <SearchView
                songs={userSongs}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                offlineAudio={offlineAudio}
                revision={revision}
                onPlay={(song, nextQueue) => playSong(song, nextQueue)}
                onToggleSongLike={toggleSongLike}
                onToggleSongOffline={toggleSongOffline}
                onDeleteSong={deleteSongFromLibrary}
                deletingSongId={deletingSongId}
                likingSongId={likingSongId}
                onOpenCollection={openCollection}
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
          onTogglePlay={togglePlay}
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
          isLikePending={currentSong ? likingSongId === currentSong.id : false}
        />
        <MobileNav
          isAdmin={Boolean(user?.isAdmin)}
          view={view}
          setView={goToView}
        />
      </div>

      <NowPlaying
        open={showNowPlaying}
        song={currentSong}
        isPlaying={isPlaying}
        progress={progress}
        duration={duration}
        onClose={() => setShowNowPlaying(false)}
        onTogglePlay={togglePlay}
        onToggleLike={
          currentSong ? () => toggleSongLike(currentSong) : undefined
        }
        onSeek={seek}
        onPrev={playPrev}
        onNext={playNext}
        isLikePending={currentSong ? likingSongId === currentSong.id : false}
      />

      <AddMusicDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        downloads={downloads}
        externalResults={externalResults}
        isDiscoveringLink={isDiscoveringLink}
        isImportingLink={isImportingLink}
        onFilesSelected={onFilesSelected}
        onImportExternalResult={onImportExternalResult}
        onSubmitUrl={onSubmitUrl}
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
    <div className="flex items-center gap-2">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${pickCoverColor(
          'Broadside',
        )} font-bold text-foreground`}
      >
        T
      </div>
      <span className="text-base font-bold tracking-tight md:text-lg">
        Broadside
      </span>
    </div>
  )
}
