'use client'

import { Heart, Link2, Play, Plus, Upload } from 'lucide-react'
import { CoverArt } from '@/components/cover-art'
import { Button } from '@/components/ui/button'
import { playlistSubtitle, type LibraryLoadStatus, type LibrarySummary, type ServerPlaylist } from '@/lib/api'
import { type CollectionRef, type Song } from '@/lib/music-types'

type HomeViewProps = {
  songs: Song[]
  libraryStatus: LibraryLoadStatus
  playlists: ServerPlaylist[]
  summary: LibrarySummary
  onPlay: (song: Song) => void
  onImportClick: () => void
  onOpenCollection: (ref: CollectionRef) => void
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function HomeView({
  libraryStatus,
  songs,
  playlists,
  summary,
  onPlay,
  onImportClick,
  onOpenCollection,
}: HomeViewProps) {
  const recent = [...songs]
    .sort((a, b) => b.dateAdded - a.dateAdded)
    .slice(0, 6)

  return (
    <div className="space-y-8 px-4 pb-6 md:px-6">
      {/* Greeting */}
      <header className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {getGreeting()}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your music, anywhere you go.
        </p>
      </header>

      {/* Quick access tiles */}
      <section>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={onImportClick}
            className="group flex items-center gap-3 overflow-hidden rounded-md bg-card pr-4 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-gradient-to-br from-amber-400 to-orange-700 text-primary-foreground">
              <Upload className="h-6 w-6" />
            </div>
            <span className="font-semibold">Upload from device</span>
          </button>
          <button
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className="group flex items-center gap-3 overflow-hidden rounded-md bg-card pr-4 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-gradient-to-br from-fuchsia-600 to-zinc-950 text-foreground">
              <Heart className="h-6 w-6" fill="currentColor" />
            </div>
            <span className="font-semibold">Liked Songs</span>
          </button>
          <button
            onClick={onImportClick}
            className="group flex items-center gap-3 overflow-hidden rounded-md bg-card pr-4 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-gradient-to-br from-rose-500 to-amber-700 text-foreground">
              <Link2 className="h-6 w-6" />
            </div>
            <span className="font-semibold">Import from a link</span>
          </button>
          {playlists.slice(0, 3).map((p) => (
            <button
              key={p.id}
              onClick={() => onOpenCollection({ kind: 'playlist', id: p.id })}
              className="group flex items-center gap-3 overflow-hidden rounded-md bg-card pr-4 text-left transition-colors hover:bg-accent"
            >
              <CoverArt
                colorClass={p.color ?? 'from-zinc-700 to-zinc-950'}
                title={p.name}
                className="h-16 w-16 rounded-none"
                rounded="md"
              />
              <span className="font-semibold">{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Recently added */}
      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-xl font-bold tracking-tight">Recently added</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {recent.map((song) => (
              <button
                key={song.id}
                onClick={() => onPlay(song)}
                className="group rounded-lg bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <div className="relative">
                  <CoverArt
                    colorClass={song.coverColor}
                    title={song.title}
                    size="full"
                    rounded="md"
                  />
                  <div className="absolute right-2 bottom-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100">
                    <Play
                      className="h-5 w-5 translate-x-px"
                      fill="currentColor"
                    />
                  </div>
                </div>
                <div className="mt-3 truncate text-sm font-semibold">
                  {song.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {song.artist}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Made for you */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-xl font-bold tracking-tight">Your collections</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <button
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className="group rounded-lg bg-card p-3 text-left transition-colors hover:bg-accent"
          >
            <CoverArt
              colorClass="from-fuchsia-600 to-zinc-950"
              title="Liked Songs"
              size="full"
              rounded="md"
            />
            <div className="mt-3 truncate text-sm font-semibold">
              Liked Songs
            </div>
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {summary.counts.likedSongs}{' '}
              {summary.counts.likedSongs === 1 ? 'song' : 'songs'}
            </div>
          </button>
          <button
            onClick={() => onOpenCollection({ kind: 'system', id: 'imported-songs' })}
            className="group rounded-lg bg-card p-3 text-left transition-colors hover:bg-accent"
          >
            <CoverArt
              colorClass="from-amber-500 to-orange-950"
              title="Imported Songs"
              size="full"
              rounded="md"
            />
            <div className="mt-3 truncate text-sm font-semibold">
              Imported Songs
            </div>
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {summary.counts.songs}{' '}
              {summary.counts.songs === 1 ? 'song' : 'songs'} on your server
            </div>
          </button>
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpenCollection({ kind: 'playlist', id: p.id })}
              className="group rounded-lg bg-card p-3 text-left transition-colors hover:bg-accent"
            >
              <CoverArt
                colorClass={p.color ?? 'from-zinc-700 to-zinc-950'}
                title={p.name}
                size="full"
                rounded="md"
              />
              <div className="mt-3 truncate text-sm font-semibold">
                {p.name}
              </div>
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {p.description ?? playlistSubtitle(p)}
              </div>
            </button>
          ))}
        </div>
      </section>

      {libraryStatus === 'loading' ? (
        <section className="rounded-lg bg-card/60 p-5 text-sm text-muted-foreground">
          Loading your server library...
        </section>
      ) : libraryStatus === 'error' ? (
        <section className="rounded-lg bg-card/60 p-5 text-sm text-muted-foreground">
          Could not reach the Tunely server.
        </section>
      ) : songs.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
          <h3 className="text-lg font-semibold">Your library is empty</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload audio from your device to start listening.
          </p>
          <Button onClick={onImportClick} className="mt-4 rounded-full">
            <Plus className="mr-2 h-4 w-4" />
            Add music
          </Button>
        </section>
      ) : null}
    </div>
  )
}
