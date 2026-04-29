'use client'

import {
  ChevronDown,
  Heart,
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/components/cover-art'
import { formatTime, type Song } from '@/lib/music-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { PlayingFromLabel } from '@/components/music-app'

type RepeatMode = 'off' | 'all' | 'one'

type NowPlayingProps = {
  open: boolean
  song: Song | null
  isPlaying: boolean
  progress: number
  duration: number
  shuffleEnabled: boolean
  repeatMode: RepeatMode
  playingFromLabel: PlayingFromLabel | null
  queue: Song[]
  currentSongId: string | null
  showQueue: boolean
  onShowQueue: () => void
  onCloseQueue: () => void
  onClose: () => void
  onTogglePlay: () => void
  onToggleShuffle: () => void
  onCycleRepeat: () => void
  onToggleLike?: () => void
  onSeek: (value: number) => void
  onPrev: () => void
  onNext: () => void
  onSelectQueueItem: (song: Song) => void
  onRemoveFromQueue: (songId: string) => void
  isLikePending?: boolean
}

function formatPlayingFrom(label: PlayingFromLabel | null): {
  kindLabel: string
  name: string
} {
  if (!label) return { kindLabel: 'Playing from', name: 'Your library' }
  switch (label.kind) {
    case 'playlist':
      return { kindLabel: 'Playlist', name: label.name ?? 'Playlist' }
    case 'liked':
      return { kindLabel: 'Playing from', name: 'Liked Songs' }
    case 'search':
      return { kindLabel: 'Playing from', name: 'Search' }
    case 'home':
      return { kindLabel: 'Playing from', name: 'Home' }
    case 'library':
    default:
      return { kindLabel: 'Playing from', name: 'Your library' }
  }
}

export function NowPlaying(props: NowPlayingProps) {
  const {
    open,
    song,
    isPlaying,
    progress,
    duration,
    shuffleEnabled,
    repeatMode,
    playingFromLabel,
    queue,
    currentSongId,
    showQueue,
    onShowQueue,
    onCloseQueue,
    onClose,
    onTogglePlay,
    onToggleShuffle,
    onCycleRepeat,
    onToggleLike,
    onSeek,
    onPrev,
    onNext,
    onSelectQueueItem,
    onRemoveFromQueue,
    isLikePending = false,
  } = props

  if (!song) return null

  const gradient = song.coverColor
  const canLike = Boolean(onToggleLike && !song.isMock && song.serverSong)
  const isLiked = Boolean(song.serverSong?.liked ?? song.liked)
  const playingFrom = formatPlayingFrom(playingFromLabel)
  const repeatActive = repeatMode !== 'off'
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat

  const currentIdx = queue.findIndex((s) => s.id === currentSongId)
  const upcoming =
    currentIdx >= 0 ? queue.slice(currentIdx + 1) : queue.slice(0)

  return (
    <>
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
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40"
            aria-hidden
          />
          {/* Header */}
          <div className="safe-x-4 safe-top-3 relative flex items-center justify-between pb-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-foreground/90 transition-colors hover:bg-foreground/10"
              aria-label="Minimize"
            >
              <ChevronDown className="h-6 w-6" />
            </button>
            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                {playingFrom.kindLabel}
              </div>
              <div className="truncate text-xs font-semibold tracking-tight">
                {playingFrom.name}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full p-2 text-foreground/90 transition-colors hover:bg-foreground/10"
                  aria-label="More"
                >
                  <MoreHorizontal className="h-6 w-6" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => onShowQueue()}>
                  <ListMusic className="mr-2 h-4 w-4" />
                  View queue
                </DropdownMenuItem>
                {canLike && (
                  <DropdownMenuItem onSelect={() => onToggleLike?.()}>
                    <Heart
                      className={cn('mr-2 h-4 w-4', isLiked && 'text-primary')}
                      fill={isLiked ? 'currentColor' : 'none'}
                    />
                    {isLiked ? 'Remove from Liked' : 'Add to Liked Songs'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onClose()}>
                  <ChevronDown className="mr-2 h-4 w-4" />
                  Minimize
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Album art */}
          <div className="relative flex flex-1 items-center justify-center px-8">
            <CoverArt
              colorClass={song.coverColor}
              imageUrl={song.coverImageUrl}
              title={song.title}
              size="full"
              rounded="2xl"
              className="max-h-[60vh] w-full max-w-sm shadow-2xl shadow-black/50"
            />
          </div>

          {/* Bottom controls */}
          <div className="safe-x-6 safe-bottom-4 relative">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-2xl font-bold tracking-tight">
                  {song.title}
                </div>
                <div className="truncate text-sm text-foreground/70">
                  {song.artist}
                </div>
              </div>
              {canLike && (
                <button
                  type="button"
                  onClick={onToggleLike}
                  disabled={isLikePending}
                  className={cn(
                    'rounded-full p-2 text-foreground/90 transition-colors hover:bg-foreground/10 disabled:cursor-wait disabled:opacity-70',
                    isLiked && 'text-primary',
                  )}
                  aria-label={
                    isLiked ? `Unlike ${song.title}` : `Like ${song.title}`
                  }
                  title={
                    isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'
                  }
                >
                  <Heart
                    className="h-6 w-6"
                    fill={isLiked ? 'currentColor' : 'none'}
                  />
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
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={onToggleShuffle}
                className={cn(
                  'relative transition-colors',
                  shuffleEnabled
                    ? 'text-primary'
                    : 'text-foreground/70 hover:text-foreground',
                )}
                aria-label={shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
                aria-pressed={shuffleEnabled}
              >
                <Shuffle className="h-5 w-5" />
                {shuffleEnabled && (
                  <span
                    aria-hidden
                    className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={onPrev}
                className="text-foreground transition-transform active:scale-95"
                aria-label="Previous"
              >
                <SkipBack className="h-8 w-8" fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background shadow-2xl shadow-black/40 transition-transform active:scale-95"
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
                className="text-foreground transition-transform active:scale-95"
                aria-label="Next"
              >
                <SkipForward className="h-8 w-8" fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={onCycleRepeat}
                className={cn(
                  'relative transition-colors',
                  repeatActive
                    ? 'text-primary'
                    : 'text-foreground/70 hover:text-foreground',
                )}
                aria-label={`Repeat ${repeatMode}`}
              >
                <RepeatIcon className="h-5 w-5" />
                {repeatActive && (
                  <span
                    aria-hidden
                    className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                  />
                )}
              </button>
            </div>

            {/* Queue button */}
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={onShowQueue}
                className="flex items-center gap-2 rounded-full bg-foreground/10 px-3 py-1.5 text-xs font-semibold text-foreground/80 transition-colors hover:bg-foreground/20"
              >
                <ListMusic className="h-3.5 w-3.5" />
                Up next
                {upcoming.length > 0 && (
                  <span className="text-foreground/60">
                    · {upcoming.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <QueueSheet
        open={showQueue}
        onClose={onCloseQueue}
        nowPlaying={song}
        upcoming={upcoming}
        playingFromLabel={playingFromLabel}
        onSelect={(s) => {
          onSelectQueueItem(s)
        }}
        onRemove={onRemoveFromQueue}
      />
    </>
  )
}

function QueueSheet({
  open,
  onClose,
  nowPlaying,
  upcoming,
  playingFromLabel,
  onSelect,
  onRemove,
}: {
  open: boolean
  onClose: () => void
  nowPlaying: Song
  upcoming: Song[]
  playingFromLabel: PlayingFromLabel | null
  onSelect: (song: Song) => void
  onRemove: (songId: string) => void
}) {
  const playingFrom = formatPlayingFrom(playingFromLabel)
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border/60">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {playingFrom.kindLabel}
          </div>
          <SheetTitle className="text-lg">Queue · {playingFrom.name}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Now playing */}
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Now playing
            </div>
            <QueueRow song={nowPlaying} active onPlay={() => undefined} />
          </div>

          {/* Up next */}
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Up next
            </div>
            {upcoming.length === 0 ? (
              <div className="mt-3 rounded-xl bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing queued — playing from {playingFrom.name}.
              </div>
            ) : (
              <div className="mt-1">
                {upcoming.map((song) => (
                  <QueueRow
                    key={song.id}
                    song={song}
                    onPlay={() => {
                      onSelect(song)
                      onClose()
                    }}
                    onRemove={() => onRemove(song.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function QueueRow({
  song,
  active = false,
  onPlay,
  onRemove,
}: {
  song: Song
  active?: boolean
  onPlay: () => void
  onRemove?: () => void
}) {
  return (
    <div
      className={cn(
        'group mt-1 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-card/70',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <CoverArt
          colorClass={song.coverColor}
          imageUrl={song.coverImageUrl}
          title={song.title}
          size="md"
          rounded="md"
          className="h-10 w-10 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'truncate text-sm font-medium tracking-tight',
              active && 'text-primary',
            )}
          >
            {song.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {song.artist}
          </div>
        </div>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
          aria-label={`Remove ${song.title} from queue`}
          title="Remove from queue"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
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
