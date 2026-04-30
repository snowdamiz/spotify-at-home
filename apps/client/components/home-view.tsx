'use client'

import { Heart, Music, Play, Plus, WifiOff } from 'lucide-react'
import { CoverArt } from '@/components/cover-art'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import { playlistSubtitle, type LibraryLoadStatus, type LibrarySummary, type ServerPlaylist } from '@/lib/api'
import { resolvePlaylistColor, type CollectionRef, type Song } from '@/lib/music-types'

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
    <div className="space-y-10 px-4 pb-8 md:px-6">
      {/* Greeting */}
      <header className="pt-2">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          {getGreeting()}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {libraryStatus === 'offline'
            ? 'Offline mode. Playing saved tracks and playlists from this device.'
            : 'Pick up where you left off.'}
        </p>
      </header>

      {/* Recently added */}
      {recent.length > 0 && (
        <section>
          <SectionHeader title="Recently added" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {recent.map((song) => (
              <button
                key={song.id}
                onClick={() => onPlay(song)}
                className="ov-card group rounded-xl p-3 text-left"
              >
                <div className="relative">
                  <CoverArt
                    colorClass={song.coverColor}
                    imageUrl={song.coverImageUrl}
                    title={song.title}
                    size="full"
                    rounded="md"
                  />
                  <div className="absolute right-2 bottom-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-xl shadow-black/40 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                    <Play
                      className="h-5 w-5 translate-x-px"
                      fill="currentColor"
                    />
                  </div>
                </div>
                <div className="mt-3 truncate text-sm font-semibold tracking-tight">
                  {song.title}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {song.artist}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Made for you */}
      <section>
        <SectionHeader title="Your collections" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <button
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className="ov-card group rounded-xl p-3 text-left"
          >
            <CoverArt
              colorClass="from-fuchsia-600 to-zinc-950"
              title="Liked Songs"
              size="full"
              rounded="md"
              icon={
                <Heart
                  className="h-[36%] w-[36%] text-foreground"
                  fill="currentColor"
                />
              }
            />
            <div className="mt-3 truncate text-sm font-semibold tracking-tight">
              Liked Songs
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {summary.counts.likedSongs}{' '}
              {summary.counts.likedSongs === 1 ? 'song' : 'songs'}
            </div>
          </button>
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpenCollection({ kind: 'playlist', id: p.id })}
              className="ov-card group rounded-xl p-3 text-left"
            >
              <CoverArt
                colorClass={resolvePlaylistColor(p.color, p.name)}
                title={p.name}
                size="full"
                rounded="md"
              />
              <div className="mt-3 truncate text-sm font-semibold tracking-tight">
                {p.name}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {p.description ?? playlistSubtitle(p)}
              </div>
            </button>
          ))}
        </div>
      </section>

      {libraryStatus === 'loading' ? (
        <EmptyState variant="section" title="Loading your library…" />
      ) : libraryStatus === 'offline' && songs.length === 0 ? (
        <EmptyState
          icon={<WifiOff className="h-5 w-5" />}
          title="No offline songs on this device"
          description="Reconnect, then sync songs in Settings to listen without a connection."
        />
      ) : libraryStatus === 'error' ? (
        <EmptyState
          variant="section"
          title="Couldn't reach the server."
          description="Check your connection and try again."
        />
      ) : songs.length === 0 ? (
        <EmptyState
          icon={<Music className="h-5 w-5" />}
          title="Your library is empty"
          description="Upload audio from your device to start listening."
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
      ) : null}
    </div>
  )
}
