export type RepeatMode = 'off' | 'all' | 'one'

export type QueueTrack = { id: string }

export type NextTrackResult<T extends QueueTrack> =
  | { action: 'play'; song: T }
  | { action: 'stop' }
  | { action: 'none' }

export type PrevTrackResult<T extends QueueTrack> =
  | { action: 'play'; song: T }
  | { action: 'none' }

// Pure queue-advance rules shared by the UI buttons, the media-session
// handlers, and the audio `ended` handler. Repeat "one" is resolved by the
// caller before asking for the next track, so here it behaves like "all".
export function selectNextTrack<T extends QueueTrack>(
  list: T[],
  currentId: string | null,
  repeatMode: RepeatMode,
): NextTrackResult<T> {
  if (list.length === 0) return { action: 'none' }

  const idx = currentId ? list.findIndex((song) => song.id === currentId) : -1

  if (idx === -1) {
    // The current song left the queue (deleted, playlist edited, …) —
    // restart from the top instead of dead-ending playback.
    return { action: 'play', song: list[0] }
  }

  const isLast = idx === list.length - 1

  if (isLast && repeatMode === 'off') {
    return { action: 'stop' }
  }

  return { action: 'play', song: list[(idx + 1) % list.length] }
}

export function selectPrevTrack<T extends QueueTrack>(
  list: T[],
  currentId: string | null,
): PrevTrackResult<T> {
  if (list.length === 0) return { action: 'none' }

  const idx = currentId ? list.findIndex((song) => song.id === currentId) : -1

  if (idx === -1) {
    return { action: 'play', song: list[0] }
  }

  return { action: 'play', song: list[(idx - 1 + list.length) % list.length] }
}
