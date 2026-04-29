'use client'

import { useState } from 'react'
import {
  Heart,
  ListMusic,
  Loader2,
  Plus,
  Search as SearchIcon,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { SongRow } from '@/components/song-row'
import { CoverArt } from '@/components/cover-art'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import {
  playlistSubtitle,
  type LibraryLoadStatus,
  type ServerPlaylist,
} from '@/lib/api'
import { resolvePlaylistColor, type CollectionRef, type Song } from '@/lib/music-types'
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
  onDeletePlaylist: (playlist: ServerPlaylist) => Promise<void> | void
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
  onDeletePlaylist,
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
    <div className="px-4 pb-8 md:px-6">
      <header className="flex items-center justify-between pt-2 pb-4">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
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
      <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar">
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
                  ? 'shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold tracking-tight text-background transition-colors'
                  : 'shrink-0 rounded-full bg-card/70 px-3.5 py-1.5 text-xs font-medium tracking-tight text-foreground transition-colors hover:bg-card'
              }
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative mb-5 md:max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in library"
          className="h-10 w-full rounded-full bg-card/70 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:bg-card focus:outline-none focus:ring-1 focus:ring-foreground/20"
          aria-label="Find in library"
        />
      </div>

      {/* Playlists */}
      {showPlaylists && (
        <section className="mb-7">
          <SectionHeader
            title="Playlists"
            size="sm"
            className="mb-2"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={onCreatePlaylistClick}
                className="h-8 rounded-full px-3 text-xs"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                New playlist
              </Button>
            }
          />
          {libraryStatus === 'offline' && playlists.length === 0 ? (
            <EmptyState
              variant="section"
              title="Playlists are unavailable offline."
              description="Saved songs are still available on this device."
            />
          ) : filteredPlaylists.length > 0 ? (
            <ul className="space-y-1">
              {filteredPlaylists.map((p) => (
                <li key={p.id}>
                  <div className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-card/60">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCollection({ kind: 'playlist', id: p.id })
                      }
                      className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                    >
                      <CoverArt
                        colorClass={resolvePlaylistColor(p.color, p.name)}
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
                    <PlaylistDeleteButton
                      playlist={p}
                      onDelete={() => onDeletePlaylist(p)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : playlists.length === 0 ? (
            <EmptyState
              icon={<ListMusic className="h-5 w-5" />}
              title="Create your first playlist"
              description="Group songs into a custom mix."
              action={
                <Button
                  onClick={onCreatePlaylistClick}
                  className="h-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New playlist
                </Button>
              }
            />
          ) : (
            <EmptyState
              variant="section"
              title="No playlists match."
            />
          )}
        </section>
      )}

      {/* Songs */}
      {showSongs && (
        <section>
          <SectionHeader title="Your songs" size="sm" className="mb-2" />

          {libraryStatus === 'loading' ? (
            <EmptyState variant="section" title="Loading your library…" />
          ) : libraryStatus === 'offline' && songs.length === 0 ? (
            <EmptyState
              icon={<WifiOff className="h-5 w-5" />}
              title="No offline songs on this device"
              description="Reconnect, then sync your library to save tracks here."
            />
          ) : libraryStatus === 'error' ? (
            <EmptyState
              variant="section"
              title="Couldn't reach the server."
              description="Check your connection and try again."
            />
          ) : songs.length === 0 ? (
            <EmptyState
              icon={<Plus className="h-5 w-5" />}
              title="No songs yet"
              description="Upload audio from your device to store it in your library."
              action={
                <Button
                  onClick={onImportClick}
                  className="h-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add music
                </Button>
              }
            />
          ) : filteredSongs.length === 0 ? (
            <EmptyState
              variant="section"
              title="No matches in your library."
            />
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
        <section className="mt-7">
          <SectionHeader title="System" size="sm" className="mb-2" />
          <button
            type="button"
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card/60"
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

function PlaylistDeleteButton({
  playlist,
  onDelete,
}: {
  playlist: ServerPlaylist
  onDelete: () => Promise<void> | void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (deleting) return

    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={deleting}
          className="mr-1 h-9 w-9 shrink-0 rounded-full text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label={`Delete ${playlist.name}`}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this playlist?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes &ldquo;{playlist.name}&rdquo; permanently. The songs
            stay in your library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={handleDelete}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
