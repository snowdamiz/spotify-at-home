'use client'

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Heart,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/components/cover-art'
import { formatTime, type Song } from '@/lib/music-types'
import { Button } from '@/components/ui/button'
import type { OfflineAudioState } from '@/lib/offline-audio-cache'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ServerPlaylist } from '@/lib/api'

type SongRowProps = {
  song: Song
  index?: number
  isActive: boolean
  isPlaying: boolean
  offlineState?: OfflineAudioState
  onPlay: () => void
  onDelete?: () => void
  onToggleLike?: () => void
  onToggleOffline?: () => void
  isDeleting?: boolean
  isLiking?: boolean
  variant?: 'list' | 'compact'
  playlists?: ServerPlaylist[]
  onAddToPlaylist?: (playlistId: string) => void
  onCreatePlaylistWithSong?: () => void
  onRemoveFromPlaylist?: () => void
}

export function SongRow({
  song,
  index,
  isActive,
  isPlaying,
  offlineState,
  onPlay,
  onDelete,
  onToggleLike,
  onToggleOffline,
  isDeleting = false,
  isLiking = false,
  variant = 'list',
  playlists,
  onAddToPlaylist,
  onCreatePlaylistWithSong,
  onRemoveFromPlaylist,
}: SongRowProps) {
  const canDownload = Boolean(onToggleOffline && !song.isMock && song.serverSong)
  const canDelete = Boolean(onDelete && !song.isMock && song.serverSong)
  const canLike = Boolean(onToggleLike && !song.isMock && song.serverSong)
  const canAddToPlaylist = Boolean(
    onAddToPlaylist && !song.isMock && song.serverSong,
  )
  const canRemoveFromPlaylist = Boolean(
    onRemoveFromPlaylist && !song.isMock && song.serverSong,
  )
  // On mobile we always render the More menu so it can pick up Download and
  // Delete (which we hide as inline buttons on small screens to keep the row
  // legible). On desktop the menu only matters for playlist actions.
  const showMobileMenu =
    canAddToPlaylist || canRemoveFromPlaylist || canDownload || canDelete
  const showDesktopMenu = canAddToPlaylist || canRemoveFromPlaylist
  const offlineStatus = offlineState?.status ?? 'idle'
  const isLiked = Boolean(song.serverSong?.liked ?? song.liked)

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
        'hover:bg-card/70 active:bg-card',
        isActive && 'bg-card/60',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <div className="relative shrink-0">
          <CoverArt
            colorClass={song.coverColor}
            imageUrl={song.coverImageUrl}
            title={song.title}
            size="md"
            rounded="md"
            className="h-12 w-12"
          />
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-md bg-black/55 transition-opacity duration-150',
              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {isActive && isPlaying ? (
              <>
                {/* Dancing bars while playing; pause icon appears on hover */}
                <span
                  aria-hidden
                  className="ov-eq text-primary group-hover:hidden"
                >
                  <span />
                  <span />
                  <span />
                </span>
                <Pause
                  className="hidden h-5 w-5 text-foreground group-hover:block"
                  fill="currentColor"
                />
              </>
            ) : (
              <Play className="h-5 w-5 translate-x-px text-foreground" fill="currentColor" />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'truncate text-sm font-medium tracking-tight',
              isActive ? 'text-primary' : 'text-foreground',
            )}
          >
            {song.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {song.artist}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {variant === 'list' && (
            <div className="hidden w-10 text-right text-xs tabular-nums text-muted-foreground sm:block">
              {formatTime(song.duration)}
            </div>
          )}

          {typeof index === 'number' && variant === 'compact' && (
            <div className="w-5 text-right text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </div>
          )}
        </div>
      </button>

      {canLike && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={isLiking}
          onClick={onToggleLike}
          title={isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          aria-label={isLiked ? `Unlike ${song.title}` : `Like ${song.title}`}
          className={cn(
            'h-9 w-9 shrink-0 text-muted-foreground hover:text-primary disabled:cursor-wait disabled:opacity-80',
            isLiked && 'text-primary',
          )}
        >
          <Heart className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} />
        </Button>
      )}

      {/* Inline Download — desktop only */}
      {canDownload && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={offlineStatus === 'downloading'}
          onClick={onToggleOffline}
          title={offlineTitle(offlineState)}
          aria-label={offlineTitle(offlineState)}
          className={cn(
            'hidden h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground disabled:cursor-wait disabled:opacity-80 sm:inline-flex',
            'sm:opacity-50 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
            offlineStatus === 'downloaded' && 'text-primary sm:opacity-100',
            offlineStatus === 'error' && 'text-destructive sm:opacity-100',
          )}
        >
          <OfflineIcon state={offlineState} />
        </Button>
      )}

      {/* Desktop More menu — playlist actions only */}
      {showDesktopMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="hidden h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground sm:inline-flex sm:opacity-50 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              aria-label={`More actions for ${song.title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canAddToPlaylist && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Add to playlist</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => onCreatePlaylistWithSong?.()}>
                    <Plus className="mr-2 h-4 w-4" />
                    New playlist...
                  </DropdownMenuItem>
                  {playlists && playlists.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      {playlists.map((playlist) => (
                        <DropdownMenuItem
                          key={playlist.id}
                          onSelect={() => onAddToPlaylist?.(playlist.id)}
                        >
                          <span className="truncate">{playlist.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : null}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {canRemoveFromPlaylist && (
              <DropdownMenuItem onSelect={() => onRemoveFromPlaylist?.()}>
                Remove from playlist
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Inline Delete — desktop only */}
      {canDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={isDeleting}
              className="hidden h-9 w-9 shrink-0 text-muted-foreground opacity-0 hover:text-destructive sm:inline-flex sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              aria-label={`Delete ${song.title}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <DeleteSongDialog
            songTitle={song.title}
            isDeleting={isDeleting}
            onDelete={onDelete}
          />
        </AlertDialog>
      )}

      {/* Mobile More menu — comprehensive: Download, playlist actions, Delete */}
      {showMobileMenu && (
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground sm:hidden"
                aria-label={`More actions for ${song.title}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canDownload && (
                <DropdownMenuItem
                  disabled={offlineStatus === 'downloading'}
                  onSelect={() => onToggleOffline?.()}
                >
                  <span className="mr-2 inline-flex h-4 w-4 items-center justify-center">
                    <OfflineIcon state={offlineState} />
                  </span>
                  {offlineStatus === 'downloaded'
                    ? 'Remove from device'
                    : offlineStatus === 'downloading'
                      ? 'Downloading…'
                      : offlineStatus === 'error'
                        ? 'Retry download'
                        : 'Save offline'}
                </DropdownMenuItem>
              )}
              {canAddToPlaylist && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Plus className="mr-2 h-4 w-4" />
                    Add to playlist
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuItem onSelect={() => onCreatePlaylistWithSong?.()}>
                      <Plus className="mr-2 h-4 w-4" />
                      New playlist…
                    </DropdownMenuItem>
                    {playlists && playlists.length > 0 ? (
                      <>
                        <DropdownMenuSeparator />
                        {playlists.map((playlist) => (
                          <DropdownMenuItem
                            key={playlist.id}
                            onSelect={() => onAddToPlaylist?.(playlist.id)}
                          >
                            <span className="truncate">{playlist.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {canRemoveFromPlaylist && (
                <DropdownMenuItem onSelect={() => onRemoveFromPlaylist?.()}>
                  Remove from playlist
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem
                      disabled={isDeleting}
                      onSelect={(event) => event.preventDefault()}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete from library
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canDelete && (
            <DeleteSongDialog
              songTitle={song.title}
              isDeleting={isDeleting}
              onDelete={onDelete}
            />
          )}
        </AlertDialog>
      )}
    </div>
  )
}

function DeleteSongDialog({
  songTitle,
  isDeleting,
  onDelete,
}: {
  songTitle: string
  isDeleting: boolean
  onDelete?: () => void
}) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove from your library?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes &ldquo;{songTitle}&rdquo; from your account. The local
          offline copy for this song is removed too.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          disabled={isDeleting}
          onClick={onDelete}
          className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
        >
          {isDeleting ? 'Removing...' : 'Remove'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

function OfflineIcon({ state }: { state?: OfflineAudioState }) {
  if (state?.status === 'downloading') {
    return <Loader2 className="h-4 w-4 animate-spin" />
  }

  if (state?.status === 'downloaded') {
    return <CheckCircle2 className="h-4 w-4" />
  }

  if (state?.status === 'error') {
    return <AlertCircle className="h-4 w-4" />
  }

  return <Download className="h-4 w-4" />
}

function offlineTitle(state?: OfflineAudioState) {
  if (state?.status === 'downloading') {
    return state.progress
      ? `Downloading ${Math.round(state.progress * 100)}%`
      : 'Downloading'
  }

  if (state?.status === 'downloaded') {
    return 'Remove offline download'
  }

  if (state?.status === 'error') {
    return state.message ?? 'Retry offline download'
  }

  return 'Download for offline listening'
}
