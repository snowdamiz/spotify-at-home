import { describe, expect, it, vi } from 'vitest'
import { createPlaybackProgressStore } from '@/lib/playback/progress-store'

describe('createPlaybackProgressStore', () => {
  it('starts at zero', () => {
    const store = createPlaybackProgressStore()

    expect(store.get()).toEqual({ duration: 0, position: 0 })
  })

  it('merges partial updates and notifies subscribers', () => {
    const store = createPlaybackProgressStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set({ position: 12.5 })
    store.set({ duration: 200 })

    expect(store.get()).toEqual({ duration: 200, position: 12.5 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps snapshots stable between updates for useSyncExternalStore', () => {
    const store = createPlaybackProgressStore()

    store.set({ position: 3 })
    const first = store.get()
    const second = store.get()

    expect(first).toBe(second)
  })

  it('does not notify when nothing changed', () => {
    const store = createPlaybackProgressStore()
    const listener = vi.fn()
    store.set({ duration: 100, position: 5 })
    store.subscribe(listener)

    store.set({ duration: 100, position: 5 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const store = createPlaybackProgressStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.set({ position: 9 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('resets both values at once', () => {
    const store = createPlaybackProgressStore()
    store.set({ duration: 100, position: 42 })

    store.reset()

    expect(store.get()).toEqual({ duration: 0, position: 0 })
  })
})
