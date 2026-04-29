'use client'

import { Heart, Home, Library, Plus, Search, Settings, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/components/cover-art'
import { playlistSubtitle, type ServerPlaylist } from '@/lib/api'
import { type CollectionRef, type Song, type View } from '@/lib/music-types'
import { Button } from '@/components/ui/button'

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
  activeCollectionId,
}: SidebarProps) {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col gap-2 bg-sidebar p-2 md:flex">
      {/* Top nav card */}
      <nav className="rounded-xl bg-card p-2">
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
      <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-card">
        <div className="flex items-center justify-between p-3">
          <button
            onClick={() => setView('library')}
            className={cn(
              'flex items-center gap-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground',
              view === 'library' && !activeCollectionId && 'text-foreground',
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

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 no-scrollbar">
          {/* Imported songs first */}
          {songs.length > 0 && (
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your Songs
            </div>
          )}
          {songs.slice(0, 8).map((song) => (
            <button
              key={song.id}
              onClick={() => setView('library')}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent"
            >
              <CoverArt
                colorClass={song.coverColor}
                imageUrl={song.coverImageUrl}
                title={song.title}
                size="md"
                rounded="md"
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

          {/* Featured playlists */}
          <div className="mb-2 mt-3 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Playlists
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onCreatePlaylistClick}
              aria-label="Create playlist"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <button
            onClick={() => onOpenCollection({ kind: 'system', id: 'liked-songs' })}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent',
              activeCollectionId === 'liked-songs' && 'bg-accent',
            )}
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-fuchsia-600 to-zinc-950 text-foreground shadow-md">
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
                {likedCount} {likedCount === 1 ? 'song' : 'songs'}
              </div>
            </div>
          </button>
          {playlists.map((p) => {
            const active = activeCollectionId === p.id
            return (
              <button
                key={p.id}
                onClick={() => onOpenCollection({ kind: 'playlist', id: p.id })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent',
                  active && 'bg-accent',
                )}
              >
                <CoverArt
                  colorClass={p.color ?? 'from-zinc-700 to-zinc-950'}
                  title={p.name}
                  size="md"
                  rounded="md"
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
            )
          })}
        </div>
      </div>
    </aside>
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
        'flex w-full items-center gap-4 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
