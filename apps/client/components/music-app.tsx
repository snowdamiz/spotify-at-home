'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Plus, Settings } from 'lucide-react'
import type { ExternalDiscoveryResult } from '@tunely/shared'
import { Sidebar } from '@/components/sidebar'
import { MobileNav } from '@/components/mobile-nav'
import { PlayerBar } from '@/components/player-bar'
import { NowPlaying } from '@/components/now-playing'
import { HomeView } from '@/components/home-view'
import { LibraryView } from '@/components/library-view'
import { SearchView } from '@/components/search-view'
import { CollectionView } from '@/components/collection-view'
import { AddMusicDialog, type Download } from '@/components/add-music-dialog'
import { SettingsView } from '@/components/settings-view'
import { LoginScreen } from '@/components/login-screen'
import { Button } from '@/components/ui/button'
import {
  discoverYouTubeUrl,
  importYouTubeDiscovery,
  importAudioFiles,
  requestSongCacheIntent,
  serverSongToSong,
  songStreamUrl,
  updatePlaybackState,
} from '@/lib/api'
import { AuthProvider, useAuth } from '@/lib/auth'
import { useImportPolicy, useLibrarySummary, useSongs } from '@/lib/library-hooks'
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

export function MusicApp() {
  return (
    <AuthProvider>
      <MusicAppInner />
    </AuthProvider>
  )
}

function MusicAppInner() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
        Loading Tunely...
      </div>
    )
  }

  if (status === 'anonymous') {
    return <LoginScreen />
  }

  return <AuthenticatedMusicApp />
}

function AuthenticatedMusicApp() {
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
  const [externalResult, setExternalResult] =
    useState<ExternalDiscoveryResult | null>(null)
  const [isDiscoveringLink, setIsDiscoveringLink] = useState(false)
  const [isImportingLink, setIsImportingLink] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playNextRef = useRef<() => void>(() => undefined)

  const serverSongs = songsState.songs
  const userSongs = useMemo(() => serverSongs.map(serverSongToSong), [serverSongs])
  const playlists = library.summary.playlists
  const currentSong = useMemo(
    () =>
      userSongs.find((song) => song.id === currentSongId) ??
      queue.find((song) => song.id === currentSongId) ??
      null,
    [currentSongId, queue, userSongs],
  )
  const activeCollectionId = collection?.id ?? null

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

    const loadSong = async () => {
      setProgress(0)
      setDuration(currentSong.duration || 0)

      try {
        const cacheIntent = await requestSongCacheIntent(currentSong.id)
        const streamUrl =
          cacheIntent.status === 'accepted' && cacheIntent.cacheIntent
            ? cacheIntent.cacheIntent.streamUrl
            : songStreamUrl(currentSong.id)

        audio.crossOrigin = 'use-credentials'
        audio.src = streamUrl
        audio.load()

        if (isPlaying) {
          await audio.play()
        }
      } catch {
        audio.src = currentSong.url
        audio.load()
        if (isPlaying) {
          audio.play().catch(() => setIsPlaying(false))
        }
      }
    }

    loadSong()
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

  const onFilesSelected = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return

      const id = `upload-${Date.now()}`
      setDownloads((prev) => [
        {
          artist: 'Tunely server',
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

  const onSubmitUrl = useCallback(async (rawUrl: string) => {
    setIsDiscoveringLink(true)
    setExternalResult(null)
    const id = `link-discovery-${Date.now()}`

    setDownloads((prev) => [
      {
        artist: 'Checking import policy',
        id,
        platform: 'youtube',
        progress: 0.45,
        status: 'downloading',
        title: rawUrl,
        url: rawUrl,
      },
      ...prev,
    ])

    try {
      const result = await discoverYouTubeUrl(rawUrl)
      const discovery = result.discovery?.results[0]

      if (discovery) {
        setExternalResult(discovery)
      }

      setDownloads((prev) =>
        prev.map((download) =>
          download.id === id
            ? {
                ...download,
                artist:
                  discovery?.creator ??
                  result.discovery?.importPolicy.copy.badge ??
                  'YouTube',
                message:
                  discovery?.eligibility?.message ??
                  'Discovery is ready. Add it to your library when allowed by policy.',
                progress: 1,
                status: 'complete',
                title: discovery?.title ?? rawUrl,
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
                    : 'Could not discover that link.',
                progress: 1,
                status: 'error',
              }
            : download,
          ),
      )
    }
    setIsDiscoveringLink(false)
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
        setExternalResult(null)
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

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          setView={goToView}
          songs={userSongs}
          playlists={playlists}
          likedCount={library.summary.counts.likedSongs}
          onImportClick={() => setAddOpen(true)}
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
                summary={library.summary}
                playlists={playlists}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                onBack={() => setCollection(null)}
                onPlay={(song, nextQueue) => playSong(song, nextQueue)}
                onPlayAll={playCollection}
              />
            ) : view === 'home' ? (
              <HomeView
                songs={userSongs}
                libraryStatus={songsState.status}
                playlists={playlists}
                summary={library.summary}
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
                likedCount={library.summary.counts.likedSongs}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                onPlay={(song) =>
                  playSong(song, [
                    song,
                    ...userSongs.filter((item) => item.id !== song.id),
                  ])
                }
                onImportClick={() => setAddOpen(true)}
                onOpenCollection={openCollection}
              />
            ) : view === 'settings' ? (
              <SettingsView onSignedOut={() => setView('home')} />
            ) : (
              <SearchView
                songs={userSongs}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                onPlay={(song, nextQueue) => playSong(song, nextQueue)}
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
          onSeek={seek}
          onPrev={playPrev}
          onNext={playNext}
          onVolumeChange={(nextVolume) => {
            setVolume(nextVolume)
            if (nextVolume > 0 && muted) setMuted(false)
          }}
          onToggleMute={() => setMuted((value) => !value)}
          onExpand={() => setShowNowPlaying(true)}
        />
        <MobileNav view={view} setView={goToView} />
      </div>

      <NowPlaying
        open={showNowPlaying}
        song={currentSong}
        isPlaying={isPlaying}
        progress={progress}
        duration={duration}
        onClose={() => setShowNowPlaying(false)}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onPrev={playPrev}
        onNext={playNext}
      />

      <AddMusicDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        downloads={downloads}
        externalResult={externalResult}
        importPolicy={importPolicy.policy}
        isDiscoveringLink={isDiscoveringLink}
        isImportingLink={isImportingLink}
        onFilesSelected={onFilesSelected}
        onImportExternalResult={onImportExternalResult}
        onSubmitUrl={onSubmitUrl}
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
          'Tunely',
        )} font-bold text-foreground`}
      >
        T
      </div>
      <span className="text-base font-bold tracking-tight md:text-lg">
        Tunely
      </span>
    </div>
  )
}
