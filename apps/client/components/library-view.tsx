'use client'

import { useState } from 'react'
import { Heart, ListMusic, Plus, Search as SearchIcon } from 'lucide-react'
import { SongRow } from '@/components/song-row'
import { CoverArt } from '@/components/cover-art'
import { Button } from '@/components/ui/button'
import { playlistSubtitle, type LibraryLoadStatus, type ServerPlaylist } from '@/lib/api'
import { type CollectionRef, type Song } from '@/lib/music-types'
import type { OfflineAudioStateMap } from '@/lib/offline-audio-cache'

type LibraryViewProps = {
  songs: Song[]
  libraryStatus: LibraryLoadStatus
  playlists: ServerPlaylist[]
  likedCount: number
  currentSongId: string | null
  isPlaying: boolean
  offlineAudio: OfflineAudioStateMap
  onPlay: (song: Song) => void
  onToggleSongLike?: (song: Song) => void
  onToggleSongOffline: (song: Song) => void
  onDeleteSong: (song: Song) => void
  onAddSongToPlaylist: (song: Song, playlistId: string) => void
  onCreatePlaylistWithSong: (song: Song) => void
  onCreatePlaylistClick: () => void
  deletingSongId: string | null
  likingSongId?: string | null
  onImportClick: () => void
  onOpenCollection: (ref: CollectionRef) => void
}

type Filter = 'all' | 'playlists' | 'songs'

export function LibraryView({
  libraryStatus,
  songs,
  playlists,
  likedCount,
  currentSongId,
  isPlaying,
  offlineAudio,
  onPlay,
  onToggleSongOffline,
  onToggleSongLike,
  onDeleteSong,
  onAddSongToPlaylist,
  onCreatePlaylistWithSong,
  onCreatePlaylistClick,
  deletingSongId,
  likingSongId,
  onImportClick,
  onOpenCollection,
}: LibraryViewProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const filteredSongs = songs.filter((s) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    )
  })

  const filteredPlaylists = playlists.filter((p) => {
    if (!query.trim()) return true
    return p.name.toLowerCase().includes(query.toLowerCase())
  })

  const showSongs = filter !== 'playlists'
  const showPlaylists = filter !== 'songs'

  return (
    <div className="px-4 pb-6 md:px-6">
      <header className="flex items-center justify-between pt-2 pb-3">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Your Library
        </h1>
        <Button
          size="icon"
          variant="ghost"
          className="h-10 w-10 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onImportClick}
          aria-label="Import songs"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </header>

      {/* Filter chips */}
      <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
        {([
          { id: 'all', label: 'All' },
          { id: 'playlists', label: 'Playlists' },
          { id: 'songs', label: 'Songs' },
        ] as const).map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                active
                  ? 'shrink-0 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background'
                  : 'shrink-0 rounded-full bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-accent'
              }
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in library"
          className="h-10 w-full rounded-full bg-card pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary md:max-w-xs"
          aria-label="Find in library"
        />
      </div>

      {/* Playlists */}
      {showPlaylists && (
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Playlists
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCreatePlaylistClick}
              className="h-8 rounded-full px-3 text-xs"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New playlist
            </Button>
          </div>
          {filteredPlaylists.length > 0 ? (
            <ul className="space-y-1">
              {filteredPlaylists.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenCollection({ kind: 'playlist', id: p.id })
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card/80"
                  >
                    <CoverArt
                      colorClass={p.color ?? 'from-zinc-700 to-zinc-950'}
                      title={p.name}
                      size="md"
                      rounded="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {p.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        Playlist &middot; {playlistSubtitle(p)}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : playlists.length === 0 ? (
            <button
              type="button"
              onClick={onCreatePlaylistClick}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-left transition-colors hover:bg-card/40"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground">
                <ListMusic className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  Create your first playlist
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  Group songs into a custom mix.
                </div>
              </div>
            </button>
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No playlists match.
            </div>
          )}
        </section>
      )}

      {/* Songs */}
      {showSongs && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your songs
          </h2>

          {libraryStatus === 'loading' ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading your server library...
            </div>
          ) : libraryStatus === 'error' ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Could not reach the Broadside server.
            </div>
          ) : songs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
              <h3 className="text-lg font-semibold">No songs yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload audio from your device to store it on your Broadside server.
              </p>
              <Button onClick={onImportClick} className="mt-5 rounded-full">
                <Plus className="mr-2 h-4 w-4" />
                Add music
              </Button>
            </div>
          ) : filteredSongs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No matches in your library.
            </div>
          ) : (
            <ul className="space-y-1">
              {filteredSongs.map((song) => (
                <li key={song.id}>
                  <SongRow
                    song={song}
                    isActive={currentSongId === song.id}
                    isPlaying={isPlaying && currentSongId === song.id}
                    offlineState={offlineAudio[song.id]}
                    onPlay={() => onPlay(song)}
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
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {showPlaylists && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            System
          </h2>
          <button
            type="button"
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card/80"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-fuchsia-600 to-zinc-950 text-foreground shadow-md">
              <Heart className="h-5 w-5" fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">Liked Songs</div>
              <div className="truncate text-xs text-muted-foreground">
                {likedCount} {likedCount === 1 ? 'song' : 'songs'}
              </div>
            </div>
          </button>
        </section>
      )}
    </div>
  )
}
