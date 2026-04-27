'use client'

import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/components/cover-art'
import { formatTime, type Song } from '@/lib/music-types'
import { getPlatform } from '@/lib/url-import'

type SongRowProps = {
  song: Song
  index?: number
  isActive: boolean
  isPlaying: boolean
  onPlay: () => void
  variant?: 'list' | 'compact'
}

export function SongRow({
  song,
  index,
  isActive,
  isPlaying,
  onPlay,
  variant = 'list',
}: SongRowProps) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
        'hover:bg-card/80 active:bg-card',
        isActive && 'bg-card/60',
      )}
    >
      <div className="relative">
        <CoverArt
          colorClass={song.coverColor}
          title={song.title}
          size="md"
          rounded="md"
        />
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-md bg-black/50 transition-opacity',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isActive && isPlaying ? (
            <Pause className="h-5 w-5 text-foreground" fill="currentColor" />
          ) : (
            <Play className="h-5 w-5 text-foreground" fill="currentColor" />
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-sm font-medium',
            isActive ? 'text-primary' : 'text-foreground',
          )}
        >
          {song.title}
        </div>
        <div className="flex items-center gap-2">
          <div className="truncate text-xs text-muted-foreground">
            {song.artist}
          </div>
          {song.source && song.source !== 'upload' && (() => {
            const p = getPlatform(song.source)
            if (!p) return null
            return (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none',
                  p.badgeClass,
                )}
              >
                {p.name}
              </span>
            )
          })()}
        </div>
      </div>

      {variant === 'list' && (
        <div className="hidden text-xs tabular-nums text-muted-foreground sm:block">
          {formatTime(song.duration)}
        </div>
      )}

      {typeof index === 'number' && variant === 'compact' && (
        <div className="text-xs tabular-nums text-muted-foreground">
          {index + 1}
        </div>
      )}
    </button>
  )
}
