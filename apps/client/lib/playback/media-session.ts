// Thin, defensive wrapper around the Media Session API. Keeping the OS
// informed about the current track and wiring lock-screen/notification
// controls is what lets a PWA keep its audio session alive in the
// background, so every call here must be safe on browsers with partial
// or missing support.

export type MediaSessionLike = {
  metadata: unknown
  playbackState: 'none' | 'paused' | 'playing'
  setActionHandler(
    action: string,
    handler: ((details?: { seekTime?: number | null }) => void) | null,
  ): void
  setPositionState?(state?: {
    duration?: number
    playbackRate?: number
    position?: number
  }): void
}

export type MediaSessionTrack = {
  title: string
  artist: string
  album?: string
  artworkUrl?: string
}

export type MediaSessionHandlers = {
  onPlay: () => void
  onPause: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (seconds: number) => void
}

const HANDLED_ACTIONS = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
] as const

export function getNavigatorMediaSession(): MediaSessionLike | null {
  if (typeof navigator === 'undefined') return null
  return 'mediaSession' in navigator
    ? (navigator.mediaSession as unknown as MediaSessionLike)
    : null
}

export function registerMediaSessionHandlers(
  session: MediaSessionLike,
  handlers: MediaSessionHandlers,
): () => void {
  const bindings: Array<
    [string, (details?: { seekTime?: number | null }) => void]
  > = [
    ['play', () => handlers.onPlay()],
    ['pause', () => handlers.onPause()],
    ['previoustrack', () => handlers.onPrev()],
    ['nexttrack', () => handlers.onNext()],
    [
      'seekto',
      (details) => {
        const seekTime = details?.seekTime
        if (typeof seekTime === 'number' && Number.isFinite(seekTime)) {
          handlers.onSeek(seekTime)
        }
      },
    ],
  ]

  for (const [action, handler] of bindings) {
    trySetActionHandler(session, action, handler)
  }

  return () => {
    for (const action of HANDLED_ACTIONS) {
      trySetActionHandler(session, action, null)
    }
  }
}

export function applyMediaSessionMetadata(
  session: MediaSessionLike,
  track: MediaSessionTrack | null,
  createMetadata: (init: {
    album: string
    artist: string
    artwork: Array<{ src: string }>
    title: string
  }) => unknown,
) {
  if (!track) {
    session.metadata = null
    return
  }

  try {
    session.metadata = createMetadata({
      album: track.album ?? '',
      artist: track.artist,
      artwork: track.artworkUrl ? [{ src: track.artworkUrl }] : [],
      title: track.title,
    })
  } catch {
    // MediaMetadata may reject artwork URLs it cannot parse — playback
    // must not care.
  }
}

export function updateMediaSessionPlaybackState(
  session: MediaSessionLike,
  isPlaying: boolean,
) {
  session.playbackState = isPlaying ? 'playing' : 'paused'
}

export function updateMediaSessionPositionState(
  session: MediaSessionLike,
  state: { duration: number; position: number; playbackRate?: number },
) {
  if (!session.setPositionState) return
  // Zero duration means metadata has not loaded yet; browsers reject it.
  if (!Number.isFinite(state.duration) || state.duration <= 0) return

  const position = Math.min(Math.max(state.position, 0), state.duration)

  try {
    session.setPositionState({
      duration: state.duration,
      playbackRate: state.playbackRate ?? 1,
      position,
    })
  } catch {
    // Some browsers throw on positions they consider stale — ignore.
  }
}

function trySetActionHandler(
  session: MediaSessionLike,
  action: string,
  handler: ((details?: { seekTime?: number | null }) => void) | null,
) {
  try {
    session.setActionHandler(action, handler)
  } catch {
    // The browser does not support this action — fine.
  }
}
