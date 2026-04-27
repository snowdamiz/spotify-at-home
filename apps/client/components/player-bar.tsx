'use client'

import {
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { CoverArt } from '@/components/cover-art'
import { cn } from '@/lib/utils'
import { formatTime, type Song } from '@/lib/music-types'

type PlayerBarProps = {
  song: Song | null
  isPlaying: boolean
  progress: number
  duration: number
  volume: number
  muted: boolean
  onTogglePlay: () => void
  onSeek: (value: number) => void
  onPrev: () => void
  onNext: () => void
  onVolumeChange: (value: number) => void
  onToggleMute: () => void
  onExpand: () => void
}

export function PlayerBar(props: PlayerBarProps) {
  const {
    song,
    isPlaying,
    progress,
    duration,
    volume,
    muted,
    onTogglePlay,
    onSeek,
    onPrev,
    onNext,
    onVolumeChange,
    onToggleMute,
    onExpand,
  } = props

  if (!song) {
    return null
  }

  return (
    <>
      {/* Mobile mini player */}
      <div className="flex w-full items-center gap-2 border-t border-border bg-card/90 p-2 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={onExpand}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label="Open now playing"
        >
          <CoverArt
            colorClass={song.coverColor}
            title={song.title}
            size="md"
            rounded="md"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{song.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {song.artist}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="h-6 w-6" fill="currentColor" />
          ) : (
            <Play className="h-6 w-6" fill="currentColor" />
          )}
        </button>
      </div>
      {/* Mini progress bar (mobile) */}
      <div className="md:hidden h-0.5 w-full bg-border">
        <div
          className="h-full bg-foreground/80 transition-[width]"
          style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
        />
      </div>

      {/* Desktop full player */}
      <div className="hidden h-[90px] items-center gap-4 border-t border-border bg-background px-4 md:flex">
        {/* Left: now playing info */}
        <div className="flex w-1/4 min-w-0 items-center gap-3">
          <CoverArt
            colorClass={song.coverColor}
            title={song.title}
            size="md"
            rounded="md"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{song.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {song.artist}
            </div>
          </div>
        </div>

        {/* Middle: controls + progress */}
        <div className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Shuffle"
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onPrev}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Previous"
            >
              <SkipBack className="h-5 w-5" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" fill="currentColor" />
              ) : (
                <Play className="h-5 w-5 translate-x-px" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Next"
            >
              <SkipForward className="h-5 w-5" fill="currentColor" />
            </button>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Repeat"
            >
              <Repeat className="h-4 w-4" />
            </button>
          </div>

          <div className="flex w-full max-w-2xl items-center gap-2">
            <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatTime(progress)}
            </span>
            <Slider
              value={progress}
              max={duration || 1}
              onChange={onSeek}
              className="flex-1"
            />
            <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Right: volume */}
        <div className="flex w-1/4 items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <Slider
            value={muted ? 0 : volume}
            max={1}
            onChange={onVolumeChange}
            className="w-28"
          />
        </div>
      </div>
    </>
  )
}

function Slider({
  value,
  max,
  onChange,
  className,
}: {
  value: number
  max: number
  onChange: (value: number) => void
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={cn('relative flex h-4 items-center', className)}>
      <div className="absolute inset-x-0 h-1 rounded-full bg-border" />
      <div
        className="absolute h-1 rounded-full bg-foreground"
        style={{ width: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={max > 1 ? 0.1 : 0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
          [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground"
        aria-label="Slider"
      />
    </div>
  )
}
