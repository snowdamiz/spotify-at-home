'use client'

import { useState } from 'react'
import {
  Heart,
  Home,
  Library,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/components/cover-art'
import { playlistSubtitle, type ServerPlaylist } from '@/lib/api'
import { resolvePlaylistColor, type CollectionRef, type Song, type View } from '@/lib/music-types'
import { Button } from '@/components/ui/button'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type SidebarProps = {
  view: View
  setView: (v: View) => void
  songs: Song[]
  playlists: ServerPlaylist[]
  likedCount: number
  isAdmin: boolean
  onImportClick: () => void
  onCreatePlaylistClick: () => void
  onOpenCollection: (ref: CollectionRef) => void
  onDeletePlaylist: (playlist: ServerPlaylist) => Promise<void> | void
  activeCollectionId: string | null
}

export function Sidebar({
  view,
  setView,
  songs,
  playlists,
  likedCount,
  isAdmin,
  onImportClick,
  onCreatePlaylistClick,
  onOpenCollection,
  onDeletePlaylist,
  activeCollectionId,
}: SidebarProps) {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col gap-2 bg-sidebar p-2 md:flex">
      {/* Top nav card */}
      <nav className="rounded-xl bg-card/60 p-1.5">
        <NavItem
          icon={<Home className="h-5 w-5" />}
          label="Home"
          active={view === 'home' && !activeCollectionId}
          onClick={() => setView('home')}
        />
        <NavItem
          icon={<Search className="h-5 w-5" />}
          label="Search"
          active={view === 'search' && !activeCollectionId}
          onClick={() => setView('search')}
        />
        <NavItem
          icon={<Settings className="h-5 w-5" />}
          label="Settings"
          active={view === 'settings' && !activeCollectionId}
          onClick={() => setView('settings')}
        />
        {isAdmin && (
          <NavItem
            icon={<ShieldCheck className="h-5 w-5" />}
            label="Admin"
            active={view === 'admin' && !activeCollectionId}
            onClick={() => setView('admin')}
          />
        )}
      </nav>

      {/* Library card */}
      <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-card/60">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <button
            onClick={() => setView('library')}
            className={cn(
              'group flex items-center gap-3 text-sm font-semibold tracking-tight transition-colors',
              view === 'library' && !activeCollectionId
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Library className="h-5 w-5" />
            Your Library
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onImportClick}
            aria-label="Import songs"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 no-scrollbar">
          {/* Imported songs first */}
          {songs.length > 0 && (
            <div className="mb-1.5 mt-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              Your Songs
            </div>
          )}
          {songs.slice(0, 8).map((song) => (
            <button
              key={song.id}
              onClick={() => setView('library')}
              className="group flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-accent/70"
            >
              <CoverArt
                colorClass={song.coverColor}
                imageUrl={song.coverImageUrl}
                title={song.title}
                size="md"
                rounded="md"
                className="h-12 w-12"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {song.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  Song &middot; {song.artist}
                </div>
              </div>
            </button>
          ))}
          {songs.length > 8 && (
            <button
              type="button"
              onClick={() => setView('library')}
              className="mt-1 w-full rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all {songs.length} songs
            </button>
          )}

          {/* Featured playlists */}
          <div className="mb-1.5 mt-3 flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              Playlists
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onCreatePlaylistClick}
              aria-label="Create playlist"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <button
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className={cn(
              'group flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors',
              activeCollectionId === 'liked-songs'
                ? 'bg-accent/80'
                : 'hover:bg-accent/70',
            )}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-fuchsia-600 to-zinc-950 text-foreground shadow-sm">
              <Heart className="h-5 w-5" fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'truncate text-sm font-medium',
                  activeCollectionId === 'liked-songs' && 'text-primary',
                )}
              >
                Liked Songs
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Playlist &middot; {likedCount}{' '}
                {likedCount === 1 ? 'song' : 'songs'}
              </div>
            </div>
          </button>
          {playlists.map((p) => {
            const active = activeCollectionId === p.id
            return (
              <div
                key={p.id}
                className={cn(
                  'group flex w-full items-center gap-1 rounded-lg pr-1 transition-colors',
                  active ? 'bg-accent/80' : 'hover:bg-accent/70',
                )}
              >
                <button
                  type="button"
                  onClick={() => onOpenCollection({ kind: 'playlist', id: p.id })}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left"
                >
                  <CoverArt
                    colorClass={resolvePlaylistColor(p.color, p.name)}
                    title={p.name}
                    size="md"
                    rounded="md"
                    className="h-12 w-12"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'truncate text-sm font-medium',
                        active && 'text-primary',
                      )}
                    >
                      {p.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      Playlist &middot; {playlistSubtitle(p)}
                    </div>
                  </div>
                </button>
                <SidebarPlaylistActions
                  playlist={p}
                  onDelete={() => onDeletePlaylist(p)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

function SidebarPlaylistActions({
  playlist,
  onDelete,
}: {
  playlist: ServerPlaylist
  onDelete: () => Promise<void> | void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (deleting) return

    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={deleting}
            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground sm:opacity-50 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={`More actions for ${playlist.name}`}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <AlertDialogTrigger asChild>
            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete playlist
            </DropdownMenuItem>
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this playlist?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes &ldquo;{playlist.name}&rdquo; permanently. The songs
            stay in your library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={handleDelete}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex w-full items-center gap-4 rounded-md px-3 py-2 text-sm font-semibold tracking-tight transition-colors',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      {icon}
      {label}
    </button>
  )
}
