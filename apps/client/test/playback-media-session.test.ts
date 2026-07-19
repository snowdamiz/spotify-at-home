import { describe, expect, it, vi } from 'vitest'
import {
  applyMediaSessionMetadata,
  registerMediaSessionHandlers,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
  type MediaSessionLike,
} from '@/lib/playback/media-session'

function createFakeSession(overrides: Partial<MediaSessionLike> = {}) {
  const handlers = new Map<string, (() => void) | null>()
  const session: MediaSessionLike & {
    handlers: Map<string, ((details?: unknown) => void) | null>
  } = {
    handlers,
    metadata: null,
    playbackState: 'none',
    setActionHandler(action, handler) {
      handlers.set(action, handler)
    },
    setPositionState: vi.fn(),
    ...overrides,
  }
  return session
}

describe('registerMediaSessionHandlers', () => {
  it('registers handlers for the core playback actions', () => {
    const session = createFakeSession()
    const callbacks = {
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
      onPrev: vi.fn(),
      onSeek: vi.fn(),
    }

    registerMediaSessionHandlers(session, callbacks)

    session.handlers.get('play')?.()
    session.handlers.get('pause')?.()
    session.handlers.get('nexttrack')?.()
    session.handlers.get('previoustrack')?.()

    expect(callbacks.onPlay).toHaveBeenCalledTimes(1)
    expect(callbacks.onPause).toHaveBeenCalledTimes(1)
    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
    expect(callbacks.onPrev).toHaveBeenCalledTimes(1)
  })

  it('routes seekto action details to onSeek', () => {
    const session = createFakeSession()
    const onSeek = vi.fn()

    registerMediaSessionHandlers(session, {
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
      onPrev: vi.fn(),
      onSeek,
    })

    session.handlers.get('seekto')?.({ seekTime: 42.5 })

    expect(onSeek).toHaveBeenCalledWith(42.5)
  })

  it('keeps registering when the browser rejects an action name', () => {
    const session = createFakeSession()
    const original = session.setActionHandler.bind(session)
    session.setActionHandler = (action, handler) => {
      if (action === 'seekto') {
        throw new TypeError('unsupported action')
      }
      original(action, handler)
    }
    const callbacks = {
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
      onPrev: vi.fn(),
      onSeek: vi.fn(),
    }

    expect(() => registerMediaSessionHandlers(session, callbacks)).not.toThrow()

    session.handlers.get('nexttrack')?.()
    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
  })

  it('returns a cleanup that clears the registered handlers', () => {
    const session = createFakeSession()
    const cleanup = registerMediaSessionHandlers(session, {
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
      onPrev: vi.fn(),
      onSeek: vi.fn(),
    })

    cleanup()

    expect(session.handlers.get('play')).toBeNull()
    expect(session.handlers.get('nexttrack')).toBeNull()
    expect(session.handlers.get('seekto')).toBeNull()
  })
})

describe('applyMediaSessionMetadata', () => {
  it('builds metadata from the track via the injected factory', () => {
    const session = createFakeSession()
    const createMetadata = vi.fn((init: unknown) => ({ init }))

    applyMediaSessionMetadata(
      session,
      {
        album: 'Afterglow',
        artist: 'Neon Echo',
        artworkUrl: 'https://cdn.example/cover.jpg',
        title: 'Midnight Drive',
      },
      createMetadata,
    )

    expect(createMetadata).toHaveBeenCalledWith({
      album: 'Afterglow',
      artist: 'Neon Echo',
      artwork: [{ src: 'https://cdn.example/cover.jpg' }],
      title: 'Midnight Drive',
    })
    expect(session.metadata).toEqual({
      init: {
        album: 'Afterglow',
        artist: 'Neon Echo',
        artwork: [{ src: 'https://cdn.example/cover.jpg' }],
        title: 'Midnight Drive',
      },
    })
  })

  it('omits artwork when the track has no cover image', () => {
    const session = createFakeSession()
    const createMetadata = vi.fn((init: unknown) => ({ init }))

    applyMediaSessionMetadata(
      session,
      { artist: 'Neon Echo', title: 'Midnight Drive' },
      createMetadata,
    )

    expect(createMetadata).toHaveBeenCalledWith({
      album: '',
      artist: 'Neon Echo',
      artwork: [],
      title: 'Midnight Drive',
    })
  })

  it('clears metadata when no track is playing', () => {
    const session = createFakeSession()
    session.metadata = { some: 'value' }

    applyMediaSessionMetadata(session, null, vi.fn())

    expect(session.metadata).toBeNull()
  })
})

describe('updateMediaSessionPlaybackState', () => {
  it('mirrors playing and paused states', () => {
    const session = createFakeSession()

    updateMediaSessionPlaybackState(session, true)
    expect(session.playbackState).toBe('playing')

    updateMediaSessionPlaybackState(session, false)
    expect(session.playbackState).toBe('paused')
  })
})

describe('updateMediaSessionPositionState', () => {
  it('reports duration, clamped position, and playback rate', () => {
    const session = createFakeSession()

    updateMediaSessionPositionState(session, {
      duration: 200,
      position: 250,
    })

    expect(session.setPositionState).toHaveBeenCalledWith({
      duration: 200,
      playbackRate: 1,
      position: 200,
    })
  })

  it('skips when duration is not a finite positive number', () => {
    const session = createFakeSession()

    updateMediaSessionPositionState(session, {
      duration: Number.NaN,
      position: 10,
    })
    updateMediaSessionPositionState(session, {
      duration: Number.POSITIVE_INFINITY,
      position: 10,
    })
    // Browsers reject a zero duration, and it fires on every early
    // timeupdate before metadata loads — must be skipped, not thrown.
    updateMediaSessionPositionState(session, {
      duration: 0,
      position: 0,
    })

    expect(session.setPositionState).not.toHaveBeenCalled()
  })

  it('never throws when the browser rejects the position state', () => {
    const session = createFakeSession({
      setPositionState: () => {
        throw new TypeError('bad state')
      },
    })

    expect(() =>
      updateMediaSessionPositionState(session, {
        duration: 100,
        position: 10,
      }),
    ).not.toThrow()
  })

  it('ignores sessions without setPositionState support', () => {
    const session = createFakeSession({ setPositionState: undefined })

    expect(() =>
      updateMediaSessionPositionState(session, {
        duration: 100,
        position: 10,
      }),
    ).not.toThrow()
  })
})
