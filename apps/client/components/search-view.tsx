'use client'

import { useMemo, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { CoverArt } from '@/components/cover-art'
import { SongRow } from '@/components/song-row'
import { playlistSubtitle, serverSongToSong } from '@/lib/api'
import { useLibrarySearch } from '@/lib/library-hooks'
import {
  CATEGORIES,
  type CollectionRef,
  type Song,
} from '@/lib/music-types'

type SearchViewProps = {
  songs: Song[]
  currentSongId: string | null
  isPlaying: boolean
  onPlay: (song: Song, queue: Song[]) => void
  onOpenCollection: (ref: CollectionRef) => void
}

export function SearchView({
  songs,
  currentSongId,
  isPlaying,
  onPlay,
  onOpenCollection,
}: SearchViewProps) {
  const [query, setQuery] = useState('')
  const search = useLibrarySearch(query)

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const serverMatches = search.results.songs.map(serverSongToSong)
    const knownIds = new Set(serverMatches.map((song) => song.id))
    const localMatches = songs.filter((song) => !knownIds.has(song.id))

    return [...serverMatches, ...localMatches]
  }, [query, search.results.songs, songs])

  return (
    <div className="px-4 pb-6 md:px-6">
      <header className="pt-2 pb-4">
        <h1 className="mb-3 text-2xl font-bold tracking-tight md:text-3xl">
          Search
        </h1>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Songs, artists, or genres"
            className="h-11 w-full rounded-full bg-card pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Search"
          />
        </div>
      </header>

      {query.trim() ? (
        search.status === 'loading' ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Searching your server library...
          </div>
        ) : search.status === 'error' ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Could not reach the Tunely server.
          </div>
        ) : search.status === 'anonymous' ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Log in to search imported songs and playlists.
          </div>
        ) : matches.length > 0 || search.results.playlists.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Results
            </h2>
            <ul className="space-y-1">
              {search.results.playlists.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenCollection({ kind: 'playlist', id: playlist.id })
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card/80"
                  >
                    <CoverArt
                      colorClass={playlist.color ?? 'from-zinc-700 to-zinc-950'}
                      title={playlist.name}
                      size="md"
                      rounded="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {playlist.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        Playlist &middot; {playlistSubtitle(playlist)}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
              {matches.map((song) => (
                <li key={song.id}>
                  <SongRow
                    song={song}
                    isActive={currentSongId === song.id}
                    isPlaying={isPlaying && currentSongId === song.id}
                    onPlay={() => onPlay(song, matches)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No songs match &ldquo;{query}&rdquo;.
          </div>
        )
      ) : (
        <>
          <h2 className="mb-3 text-lg font-bold tracking-tight">Browse all</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() =>
                  onOpenCollection({ kind: 'category', id: cat.id })
                }
                className={`group relative aspect-[16/10] overflow-hidden rounded-lg bg-gradient-to-br ${cat.coverColor} p-3 text-left transition-transform hover:-translate-y-0.5`}
              >
                <span className="text-base font-bold text-foreground">
                  {cat.name}
                </span>
                <CoverArt
                  colorClass={cat.coverColor}
                  title={cat.name}
                  className="absolute -right-3 -bottom-3 h-16 w-16 rotate-[20deg] rounded-md shadow-lg"
                  rounded="md"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
