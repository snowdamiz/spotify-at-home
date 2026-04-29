'use client'

import type { ReactNode } from 'react'
import {
  ChevronRight,
  CheckCircle2,
  DownloadCloud,
  HardDrive,
  Loader2,
  LogOut,
  ShieldCheck,
  ShieldQuestion,
  UserRound,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout, startGoogleSignIn } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useImportPolicy } from '@/lib/library-hooks'
import type { Song, View } from '@/lib/music-types'
import type { OfflineAudioStateMap } from '@/lib/offline-audio-cache'
import { useOnlineStatus } from '@/hooks/use-online-status'

export type LibraryDeviceSyncState = {
  completed: number
  failed: number
  status: 'idle' | 'syncing'
  total: number
}

type SettingsViewProps = {
  offlineAudio: OfflineAudioStateMap
  songs: Song[]
  syncState: LibraryDeviceSyncState
  onSyncLibraryOffline: () => void
  onSignedOut: () => void
  onOpenAdmin?: (view: View) => void
}

export function SettingsView({
  offlineAudio,
  songs,
  syncState,
  onSignedOut,
  onSyncLibraryOffline,
  onOpenAdmin,
}: SettingsViewProps) {
  const { setUser, user } = useAuth()
  const importPolicy = useImportPolicy()
  const isOnline = useOnlineStatus()
  const deviceSongs = songs.filter((song) => !song.isMock && song.serverSong)
  const downloadedCount = deviceSongs.filter(
    (song) => offlineAudio[song.id]?.status === 'downloaded',
  ).length
  const downloadingCount = deviceSongs.filter(
    (song) => offlineAudio[song.id]?.status === 'downloading',
  ).length
  const totalCount = deviceSongs.length
  const isSyncing = syncState.status === 'syncing'
  const isSynced = totalCount > 0 && downloadedCount === totalCount
  const syncProgress =
    isSyncing && syncState.total > 0
      ? Math.min(100, Math.round((syncState.completed / syncState.total) * 100))
      : totalCount > 0
        ? Math.round((downloadedCount / totalCount) * 100)
        : 0

  async function handleLogout() {
    if (isOnline) {
      await logout().catch(() => undefined)
    }
    setUser(null)
    onSignedOut()
  }

  const accountSubtitle = user
    ? (user.displayName ?? user.email ?? 'Signed in')
    : 'Not signed in.'

  const storageSubtitle =
    totalCount === 0
      ? 'No server-backed songs to save offline yet.'
      : isSyncing
        ? `Syncing ${syncState.completed} of ${syncState.total}${
            syncState.failed > 0 ? ` · ${syncState.failed} failed` : ''
          }`
        : `${downloadedCount} of ${totalCount} saved offline${
            downloadingCount > 0 ? ` · ${downloadingCount} downloading` : ''
          }`

  return (
    <div className="px-4 pb-8 md:px-6">
      <div className="mx-auto w-full max-w-2xl">
      <header className="pt-2 pb-6">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Account, storage, and import controls.
        </p>
      </header>

      {importPolicy.policy.mode === 'open_test' && (
        <div className="mb-4 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-md shadow-primary/10">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em]">
            {importPolicy.policy.copy.badge}
          </div>
          <p className="mt-0.5 text-sm font-semibold">
            {importPolicy.policy.copy.description}
          </p>
        </div>
      )}

      <div className="grid gap-2">
        {user?.isAdmin && onOpenAdmin && (
          <SettingsLink
            icon={<ShieldCheck className="h-4 w-4" />}
            iconClassName="bg-primary/20 text-primary"
            title="Admin"
            subtitle="Entry keys, storage, maintenance"
            onClick={() => onOpenAdmin('admin')}
          />
        )}

        <SettingsCard
          icon={<UserRound className="h-4 w-4" />}
          title="Account"
          subtitle={accountSubtitle}
          action={
            user ? (
              <Button
                type="button"
                onClick={handleLogout}
                variant="ghost"
                className="h-9 rounded-full px-4 text-sm text-muted-foreground hover:text-foreground"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </Button>
            ) : (
              <Button
                type="button"
                onClick={startGoogleSignIn}
                disabled={!isOnline}
                className="h-9 rounded-full bg-foreground px-4 text-background hover:bg-foreground/90"
              >
                {!isOnline ? (
                  <WifiOff className="mr-2 h-4 w-4" />
                ) : null}
                {isOnline ? 'Continue with Google' : 'Offline'}
              </Button>
            )
          }
        />

        <SettingsCard
          icon={<HardDrive className="h-4 w-4" />}
          title="Offline library"
          subtitle={storageSubtitle}
          action={
            <Button
              type="button"
              disabled={isSyncing || totalCount === 0}
              onClick={onSyncLibraryOffline}
              className={
                isSynced
                  ? 'h-9 rounded-full bg-card text-muted-foreground hover:bg-card hover:text-foreground'
                  : 'h-9 rounded-full bg-foreground text-background hover:bg-foreground/90'
              }
            >
              {isSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing
                </>
              ) : isSynced ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Synced
                </>
              ) : (
                <>
                  <DownloadCloud className="mr-2 h-4 w-4" />
                  Sync to device
                </>
              )}
            </Button>
          }
        >
          {totalCount > 0 && (
            <div className="mt-3">
              <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-foreground transition-[width] duration-300"
                  style={{ width: `${syncProgress}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                <span>
                  {isSyncing ? syncState.completed : downloadedCount} /{' '}
                  {isSyncing ? syncState.total : totalCount}
                </span>
                <span>{syncProgress}%</span>
              </div>
            </div>
          )}
        </SettingsCard>

        <SettingsCard
          icon={<ShieldQuestion className="h-4 w-4" />}
          title="Import policy"
          subtitle={importPolicy.policy.copy.label}
        >
          {importPolicy.status === 'error' && (
            <p className="mt-2 text-xs text-destructive">
              Couldn't refresh the import policy from the server.
            </p>
          )}
        </SettingsCard>
      </div>
      </div>
    </div>
  )
}

function SettingsCard({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="rounded-2xl bg-card/40 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function SettingsLink({
  icon,
  iconClassName,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode
  iconClassName: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-2xl bg-card/40 px-4 py-3.5 text-left transition-colors hover:bg-card/60"
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-tight">{title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {subtitle}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
