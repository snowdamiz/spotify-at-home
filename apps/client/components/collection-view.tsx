'use client'

import {
  CheckCircle2,
  ChevronLeft,
  Download,
  Heart,
  Loader2,
  Music,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Shuffle,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { CoverArt } from '@/components/cover-art'
import { SongRow } from '@/components/song-row'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import {
  playlistSubtitle,
  serverSongToSong,
  type LibrarySummary,
  type ServerPlaylist,
  type ServerPlaylistDetail,
} from '@/lib/api'
import { usePlaylist } from '@/lib/library-hooks'
import {
  formatTime,
  getCollectionMeta,
  resolvePlaylistColor,
  type CollectionRef,
  type Song,
} from '@/lib/music-types'
import type { OfflineAudioStateMap } from '@/lib/offline-audio-cache'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type CollectionViewProps = {
  collection: CollectionRef
  songs: Song[]
  summary: LibrarySummary
  playlists: ServerPlaylist[]
  currentSongId: string | null
  isPlaying: boolean
  offlineAudio: OfflineAudioStateMap
  revision: number
  onBack: () => void
  onPlay: (song: Song, queue: Song[]) => void
  onPlayAll: (queue: Song[], shuffle?: boolean) => void
  onToggleCollectionOffline: (songs: Song[]) => void
  onToggleSongLike?: (song: Song) => void
  onToggleSongOffline: (song: Song) => void
  onDeleteSong: (song: Song) => void
  onAddSongToPlaylist: (song: Song, playlistId: string) => void
  onCreatePlaylistWithSong: (song: Song) => void
  onRemoveSongFromPlaylist: (playlistId: string, song: Song) => void
  onEditPlaylist: (playlist: ServerPlaylistDetail) => void
  onDeletePlaylist: (playlist: ServerPlaylistDetail) => void
  deletingSongId: string | null
  likingSongId?: string | null
}

export function CollectionView({
  collection,
  songs,
  summary,
  playlists,
  currentSongId,
  isPlaying,
  offlineAudio,
  revision,
  onBack,
  onPlay,
  onPlayAll,
  onToggleCollectionOffline,
  onToggleSongLike,
  onToggleSongOffline,
  onDeleteSong,
  onAddSongToPlaylist,
  onCreatePlaylistWithSong,
  onRemoveSongFromPlaylist,
  onEditPlaylist,
  onDeletePlaylist,
  deletingSongId,
  likingSongId,
}: CollectionViewProps) {
  const playlistState = usePlaylist(
    collection.kind === 'playlist' ? collection.id : undefined,
    revision,
  )
  const meta = resolveCollectionMeta({
    collection,
    playlistState,
    playlists,
    songs,
    summary,
  })
  const userPlaylist =
    collection.kind === 'playlist' && playlistState.status === 'authenticated'
      ? playlistState.playlist
      : null

  if (!meta) {
    const title =
      playlistState.status === 'loading'
        ? 'Loading collection…'
        : playlistState.status === 'anonymous'
          ? 'Log in to view server-backed playlists.'
          : playlistState.status === 'error'
            ? "Couldn't reach the server."
            : 'Collection not found.'
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState variant="section" title={title} />
      </div>
    )
  }

  const totalSeconds = meta.songs.reduce((acc, s) => acc + s.duration, 0)
  const isCollectionPlaying =
    isPlaying && meta.songs.some((s) => s.id === currentSongId)
  const downloadableSongs = meta.songs.filter((song) => !song.isMock && song.serverSong)
  const downloadedCount = downloadableSongs.filter(
    (song) => offlineAudio[song.id]?.status === 'downloaded',
  ).length
  const isCollectionDownloading = downloadableSongs.some(
    (song) => offlineAudio[song.id]?.status === 'downloading',
  )
  const isCollectionDownloaded =
    downloadableSongs.length > 0 && downloadedCount === downloadableSongs.length

  const showSubtitle = Boolean(meta.subtitle && !looksLikeImportFilename(meta.subtitle))
  const showSubtitleDetail =
    'subtitleDetail' in meta && meta.subtitleDetail && meta.songs.length > 0

  return (
    <div>
      {/* Hero — soft color wash that fades to background. Wash is clipped to
          the hero box (overflow-hidden + inset-0) so it never paints over the
          action bar that follows. */}
      <div className="relative overflow-hidden px-4 pt-3 pb-6 md:px-6 md:pt-4 md:pb-8">
        {/* Color wash backdrop */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-b opacity-50',
            meta.coverColor,
          )}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="relative -ml-2 mb-4 h-9 w-9 rounded-full text-foreground/90 hover:bg-foreground/10 hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:gap-6 sm:text-left">
          <CoverArt
            colorClass={meta.coverColor}
            title={meta.title}
            className="h-44 w-44 shrink-0 shadow-2xl shadow-black/50 sm:h-48 sm:w-48 md:h-56 md:w-56"
            rounded="lg"
            icon={
              'icon' in meta && meta.icon
                ? meta.icon
                : undefined
            }
          />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/80">
              {meta.kindLabel}
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl md:text-5xl lg:text-6xl">
              {meta.title}
            </h1>
            {showSubtitle && (
              <p className="mt-3 max-w-xl text-sm text-foreground/80 text-pretty">
                {meta.subtitle}
              </p>
            )}
            <div className="mt-3 text-xs text-foreground/70">
              {meta.songs.length === 0 ? (
                'Empty'
              ) : (
                <>
                  {meta.songs.length}{' '}
                  {meta.songs.length === 1 ? 'song' : 'songs'}
                  {showSubtitleDetail ? (
                    <> &middot; {meta.subtitleDetail}</>
                  ) : null}
                  <> &middot; {formatTime(totalSeconds)}</>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {meta.songs.length > 0 && (
        <div className="flex items-center gap-3 px-4 pb-3 pt-3 md:px-6 md:gap-4">
          <button
            type="button"
            onClick={() => onPlayAll(meta.songs)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/30 transition-transform hover:scale-105 active:scale-100 md:h-14 md:w-14"
            aria-label={isCollectionPlaying ? 'Pause' : 'Play all'}
          >
            {isCollectionPlaying ? (
              <Pause className="h-6 w-6" fill="currentColor" />
            ) : (
              <Play className="h-6 w-6 translate-x-px" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onPlayAll(meta.songs, true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Shuffle play"
          >
            <Shuffle className="h-5 w-5" />
          </button>
          {downloadableSongs.length > 0 && (
            <button
              type="button"
              onClick={() => onToggleCollectionOffline(meta.songs)}
              disabled={isCollectionDownloading}
              title={
                isCollectionDownloaded
                  ? 'Remove collection downloads'
                  : 'Download collection for offline listening'
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-80"
              aria-label={
                isCollectionDownloaded
                  ? 'Remove collection downloads'
                  : 'Download collection for offline listening'
              }
            >
              {isCollectionDownloading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isCollectionDownloaded ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <Download className="h-5 w-5" />
              )}
            </button>
          )}
          {userPlaylist && (
            <PlaylistHeaderMenu
              playlist={userPlaylist}
              onEdit={() => onEditPlaylist(userPlaylist)}
              onDelete={() => onDeletePlaylist(userPlaylist)}
            />
          )}
        </div>
      )}

      {/* Track list */}
      <div className="px-2 pb-8 md:px-4">
        {meta.songs.length === 0 ? (
          <EmptyState
            icon={<Music className="h-5 w-5" />}
            title="No songs yet"
            description="This collection is empty."
          />
        ) : (
          <ul className="space-y-1">
            {meta.songs.map((song) => (
              <li key={song.id}>
                <SongRow
                  song={song}
                  isActive={currentSongId === song.id}
                  isPlaying={isPlaying && currentSongId === song.id}
                  offlineState={offlineAudio[song.id]}
                  onPlay={() => onPlay(song, meta.songs)}
                  onToggleLike={
                    onToggleSongLike ? () => onToggleSongLike(song) : undefined
                  }
                  onToggleOffline={() => onToggleSongOffline(song)}
                  onDelete={() => onDeleteSong(song)}
                  isDeleting={deletingSongId === song.id}
                  isLiking={likingSongId === song.id}
                  playlists={playlists}
                  onAddToPlaylist={(playlistId) =>
                    onAddSongToPlaylist(song, playlistId)
                  }
                  onCreatePlaylistWithSong={() => onCreatePlaylistWithSong(song)}
                  onRemoveFromPlaylist={
                    userPlaylist
                      ? () => onRemoveSongFromPlaylist(userPlaylist.id, song)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PlaylistHeaderMenu({
  playlist,
  onEdit,
  onDelete,
}: {
  playlist: ServerPlaylistDetail
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={`More actions for ${playlist.name}`}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit details
          </DropdownMenuItem>
          <AlertDialogTrigger asChild>
            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete playlist
            </DropdownMenuItem>
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this playlist?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes &ldquo;{playlist.name}&rdquo; permanently. The songs
            stay in your library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function looksLikeImportFilename(text: string) {
  // Hide subtitles like "Imported from sadge_&_sappy.csv" — they read as
  // metadata noise inside a hero card.
  return /^Imported from .+\.(csv|json|txt|xml)$/i.test(text.trim())
}

function resolveCollectionMeta({
  collection,
  playlistState,
  playlists,
  songs,
  summary,
}: {
  collection: CollectionRef
  playlistState: ReturnType<typeof usePlaylist>
  playlists: ServerPlaylist[]
  songs: Song[]
  summary: LibrarySummary
}) {
  if (collection.kind === 'system') {
    const icon: ReactNode = (
      <Heart
        className="h-[36%] w-[36%] text-foreground"
        fill="currentColor"
      />
    )
    return {
      coverColor: 'from-fuchsia-600 to-zinc-950',
      icon,
      kindLabel: 'Playlist',
      songs: summary.likedSongs.map(serverSongToSong),
      subtitle: 'Favorites backed by your private likes.',
      subtitleDetail: `${summary.counts.likedSongs} liked`,
      title: 'Liked Songs',
    }
  }

  if (collection.kind === 'playlist') {
    if (playlistState.status === 'authenticated') {
      const songsById = new Map(songs.map((song) => [song.id, song]))

      return {
        coverColor: resolvePlaylistColor(
          playlistState.playlist.color,
          playlistState.playlist.name,
        ),
        kindLabel: 'Playlist',
        songs: playlistState.playlist.songs.map(
          (song) => songsById.get(song.id) ?? serverSongToSong(song),
        ),
        subtitle:
          playlistState.playlist.description ??
          playlistSubtitle(playlistState.playlist),
        title: playlistState.playlist.name,
      }
    }

    const fallback = playlists.find((playlist) => playlist.id === collection.id)

    if (!fallback || playlistState.status === 'not-found') {
      return null
    }

    return {
      coverColor: resolvePlaylistColor(fallback.color, fallback.name),
      kindLabel: 'Playlist',
      songs: [],
      subtitle: fallback.description ?? playlistSubtitle(fallback),
      title: fallback.name,
    }
  }

  return getCollectionMeta(collection)
}
