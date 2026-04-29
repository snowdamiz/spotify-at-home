'use client'

import {
  ChevronDown,
  Heart,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/components/cover-art'
import { formatTime, type Song } from '@/lib/music-types'

type NowPlayingProps = {
  open: boolean
  song: Song | null
  isPlaying: boolean
  progress: number
  duration: number
  onClose: () => void
  onTogglePlay: () => void
  onToggleLike?: () => void
  onSeek: (value: number) => void
  onPrev: () => void
  onNext: () => void
  isLikePending?: boolean
}

export function NowPlaying(props: NowPlayingProps) {
  const {
    open,
    song,
    isPlaying,
    progress,
    duration,
    onClose,
    onTogglePlay,
    onToggleLike,
    onSeek,
    onPrev,
    onNext,
    isLikePending = false,
  } = props

  if (!song) return null

  // Pull the gradient base from the cover for a colored backdrop
  const gradient = song.coverColor
  const canLike = Boolean(onToggleLike && !song.isMock && song.serverSong)
  const isLiked = Boolean(song.serverSong?.liked ?? song.liked)

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 md:hidden',
        'transition-transform duration-300 ease-out',
        open ? 'translate-y-0' : 'translate-y-full pointer-events-none',
      )}
      aria-hidden={!open}
      role="dialog"
      aria-label="Now playing"
    >
      <div
        className={cn(
          'flex h-full w-full flex-col bg-gradient-to-b to-background',
          gradient,
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-foreground/90 hover:bg-foreground/10"
            aria-label="Minimize"
          >
            <ChevronDown className="h-6 w-6" />
          </button>
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-wider text-foreground/70">
              Playing from
            </div>
            <div className="text-xs font-semibold">Your Library</div>
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-foreground/90 hover:bg-foreground/10"
            aria-label="More"
          >
            <MoreHorizontal className="h-6 w-6" />
          </button>
        </div>

        {/* Album art */}
        <div className="flex flex-1 items-center justify-center px-8">
          <CoverArt
            colorClass={song.coverColor}
            imageUrl={song.coverImageUrl}
            title={song.title}
            size="full"
            rounded="2xl"
            className="max-h-[60vh] w-full max-w-sm shadow-2xl"
          />
        </div>

        {/* Bottom controls */}
        <div className="px-6 pb-[max(env(safe-area-inset-bottom),16px)]">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-2xl font-bold">{song.title}</div>
              <div className="truncate text-sm text-foreground/70">
                {song.artist}
              </div>
            </div>
            {canLike && (
              <button
                type="button"
                onClick={onToggleLike}
                disabled={isLikePending}
                className="rounded-full p-2 text-foreground/90 hover:bg-foreground/10 disabled:cursor-wait disabled:opacity-70"
                aria-label={isLiked ? `Unlike ${song.title}` : `Like ${song.title}`}
                title={isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              >
                <Heart className="h-6 w-6" fill={isLiked ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>

          {/* Progress */}
          <FullSlider
            value={progress}
            max={duration || 1}
            onChange={onSeek}
          />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-foreground/70">
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* Controls */}
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              className="text-foreground/80 hover:text-foreground"
              aria-label="Shuffle"
            >
              <Shuffle className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onPrev}
              className="text-foreground hover:text-foreground"
              aria-label="Previous"
            >
              <SkipBack className="h-8 w-8" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-95"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-8 w-8" fill="currentColor" />
              ) : (
                <Play className="h-8 w-8 translate-x-px" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              className="text-foreground hover:text-foreground"
              aria-label="Next"
            >
              <SkipForward className="h-8 w-8" fill="currentColor" />
            </button>
            <button
              type="button"
              className="text-foreground/80 hover:text-foreground"
              aria-label="Repeat"
            >
              <Repeat className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FullSlider({
  value,
  max,
  onChange,
}: {
  value: number
  max: number
  onChange: (value: number) => void
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="relative flex h-5 items-center">
      <div className="absolute inset-x-0 h-1 rounded-full bg-foreground/20" />
      <div
        className="absolute h-1 rounded-full bg-foreground"
        style={{ width: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
          [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground"
        aria-label="Seek"
      />
    </div>
  )
}
