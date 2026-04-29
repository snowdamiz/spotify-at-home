import type { ServerSong } from '@/lib/api'

export type SongSource = 'upload' | 'youtube' | 'soundcloud' | 'rumble' | 'url'

export type Song = {
  id: string
  title: string
  artist: string
  album?: string
  duration: number // seconds
  url: string // object URL from imported file; empty string for mock songs
  coverColor: string // tailwind gradient class for the artwork tile
  coverImageUrl?: string
  dateAdded: number
  liked?: boolean
  playlistIds?: string[]
  category?: string
  isMock?: boolean
  source?: SongSource
  sourceUrl?: string
  serverSong?: ServerSong
}

export type View = 'home' | 'search' | 'library' | 'settings' | 'admin'

export type Playlist = {
  id: string
  name: string
  description: string
  coverColor: string // tailwind gradient class
}

export type Category = {
  id: string
  name: string
  coverColor: string
}

// Featured playlists shown on Home / Sidebar.
export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: 'liked',
    name: 'Liked Songs',
    description: 'Everything you love, in one place.',
    coverColor: 'from-amber-400 to-orange-800',
  },
  {
    id: 'focus',
    name: 'Deep Focus',
    description: 'Keep calm and concentrate.',
    coverColor: 'from-zinc-700 to-zinc-950',
  },
  {
    id: 'chill',
    name: 'Chill Vibes',
    description: 'Wind down with the chillest beats.',
    coverColor: 'from-sky-700 to-indigo-950',
  },
  {
    id: 'workout',
    name: 'Workout Mix',
    description: 'High energy. Full power.',
    coverColor: 'from-orange-600 to-red-900',
  },
  {
    id: 'roadtrip',
    name: 'Road Trip',
    description: 'Songs for the open road.',
    coverColor: 'from-amber-500 to-rose-900',
  },
  {
    id: 'latenight',
    name: 'Late Night',
    description: 'For the after hours.',
    coverColor: 'from-fuchsia-800 to-zinc-950',
  },
]

// Browse categories shown on Search.
export const CATEGORIES: Category[] = [
  { id: 'pop', name: 'Pop', coverColor: 'from-pink-500 to-rose-800' },
  { id: 'hiphop', name: 'Hip-Hop', coverColor: 'from-amber-500 to-red-800' },
  { id: 'rock', name: 'Rock', coverColor: 'from-red-600 to-zinc-900' },
  { id: 'indie', name: 'Indie', coverColor: 'from-emerald-600 to-teal-900' },
  { id: 'electronic', name: 'Electronic', coverColor: 'from-cyan-500 to-blue-900' },
  { id: 'jazz', name: 'Jazz', coverColor: 'from-amber-700 to-orange-950' },
  { id: 'classical', name: 'Classical', coverColor: 'from-zinc-500 to-zinc-900' },
  { id: 'lofi', name: 'Lo-Fi', coverColor: 'from-fuchsia-700 to-indigo-950' },
]

const COVER_PALETTE = [
  'from-emerald-500 to-emerald-900',
  'from-sky-600 to-indigo-900',
  'from-rose-500 to-fuchsia-900',
  'from-amber-500 to-rose-900',
  'from-teal-500 to-emerald-900',
  'from-fuchsia-600 to-indigo-900',
  'from-orange-500 to-red-900',
  'from-cyan-500 to-blue-900',
]

export function pickCoverColor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return COVER_PALETTE[Math.abs(hash) % COVER_PALETTE.length]
}

// Server stores playlist `color` as either a tailwind gradient class
// ("from-emerald-500 to-emerald-900") or — for older rows — a raw hex like
// "#d97706" that the client can't render as a gradient. Use the stored value
// when it looks like a class; otherwise derive a deterministic gradient from
// the playlist name so the same playlist always paints the same color.
export function resolvePlaylistColor(
  storedColor: string | null | undefined,
  seed: string,
): string {
  if (storedColor && storedColor.startsWith('from-')) {
    return storedColor
  }
  return pickCoverColor(seed)
}

export function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ---------- Mock songs ----------
// These are demo tracks used to populate playlists and categories.
// They have no audio source; playback is simulated by the player UI.

type MockSeed = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  category: string
  playlistIds: string[]
}

const MOCK_SEEDS: MockSeed[] = [
  { id: 'm-1', title: 'Midnight Drive', artist: 'Neon Echo', album: 'Afterglow', duration: 213, category: 'electronic', playlistIds: ['latenight', 'roadtrip', 'liked'] },
  { id: 'm-2', title: 'Paper Planes', artist: 'The Lantern', album: 'Skyward', duration: 198, category: 'indie', playlistIds: ['chill', 'liked'] },
  { id: 'm-3', title: 'Golden Hour', artist: 'June & The Sky', album: 'Sunset Tape', duration: 245, category: 'indie', playlistIds: ['chill', 'roadtrip'] },
  { id: 'm-4', title: 'Ocean Eyes', artist: 'Lila Moon', album: 'Tideways', duration: 187, category: 'pop', playlistIds: ['liked', 'chill'] },
  { id: 'm-5', title: 'Cassette Heart', artist: 'Vinyl Ghosts', album: 'Replay', duration: 226, category: 'rock', playlistIds: ['roadtrip'] },
  { id: 'm-6', title: 'Quiet Storm', artist: 'Ash & Ember', album: 'Slowburn', duration: 254, category: 'jazz', playlistIds: ['focus', 'latenight'] },
  { id: 'm-7', title: 'Skyline', artist: 'The Otherwise', album: 'Citylights', duration: 201, category: 'rock', playlistIds: ['workout'] },
  { id: 'm-8', title: 'Lavender Haze', artist: 'Petra Vale', album: 'Bloom', duration: 189, category: 'pop', playlistIds: ['liked'] },
  { id: 'm-9', title: 'Echo Chamber', artist: 'Static Bloom', album: 'Frequencies', duration: 234, category: 'electronic', playlistIds: ['focus', 'workout'] },
  { id: 'm-10', title: 'Saturn Return', artist: 'Andromeda', album: 'Orbits', duration: 268, category: 'electronic', playlistIds: ['latenight'] },
  { id: 'm-11', title: 'Wildfire', artist: 'Foxgrove', album: 'Embers', duration: 212, category: 'rock', playlistIds: ['workout', 'roadtrip'] },
  { id: 'm-12', title: 'Slow Burn', artist: 'Holloway', album: 'Smoke Signals', duration: 198, category: 'indie', playlistIds: ['chill'] },
  { id: 'm-13', title: 'Daydream', artist: 'Pastel Wave', album: 'Soft Focus', duration: 176, category: 'lofi', playlistIds: ['focus', 'chill'] },
  { id: 'm-14', title: 'Velvet Sky', artist: 'Cleo Drake', album: 'Nocturne', duration: 221, category: 'jazz', playlistIds: ['latenight', 'liked'] },
  { id: 'm-15', title: 'Northern Lights', artist: 'Aurora Belle', album: 'Polaris', duration: 244, category: 'classical', playlistIds: ['focus'] },
  { id: 'm-16', title: 'Heartbeat City', artist: 'Civic Pulse', album: 'Metro', duration: 209, category: 'pop', playlistIds: ['workout', 'liked'] },
  { id: 'm-17', title: 'Coastal', artist: 'Salt & Pine', album: 'Driftwood', duration: 192, category: 'indie', playlistIds: ['roadtrip', 'chill'] },
  { id: 'm-18', title: 'Afterglow', artist: 'Marlow', album: 'Embers II', duration: 230, category: 'pop', playlistIds: ['liked'] },
  { id: 'm-19', title: 'Underground', artist: 'Block Party', album: 'Concrete', duration: 218, category: 'hiphop', playlistIds: ['workout'] },
  { id: 'm-20', title: 'City Lights', artist: 'Mira Sound', album: 'Skyline', duration: 205, category: 'hiphop', playlistIds: ['workout', 'liked'] },
  { id: 'm-21', title: 'Cloud Nine', artist: 'Hush Parade', album: 'Drift', duration: 223, category: 'lofi', playlistIds: ['focus', 'latenight'] },
  { id: 'm-22', title: 'Rainfall', artist: 'Atlas Quartet', album: 'Movements', duration: 261, category: 'classical', playlistIds: ['focus'] },
]

export const MOCK_SONGS: Song[] = MOCK_SEEDS.map((s) => ({
  id: s.id,
  title: s.title,
  artist: s.artist,
  album: s.album,
  duration: s.duration,
  url: '',
  coverColor: pickCoverColor(s.title + s.artist),
  dateAdded: 0,
  playlistIds: s.playlistIds,
  category: s.category,
  isMock: true,
}))

export function getSongsForPlaylist(playlistId: string): Song[] {
  return MOCK_SONGS.filter((s) => s.playlistIds?.includes(playlistId))
}

export function getSongsForCategory(categoryId: string): Song[] {
  return MOCK_SONGS.filter((s) => s.category === categoryId)
}

export type CollectionRef =
  | { kind: 'playlist'; id: string }
  | { kind: 'system'; id: 'liked-songs' }
  | { kind: 'category'; id: string }

export function getCollectionMeta(ref: CollectionRef) {
  if (ref.kind === 'playlist') {
    const p = MOCK_PLAYLISTS.find((x) => x.id === ref.id)
    if (!p) return null
    return {
      title: p.name,
      subtitle: p.description,
      coverColor: p.coverColor,
      kindLabel: 'Playlist',
      songs: getSongsForPlaylist(p.id),
    }
  }
  const c = CATEGORIES.find((x) => x.id === ref.id)
  if (!c) return null
  return {
    title: c.name,
    subtitle: `Top ${c.name.toLowerCase()} tracks for you.`,
    coverColor: c.coverColor,
    kindLabel: 'Genre',
    songs: getSongsForCategory(c.id),
  }
}
