import { describe, expect, it } from 'vitest'
import {
  selectNextTrack,
  selectPrevTrack,
} from '@/lib/playback/queue'

const track = (id: string) => ({ id, title: `Track ${id}` })

const list = [track('a'), track('b'), track('c')]

describe('selectNextTrack', () => {
  it('advances to the next song in order', () => {
    expect(selectNextTrack(list, 'a', 'off')).toEqual({
      action: 'play',
      song: list[1],
    })
    expect(selectNextTrack(list, 'b', 'off')).toEqual({
      action: 'play',
      song: list[2],
    })
  })

  it('stops at the end of the queue when repeat is off', () => {
    expect(selectNextTrack(list, 'c', 'off')).toEqual({ action: 'stop' })
  })

  it('wraps to the first song when repeat is all', () => {
    expect(selectNextTrack(list, 'c', 'all')).toEqual({
      action: 'play',
      song: list[0],
    })
  })

  it('treats repeat one like repeat all for explicit skips', () => {
    expect(selectNextTrack(list, 'c', 'one')).toEqual({
      action: 'play',
      song: list[0],
    })
    expect(selectNextTrack(list, 'a', 'one')).toEqual({
      action: 'play',
      song: list[1],
    })
  })

  it('falls back to the first song when the current song left the queue', () => {
    expect(selectNextTrack(list, 'gone', 'off')).toEqual({
      action: 'play',
      song: list[0],
    })
    expect(selectNextTrack(list, null, 'off')).toEqual({
      action: 'play',
      song: list[0],
    })
  })

  it('does nothing for an empty queue', () => {
    expect(selectNextTrack([], 'a', 'all')).toEqual({ action: 'none' })
  })

  it('handles a single-song queue', () => {
    const solo = [track('only')]
    expect(selectNextTrack(solo, 'only', 'off')).toEqual({ action: 'stop' })
    expect(selectNextTrack(solo, 'only', 'all')).toEqual({
      action: 'play',
      song: solo[0],
    })
  })
})

describe('selectPrevTrack', () => {
  it('moves to the previous song in order', () => {
    expect(selectPrevTrack(list, 'c')).toEqual({
      action: 'play',
      song: list[1],
    })
  })

  it('wraps from the first song to the last', () => {
    expect(selectPrevTrack(list, 'a')).toEqual({
      action: 'play',
      song: list[2],
    })
  })

  it('falls back to the first song when the current song left the queue', () => {
    expect(selectPrevTrack(list, 'gone')).toEqual({
      action: 'play',
      song: list[0],
    })
  })

  it('does nothing for an empty queue', () => {
    expect(selectPrevTrack([], 'a')).toEqual({ action: 'none' })
  })
})
