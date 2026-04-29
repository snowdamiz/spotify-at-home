import type { SongSource } from './music-types'

export function isLikelyUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  try {
    // Allow paste without protocol
    const withProtocol = v.startsWith('http') ? v : `https://${v}`
    const u = new URL(withProtocol)
    return !!u.hostname && u.hostname.includes('.')
  } catch {
    return false
  }
}

export function isLikelyYouTubeUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return false

  try {
    const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(v)
      ? v
      : `https://${v}`
    const hostname = new URL(withProtocol).hostname
      .toLowerCase()
      .replace(/^www\./, '')

    return (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com' ||
      hostname === 'youtu.be'
    )
  } catch {
    return false
  }
}

export function detectPlatform(url: string): SongSource {
  const v = url.trim().toLowerCase()
  if (!v) return 'url'
  if (
    v.includes('youtube.com') ||
    v.includes('youtu.be') ||
    v.includes('music.youtube.com')
  ) {
    return 'youtube'
  }
  if (v.includes('soundcloud.com')) return 'soundcloud'
  if (v.includes('rumble.com')) return 'rumble'
  return 'url'
}

const FAKE_TITLES = [
  'Sunset Boulevard',
  'Neon Skyline',
  'Coastal Drift',
  'Paper Lanterns',
  'Velvet Mornings',
  'Echoes in Blue',
  'Static Garden',
  'Slow Parade',
  'Marble Halls',
  'Glass Horizon',
]

const FAKE_ARTISTS = [
  'Blue Static',
  'Marlow',
  'Hush Parade',
  'The Otherwise',
  'Atlas Quartet',
  'Lila Moon',
  'Civic Pulse',
  'Foxgrove',
  'Petra Vale',
  'Andromeda',
]

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function titleCase(s: string) {
  return s
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Best-effort metadata extraction for the mock download.
 * Tries to parse useful pieces from the URL path; falls back to deterministic
 * fake names so each unique URL produces a stable, plausible result.
 */
export function mockMetadataFromUrl(url: string): {
  title: string
  artist: string
  duration: number
  platform: SongSource
} {
  const platform = detectPlatform(url)
  const seed = hash(url)
  const fallbackTitle = FAKE_TITLES[seed % FAKE_TITLES.length]
  const fallbackArtist = FAKE_ARTISTS[seed % FAKE_ARTISTS.length]
  const duration = 150 + (seed % 150) // 2:30 – 5:00

  let title = fallbackTitle
  let artist = fallbackArtist

  try {
    const withProtocol = url.startsWith('http') ? url : `https://${url}`
    const u = new URL(withProtocol)
    const parts = u.pathname.split('/').filter(Boolean)

    if (platform === 'soundcloud' && parts.length >= 2) {
      // soundcloud.com/{artist}/{track}
      artist = titleCase(parts[0]) || fallbackArtist
      title = titleCase(parts[1]) || fallbackTitle
    } else if (platform === 'rumble' && parts.length >= 1) {
      // rumble.com/v{id}-some-slug.html
      const slug = parts[parts.length - 1]
        .replace(/^v[a-z0-9]+-/, '')
        .replace(/\.html?$/, '')
      title = titleCase(slug) || fallbackTitle
    } else if (platform === 'youtube') {
      // No reliable metadata from a YouTube URL alone — keep fakes.
      title = fallbackTitle
      artist = fallbackArtist
    } else if (parts.length > 0) {
      const slug = parts[parts.length - 1].replace(/\.[a-z0-9]+$/, '')
      const guessed = titleCase(slug)
      if (guessed.length > 2) title = guessed
      const host = u.hostname.replace(/^www\./, '').split('.')[0]
      if (host) artist = titleCase(host)
    }
  } catch {
    // ignore parsing errors and use fallbacks
  }

  return { title, artist, duration, platform }
}
