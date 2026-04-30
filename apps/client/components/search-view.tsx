'use client'

import { useMemo, useState } from 'react'
import { Heart, Music2, Plus, Search as SearchIcon, WifiOff } from 'lucide-react'
import { CoverArt } from '@/components/cover-art'
import { SongRow } from '@/components/song-row'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import {
  playlistSubtitle,
  serverSongToSong,
  type LibraryLoadStatus,
  type ServerPlaylist,
} from '@/lib/api'
import { useLibrarySearch } from '@/lib/library-hooks'
import {
  pickCoverColor,
  resolvePlaylistColor,
  type CollectionRef,
  type Song,
} from '@/lib/music-types'
import type { OfflineAudioStateMap } from '@/lib/offline-audio-cache'

type SearchViewProps = {
  songs: Song[]
  playlists?: ServerPlaylist[]
  currentSongId: string | null
  isPlaying: boolean
  offlineAudio: OfflineAudioStateMap
  libraryStatus?: LibraryLoadStatus
  revision: number
  onPlay: (song: Song, queue: Song[]) => void
  onToggleSongLike?: (song: Song) => void
  onToggleSongOffline: (song: Song) => void
  onDeleteSong: (song: Song) => void
  onAddSongToPlaylist?: (song: Song, playlistId: string) => void
  onCreatePlaylistWithSong?: (song: Song) => void
  deletingSongId: string | null
  likingSongId?: string | null
  onOpenCollection: (ref: CollectionRef) => void
  onImportClick?: () => void
}

type BrowseCard = {
  id: string
  coverColor: string
  label: string
  subtitle: string
  action:
    | { kind: 'collection'; ref: CollectionRef }
    | { kind: 'query'; query: string }
}

const MAX_BROWSE_CARDS = 8

export function SearchView({
  songs,
  playlists,
  currentSongId,
  isPlaying,
  offlineAudio,
  libraryStatus,
  revision,
  onPlay,
  onToggleSongLike,
  onToggleSongOffline,
  onDeleteSong,
  onAddSongToPlaylist,
  onCreatePlaylistWithSong,
  deletingSongId,
  likingSongId,
  onOpenCollection,
  onImportClick,
}: SearchViewProps) {
  const [query, setQuery] = useState('')
  const search = useLibrarySearch(query, revision)
  const browseCards = useMemo(() => buildBrowseCards(songs), [songs])
  const isOffline = libraryStatus === 'offline'

  const matches = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) return []

    const songsById = new Map(songs.map((song) => [song.id, song]))
    const serverMatches = search.results.songs.map(
      (serverSong) => songsById.get(serverSong.id) ?? serverSongToSong(serverSong),
    )
    const knownIds = new Set(serverMatches.map((song) => song.id))
    const localMatches = songs.filter(
      (song) =>
        !knownIds.has(song.id) &&
        (song.title.toLowerCase().includes(trimmedQuery) ||
          song.artist.toLowerCase().includes(trimmedQuery) ||
          song.album?.toLowerCase().includes(trimmedQuery)),
    )

    return [...serverMatches, ...localMatches]
  }, [query, search.results.songs, songs])

  const playlistMatches = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) return []

    const serverMatches = search.results.playlists
    const knownIds = new Set(serverMatches.map((playlist) => playlist.id))
    const localMatches = (playlists ?? []).filter(
      (playlist) =>
        !knownIds.has(playlist.id) &&
        (playlist.name.toLowerCase().includes(trimmedQuery) ||
          playlist.description?.toLowerCase().includes(trimmedQuery)),
    )

    return [...serverMatches, ...localMatches]
  }, [playlists, query, search.results.playlists])

  const openBrowseCard = (card: BrowseCard) => {
    if (card.action.kind === 'collection') {
      onOpenCollection(card.action.ref)
      return
    }

    setQuery(card.action.query)
  }

  return (
    <div className="px-4 pb-8 md:px-6">
      <header className="pt-2 pb-5">
        <h1 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
          Search
        </h1>
        <div className="relative md:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Songs, artists, or genres"
            className="h-11 w-full rounded-full bg-card/70 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:bg-card focus:outline-none focus:ring-1 focus:ring-foreground/20"
            aria-label="Search"
          />
        </div>
      </header>

      {query.trim() ? (
        matches.length === 0 &&
        playlistMatches.length === 0 &&
        isOffline ? (
          <EmptyState
            variant="section"
            title={`No saved songs or playlists match "${query}".`}
            description="Search is limited to offline library items until you reconnect."
          />
        ) : matches.length === 0 &&
        playlistMatches.length === 0 &&
        search.status === 'loading' ? (
          <EmptyState variant="section" title="Searching your library…" />
        ) : matches.length === 0 &&
          playlistMatches.length === 0 &&
          search.status === 'error' ? (
          <EmptyState
            variant="section"
            title="Couldn't reach the server."
            description="Check your connection and try again."
          />
        ) : matches.length === 0 &&
          playlistMatches.length === 0 &&
          search.status === 'anonymous' ? (
          <EmptyState
            variant="section"
            title="Log in to search imported songs and playlists."
          />
        ) : matches.length > 0 || playlistMatches.length > 0 ? (
          <section>
            <SectionHeader title="Results" size="sm" className="mb-2" />
            <ul className="space-y-1">
              {playlistMatches.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenCollection({ kind: 'playlist', id: playlist.id })
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card/60"
                  >
                    <CoverArt
                      colorClass={resolvePlaylistColor(playlist.color, playlist.name)}
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
                    offlineState={offlineAudio[song.id]}
                    onPlay={() => onPlay(song, matches)}
                    onToggleLike={
                      onToggleSongLike ? () => onToggleSongLike(song) : undefined
                    }
                    onToggleOffline={() => onToggleSongOffline(song)}
                    onDelete={() => onDeleteSong(song)}
                    isDeleting={deletingSongId === song.id}
                    isLiking={likingSongId === song.id}
                    playlists={playlists}
                    onAddToPlaylist={
                      onAddSongToPlaylist
                        ? (playlistId) => onAddSongToPlaylist(song, playlistId)
                        : undefined
                    }
                    onCreatePlaylistWithSong={
                      onCreatePlaylistWithSong
                        ? () => onCreatePlaylistWithSong(song)
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <EmptyState
            variant="section"
            title={`No songs match "${query}".`}
          />
        )
      ) : (
        <>
          <SectionHeader title="Browse your library" />
          {browseCards.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {browseCards.map((card) => (
                <BrowseCardTile
                  key={card.id}
                  card={card}
                  onClick={() => openBrowseCard(card)}
                />
              ))}
            </div>
          ) : isOffline ? (
            <EmptyState
              icon={<WifiOff className="h-5 w-5" />}
              title="No offline songs on this device"
              description="Reconnect, then sync songs in Settings to search them offline."
            />
          ) : (
            <EmptyState
              icon={<Music2 className="h-5 w-5" />}
              title="Add music to build browse shortcuts"
              description="Artists and albums from your library will appear here."
              action={
                onImportClick ? (
                  <Button
                    onClick={onImportClick}
                    className="h-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add music
                  </Button>
                ) : undefined
              }
            />
          )}

          {songs.length > 0 && (
            <section className="mt-8">
              <SectionHeader title="Your songs" size="sm" className="mb-2" />
              <ul className="space-y-1">
                {songs.map((song) => (
                  <li key={song.id}>
                    <SongRow
                      song={song}
                      isActive={currentSongId === song.id}
                      isPlaying={isPlaying && currentSongId === song.id}
                      offlineState={offlineAudio[song.id]}
                      onPlay={() => onPlay(song, songs)}
                      onToggleLike={
                        onToggleSongLike ? () => onToggleSongLike(song) : undefined
                      }
                      onToggleOffline={() => onToggleSongOffline(song)}
                      onDelete={() => onDeleteSong(song)}
                      isDeleting={deletingSongId === song.id}
                      isLiking={likingSongId === song.id}
                      playlists={playlists}
                      onAddToPlaylist={
                        onAddSongToPlaylist
                          ? (playlistId) =>
                              onAddSongToPlaylist(song, playlistId)
                          : undefined
                      }
                      onCreatePlaylistWithSong={
                        onCreatePlaylistWithSong
                          ? () => onCreatePlaylistWithSong(song)
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function BrowseCardTile({
  card,
  onClick,
}: {
  card: BrowseCard
  onClick: () => void
}) {
  const isLiked = card.id === 'liked-songs'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative aspect-[5/3] overflow-hidden rounded-xl bg-gradient-to-br ${card.coverColor} p-4 text-left shadow-md shadow-black/20 outline-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/30 focus-visible:ring-2 focus-visible:ring-ring/70`}
      aria-label={`${card.label} — ${card.subtitle}`}
    >
      {/* Subtle dark sheen at the bottom for legibility behind text */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-transparent"
      />

      {/* Rotated decorative tile — bottom-right */}
      <span
        aria-hidden
        className="absolute -right-3 -bottom-3 flex h-20 w-20 rotate-[22deg] items-center justify-center rounded-lg bg-black/30 shadow-xl shadow-black/40 ring-1 ring-white/15 transition-transform duration-300 ease-out group-hover:rotate-[26deg] group-hover:scale-105"
      >
        {isLiked ? (
          <Heart
            className="h-8 w-8 text-white/95 drop-shadow"
            fill="currentColor"
          />
        ) : (
          <Music2
            className="h-7 w-7 text-white/85 drop-shadow"
            strokeWidth={1.75}
          />
        )}
      </span>

      {/* Foreground content */}
      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="min-w-0 pr-16">
          <div className="line-clamp-2 text-base font-extrabold leading-tight tracking-tight text-white drop-shadow">
            {card.label}
          </div>
          <div className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75 drop-shadow">
            {card.subtitle}
          </div>
        </div>
      </div>

      {/* Hover wash */}
      <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
    </button>
  )
}

function buildBrowseCards(songs: Song[]): BrowseCard[] {
  const cards: BrowseCard[] = []
  const likedCount = songs.filter(isLikedSong).length

  if (likedCount > 0) {
    cards.push({
      action: {
        kind: 'collection',
        ref: { kind: 'system', id: 'liked-songs' },
      },
      coverColor: 'from-fuchsia-600 to-zinc-950',
      id: 'liked-songs',
      label: 'Liked Songs',
      subtitle: songCountLabel(likedCount),
    })
  }

  for (const [artist, count] of topCounts(
    songs.map((song) => normalizeBrowseLabel(song.artist)),
  )) {
    cards.push({
      action: { kind: 'query', query: artist },
      coverColor: pickCoverColor(`artist:${artist}`),
      id: `artist:${artist}`,
      label: artist,
      subtitle: `${songCountLabel(count)} by artist`,
    })

    if (cards.length >= MAX_BROWSE_CARDS) {
      break
    }
  }

  if (cards.length < MAX_BROWSE_CARDS) {
    for (const [album, count] of topCounts(
      songs.map((song) => normalizeAlbumLabel(song.album)),
    )) {
      cards.push({
        action: { kind: 'query', query: album },
        coverColor: pickCoverColor(`album:${album}`),
        id: `album:${album}`,
        label: album,
        subtitle: `${songCountLabel(count)} from album`,
      })

      if (cards.length >= MAX_BROWSE_CARDS) {
        break
      }
    }
  }

  if (cards.length < MAX_BROWSE_CARDS) {
    for (const song of [...songs]
      .sort((a, b) => b.dateAdded - a.dateAdded)
      .slice(0, MAX_BROWSE_CARDS)) {
      if (cards.some((card) => card.id === `song:${song.id}`)) {
        continue
      }

      cards.push({
        action: { kind: 'query', query: song.title },
        coverColor: song.coverColor,
        id: `song:${song.id}`,
        label: song.title,
        subtitle: song.artist,
      })

      if (cards.length >= MAX_BROWSE_CARDS) {
        break
      }
    }
  }

  return cards.slice(0, MAX_BROWSE_CARDS)
}

function topCounts(labels: Array<string | null>): Array<[string, number]> {
  const counts = new Map<string, number>()

  for (const label of labels) {
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return [...counts.entries()].sort(
    ([leftLabel, leftCount], [rightLabel, rightCount]) =>
      rightCount - leftCount || leftLabel.localeCompare(rightLabel),
  )
}

function normalizeBrowseLabel(label: string | null | undefined) {
  const normalized = label?.trim()
  if (!normalized || normalized === 'Imported song') return null
  return normalized
}

function normalizeAlbumLabel(label: string | null | undefined) {
  const normalized = normalizeBrowseLabel(label)
  if (!normalized) return null

  if (/^Imported from .+\.(csv|json|txt|xml)$/i.test(normalized)) {
    return null
  }

  return normalized
}

function isLikedSong(song: Song) {
  return Boolean(song.serverSong?.liked ?? song.liked)
}

function songCountLabel(count: number) {
  return `${count} ${count === 1 ? 'song' : 'songs'}`
}
