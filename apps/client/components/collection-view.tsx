'use client'

import { ArrowLeft, Pause, Play, Shuffle } from 'lucide-react'
import { CoverArt } from '@/components/cover-art'
import { SongRow } from '@/components/song-row'
import {
  playlistSubtitle,
  serverSongToSong,
  type LibrarySummary,
  type ServerPlaylist,
} from '@/lib/api'
import { usePlaylist } from '@/lib/library-hooks'
import {
  formatTime,
  getCollectionMeta,
  type CollectionRef,
  type Song,
} from '@/lib/music-types'

type CollectionViewProps = {
  collection: CollectionRef
  songs: Song[]
  summary: LibrarySummary
  playlists: ServerPlaylist[]
  currentSongId: string | null
  isPlaying: boolean
  onBack: () => void
  onPlay: (song: Song, queue: Song[]) => void
  onPlayAll: (queue: Song[], shuffle?: boolean) => void
}

export function CollectionView({
  collection,
  songs,
  summary,
  playlists,
  currentSongId,
  isPlaying,
  onBack,
  onPlay,
  onPlayAll,
}: CollectionViewProps) {
  const playlistState = usePlaylist(
    collection.kind === 'playlist' ? collection.id : undefined,
  )
  const meta = resolveCollectionMeta({
    collection,
    playlistState,
    playlists,
    songs,
    summary,
  })

  if (!meta) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground md:px-6">
        {playlistState.status === 'loading'
          ? 'Loading collection...'
          : playlistState.status === 'anonymous'
            ? 'Log in to view server-backed playlists.'
            : playlistState.status === 'error'
              ? 'Could not reach the Tunely server.'
              : 'Collection not found.'}
      </div>
    )
  }

  const totalSeconds = meta.songs.reduce((acc, s) => acc + s.duration, 0)
  const isCollectionPlaying =
    isPlaying && meta.songs.some((s) => s.id === currentSongId)

  return (
    <div>
      {/* Hero */}
      <div
        className={`bg-gradient-to-b ${meta.coverColor} to-background px-4 pt-2 pb-6 md:px-6`}
      >
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1 rounded-full bg-background/40 px-2 py-1 text-xs font-medium text-foreground backdrop-blur transition-colors hover:bg-background/60"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
          <CoverArt
            colorClass={meta.coverColor}
            title={meta.title}
            className="h-40 w-40 rounded-md text-3xl shadow-2xl sm:h-48 sm:w-48 md:h-52 md:w-52"
            rounded="md"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              {meta.kindLabel}
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance md:text-5xl">
              {meta.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-foreground/80 text-pretty">
              {meta.subtitle}
            </p>
            <div className="mt-3 text-xs text-foreground/70">
              {meta.songs.length} {meta.songs.length === 1 ? 'song' : 'songs'}
              {'subtitleDetail' in meta && meta.subtitleDetail ? (
                <> &middot; {meta.subtitleDetail}</>
              ) : null}
              {meta.songs.length > 0 && (
                <> &middot; {formatTime(totalSeconds)}</>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {meta.songs.length > 0 && (
        <div className="flex items-center gap-3 px-4 pb-2 md:px-6">
          <button
            type="button"
            onClick={() => onPlayAll(meta.songs)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 md:h-14 md:w-14"
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
        </div>
      )}

      {/* Track list */}
      <div className="px-2 pb-6 md:px-4">
        {meta.songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
            <h3 className="text-lg font-semibold">No songs yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This collection is empty.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {meta.songs.map((song) => (
              <li key={song.id}>
                <SongRow
                  song={song}
                  isActive={currentSongId === song.id}
                  isPlaying={isPlaying && currentSongId === song.id}
                  onPlay={() => onPlay(song, meta.songs)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
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
    if (collection.id === 'liked-songs') {
      return {
        coverColor: 'from-fuchsia-600 to-zinc-950',
        kindLabel: 'Playlist',
        songs: summary.likedSongs.map(serverSongToSong),
        subtitle: 'Favorites backed by your private likes.',
        subtitleDetail: `${summary.counts.likedSongs} liked`,
        title: 'Liked Songs',
      }
    }

    return {
      coverColor: 'from-amber-500 to-orange-950',
      kindLabel: 'Playlist',
      songs,
      subtitle: 'Songs stored privately on your Tunely server.',
      subtitleDetail: `${summary.counts.songs} imported`,
      title: 'Imported Songs',
    }
  }

  if (collection.kind === 'playlist') {
    if (playlistState.status === 'authenticated') {
      return {
        coverColor: playlistState.playlist.color ?? 'from-zinc-700 to-zinc-950',
        kindLabel: 'Playlist',
        songs: playlistState.playlist.songs.map(serverSongToSong),
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
      coverColor: fallback.color ?? 'from-zinc-700 to-zinc-950',
      kindLabel: 'Playlist',
      songs: [],
      subtitle: fallback.description ?? playlistSubtitle(fallback),
      title: fallback.name,
    }
  }

  return getCollectionMeta(collection)
}
