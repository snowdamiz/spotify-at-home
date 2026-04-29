'use client'

import { CheckCircle2, DownloadCloud, Loader2, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout, startGoogleSignIn } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useImportPolicy } from '@/lib/library-hooks'
import type { Song } from '@/lib/music-types'
import type { OfflineAudioStateMap } from '@/lib/offline-audio-cache'

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
}

export function SettingsView({
  offlineAudio,
  songs,
  syncState,
  onSignedOut,
  onSyncLibraryOffline,
}: SettingsViewProps) {
  const { setUser, user } = useAuth()
  const importPolicy = useImportPolicy()
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
    await logout()
    setUser(null)
    onSignedOut()
  }

  return (
    <div className="px-4 pb-6 md:px-6">
      <header className="pt-2 pb-5">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account, storage, and import controls for this Broadside client.
        </p>
      </header>

      {importPolicy.policy.mode === 'open_test' && (
        <section className="mb-4 rounded-lg bg-primary p-4 text-primary-foreground">
          <div className="text-xs font-black uppercase tracking-wider">
            {importPolicy.policy.copy.badge}
          </div>
          <p className="mt-1 text-sm font-semibold">
            {importPolicy.policy.copy.description}
          </p>
        </section>
      )}

      <div className="grid gap-3">
        <section className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">Account</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {user
                  ? `Signed in as ${user.displayName ?? user.email}`
                  : 'You are not signed in.'}
              </p>
              <Button
                type="button"
                onClick={user ? handleLogout : startGoogleSignIn}
                variant={user ? 'secondary' : 'default'}
                className="mt-4 rounded-full"
              >
                {user ? (
                  <>
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </>
                ) : (
                  'Continue with Google'
                )}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">Storage</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Imported music syncs through your self-hosted Broadside server and
                can be saved locally on this browser for offline playback.
              </p>
              <div className="mt-4 rounded-md border border-border bg-background/40 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {isSynced ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : isSyncing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <DownloadCloud className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span>Current device</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {totalCount === 0
                        ? 'No server-backed songs in your library.'
                        : isSyncing
                          ? `${syncState.completed} of ${syncState.total} checked${
                              syncState.failed > 0
                                ? `, ${syncState.failed} failed`
                                : ''
                            }`
                          : `${downloadedCount} of ${totalCount} songs saved locally${
                              downloadingCount > 0
                                ? `, ${downloadingCount} downloading`
                                : ''
                            }`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={isSynced ? 'secondary' : 'default'}
                    className="rounded-full"
                    disabled={isSyncing || totalCount === 0}
                    onClick={onSyncLibraryOffline}
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing
                      </>
                    ) : isSynced ? (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Library synced
                      </>
                    ) : (
                      <>
                        <DownloadCloud className="mr-2 h-4 w-4" />
                        Sync library
                      </>
                    )}
                  </Button>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${syncProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-card p-4">
          <h2 className="text-base font-bold">Import policy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {importPolicy.policy.copy.label}
          </p>
          {importPolicy.status === 'error' && (
            <p className="mt-2 text-xs text-destructive">
              Could not refresh the import policy from the server.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
