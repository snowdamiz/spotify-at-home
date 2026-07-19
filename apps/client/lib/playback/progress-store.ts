'use client'

import { useSyncExternalStore } from 'react'

// Playback position ticks ~4×/second. Keeping it in React state at the app
// root re-renders the entire tree on every tick, so it lives in a tiny
// external store that only the player surfaces subscribe to.

export type PlaybackProgress = {
  duration: number
  position: number
}

export type PlaybackProgressStore = {
  get: () => PlaybackProgress
  set: (update: Partial<PlaybackProgress>) => void
  reset: () => void
  subscribe: (listener: () => void) => () => void
}

const INITIAL_PROGRESS: PlaybackProgress = { duration: 0, position: 0 }

export function createPlaybackProgressStore(): PlaybackProgressStore {
  let state = INITIAL_PROGRESS
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) listener()
  }

  return {
    get: () => state,
    reset: () => {
      if (state.duration === 0 && state.position === 0) return
      state = INITIAL_PROGRESS
      notify()
    },
    set: (update) => {
      const duration = update.duration ?? state.duration
      const position = update.position ?? state.position

      if (duration === state.duration && position === state.position) return

      state = { duration, position }
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const playbackProgressStore = createPlaybackProgressStore()

export function usePlaybackProgress(
  store: PlaybackProgressStore = playbackProgressStore,
) {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
