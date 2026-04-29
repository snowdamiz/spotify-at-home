'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Clipboard,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createAdminEntryKey,
  fetchAdminEntryKeys,
  fetchAdminStorageObjects,
  wipeAdminAccountTracks,
  type AccountTrackWipeDeletion,
  type AdminStorageOverview,
  type EntryKeySummary,
  type StorageObjectSummary,
} from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import type { Song } from '@/lib/music-types'

type AdminViewProps = {
  songs: Song[]
  onTracksWiped: (songIds: string[]) => void
}

type TabValue = 'keys' | 'storage' | 'maintenance'

export function AdminView({ songs, onTracksWiped }: AdminViewProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('keys')

  const [entryKeys, setEntryKeys] = useState<EntryKeySummary[]>([])
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [keysLoading, setKeysLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const [storage, setStorage] = useState<AdminStorageOverview | null>(null)
  const [storageLoading, setStorageLoading] = useState(true)
  const [storageQuery, setStorageQuery] = useState('')
  const [storageFilter, setStorageFilter] = useState<'all' | 'r2' | 'local'>(
    'all',
  )

  const [deleteStoredAudio, setDeleteStoredAudio] = useState(false)
  const [wipingTracks, setWipingTracks] = useState(false)

  const unusedCount = useMemo(
    () => entryKeys.filter((entryKey) => !entryKey.consumedAt).length,
    [entryKeys],
  )

  const loadEntryKeys = useCallback(async () => {
    setKeysLoading(true)

    try {
      const result = await fetchAdminEntryKeys()

      if (result.status !== 'authenticated') {
        toast({
          title: 'Admin access required',
          description: 'This account cannot manage entry keys.',
          variant: 'destructive',
        })
        return
      }

      setEntryKeys(result.entryKeys)
    } catch (error) {
      toast({
        title: 'Could not load entry keys',
        description:
          error instanceof Error ? error.message : 'Try refreshing in a moment.',
        variant: 'destructive',
      })
    } finally {
      setKeysLoading(false)
    }
  }, [])

  const loadStorage = useCallback(async () => {
    setStorageLoading(true)

    try {
      const result = await fetchAdminStorageObjects()

      if (result.status !== 'authenticated' || !result.storage) {
        toast({
          title: 'Admin access required',
          description: 'This account cannot view storage objects.',
          variant: 'destructive',
        })
        return
      }

      setStorage(result.storage)
    } catch (error) {
      toast({
        title: 'Could not load storage objects',
        description:
          error instanceof Error ? error.message : 'Try refreshing in a moment.',
        variant: 'destructive',
      })
    } finally {
      setStorageLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEntryKeys()
    loadStorage()
  }, [loadEntryKeys, loadStorage])

  const refreshActiveTab = useCallback(async () => {
    if (activeTab === 'storage') {
      await loadStorage()
      return
    }

    if (activeTab === 'keys') {
      await loadEntryKeys()
    }
  }, [activeTab, loadEntryKeys, loadStorage])

  const refreshing =
    (activeTab === 'keys' && keysLoading) ||
    (activeTab === 'storage' && storageLoading)

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (creating) return

    setCreating(true)
    setCopied(false)

    try {
      const result = await createAdminEntryKey(label.trim() || null)

      if (result.status !== 'created' || !result.entryKey || !result.secret) {
        toast({
          title: 'Admin access required',
          description: 'This account cannot create entry keys.',
          variant: 'destructive',
        })
        return
      }

      setEntryKeys((current) => [result.entryKey, ...current])
      setSecret(result.secret)
      setLabel('')
      toast({
        title: 'Entry key created',
        description: 'Share the new key before leaving this screen.',
      })
    } catch (error) {
      toast({
        title: 'Could not create entry key',
        description:
          error instanceof Error ? error.message : 'Try again in a moment.',
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  async function copySecret() {
    if (!secret) return

    await navigator.clipboard.writeText(secret)
    setCopied(true)
  }

  async function handleWipeTracks() {
    if (wipingTracks) return

    const wipedSongIds = songs.map((song) => song.id)

    setWipingTracks(true)

    try {
      const result = await wipeAdminAccountTracks({
        deleteStoredAudio,
      })

      if (result.status !== 'authenticated' || !result.deletion) {
        toast({
          title: 'Admin access required',
          description: 'This account cannot wipe tracks.',
          variant: 'destructive',
        })
        return
      }

      onTracksWiped(wipedSongIds)
      await loadStorage()
      toast({
        title:
          result.deletion.failedStoredObjects > 0
            ? 'Tracks wiped with storage errors'
            : 'Tracks wiped',
        description: wipeResultDescription(result.deletion),
        variant:
          result.deletion.failedStoredObjects > 0 ? 'destructive' : 'default',
      })
    } catch (error) {
      toast({
        title: 'Could not wipe tracks',
        description:
          error instanceof Error ? error.message : 'Try again in a moment.',
        variant: 'destructive',
      })
    } finally {
      setWipingTracks(false)
    }
  }

  const r2ObjectCount = useMemo(
    () =>
      storage
        ? storage.objects.filter((object) => object.location === 'r2').length
        : 0,
    [storage],
  )

  const filteredObjects = useMemo(() => {
    if (!storage) return []

    const trimmed = storageQuery.trim().toLowerCase()

    return storage.objects.filter((object) => {
      if (storageFilter !== 'all' && object.location !== storageFilter) {
        return false
      }

      if (!trimmed) return true

      if (object.storagePath.toLowerCase().includes(trimmed)) return true
      if (object.sampleTitle?.toLowerCase().includes(trimmed)) return true

      return object.ownerEmails.some((email) =>
        email.toLowerCase().includes(trimmed),
      )
    })
  }, [storage, storageFilter, storageQuery])

  return (
    <div className="px-4 pb-10 md:px-6">
      <header className="pt-2 pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Workspace
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
              Admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage invitations, audit storage, and run account maintenance.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={refreshActiveTab}
            disabled={refreshing}
            className="rounded-full"
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<KeyRound className="h-4 w-4" />}
          label="Entry keys"
          primary={
            keysLoading
              ? '—'
              : `${unusedCount} unused`
          }
          secondary={
            keysLoading ? 'Loading…' : `${entryKeys.length} total created`
          }
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Library tracks"
          primary={`${songs.length}`}
          secondary={
            songs.length === 1 ? 'in this account' : 'in this account'
          }
        />
        <StatCard
          icon={
            storage?.driver === 'r2' ? (
              <Cloud className="h-4 w-4" />
            ) : (
              <HardDrive className="h-4 w-4" />
            )
          }
          label={storage?.driver === 'r2' ? 'R2 objects' : 'Stored objects'}
          primary={
            storageLoading
              ? '—'
              : storage?.driver === 'r2'
                ? `${r2ObjectCount}`
                : `${storage?.totalObjects ?? 0}`
          }
          secondary={
            storageLoading
              ? 'Loading…'
              : storage
                ? `${storage.totalObjects} total · ${formatBytes(
                    storage.totalBytes,
                  )}`
                : 'Unavailable'
          }
        />
        <StatCard
          icon={<Database className="h-4 w-4" />}
          label="Storage driver"
          primary={
            storageLoading
              ? '—'
              : storage?.driver === 'r2'
                ? 'Cloudflare R2'
                : 'Local disk'
          }
          secondary={
            storage?.driver === 'r2'
              ? 'Audio served from R2'
              : 'Audio served from local disk'
          }
        />
      </section>

      {secret && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
                New entry key
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The secret is shown once — copy it before leaving this page.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="overflow-x-auto rounded-md bg-background px-3 py-2 text-base font-black tracking-[0.24em] text-foreground sm:text-lg">
                {secret}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={copySecret}
                className="rounded-full"
              >
                {copied ? (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                ) : (
                  <Clipboard className="mr-2 h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(next) => setActiveTab(next as TabValue)}
        className="gap-6"
      >
        <TabsList className="h-10 w-full rounded-full bg-card p-1 sm:w-auto">
          <TabsTrigger value="keys" className="rounded-full px-4">
            <KeyRound className="mr-1.5 h-4 w-4" />
            Entry keys
          </TabsTrigger>
          <TabsTrigger value="storage" className="rounded-full px-4">
            <Cloud className="mr-1.5 h-4 w-4" />
            Storage
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="rounded-full px-4">
            <AlertTriangle className="mr-1.5 h-4 w-4" />
            Maintenance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <section className="rounded-xl bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold">New entry key</h2>
                  <p className="text-xs text-muted-foreground">
                    Single-use, shown once after creation.
                  </p>
                </div>
              </div>
              <form onSubmit={handleCreate} className="mt-4 space-y-3">
                <div>
                  <Label
                    htmlFor="entry-key-label"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Label (optional)
                  </Label>
                  <Input
                    id="entry-key-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={120}
                    placeholder="e.g. invitee@example.com"
                    className="mt-1 h-11 rounded-full"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={creating}
                  className="h-11 w-full rounded-full"
                >
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Create entry key
                </Button>
              </form>
            </section>

            <section className="rounded-xl bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold">All entry keys</h2>
                  <p className="text-xs text-muted-foreground">
                    {keysLoading
                      ? 'Loading…'
                      : `${unusedCount} unused of ${entryKeys.length} created.`}
                  </p>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-lg border border-border">
                {keysLoading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading entry keys
                  </div>
                ) : entryKeys.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No entry keys yet. Create one to invite a new user.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {entryKeys.map((entryKey) => (
                      <EntryKeyRow key={entryKey.id} entryKey={entryKey} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="storage" className="space-y-4">
          <section className="rounded-xl bg-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                  {storage?.driver === 'r2' ? (
                    <Cloud className="h-5 w-5" />
                  ) : (
                    <HardDrive className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold">
                    {storage?.driver === 'r2'
                      ? 'R2 storage objects'
                      : 'Stored audio objects'}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {storage
                      ? `Showing ${storage.returnedObjects} of ${storage.totalObjects} object${
                          storage.totalObjects === 1 ? '' : 's'
                        } across all users · ${formatBytes(storage.totalBytes)}`
                      : 'Lists every distinct stored audio file across all accounts.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={storageQuery}
                    onChange={(event) => setStorageQuery(event.target.value)}
                    placeholder="Search path, owner, title"
                    className="h-10 rounded-full pl-9"
                  />
                </div>
                <div className="flex items-center gap-1 rounded-full bg-muted p-1">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'r2', label: 'R2' },
                      { id: 'local', label: 'Local' },
                    ] as const
                  ).map((option) => {
                    const active = storageFilter === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setStorageFilter(option.id)}
                        className={
                          active
                            ? 'rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground shadow-sm transition-colors'
                            : 'rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
                        }
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              {storageLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading storage objects
                </div>
              ) : !storage || storage.objects.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No stored audio objects yet.
                </div>
              ) : filteredObjects.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No objects match this filter.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredObjects.map((object) => (
                    <StorageObjectRow
                      key={object.storagePath}
                      object={object}
                    />
                  ))}
                </div>
              )}
            </div>

            {storage && storage.totalObjects > storage.returnedObjects && (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the {storage.returnedObjects} most recently updated
                objects. {storage.totalObjects - storage.returnedObjects} more
                exist.
              </p>
            )}
          </section>
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-4">
          <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold">Wipe all tracks</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Remove every track from this admin account. Playlists and
                    entry keys stay in place.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">
                    {songs.length}{' '}
                    {songs.length === 1 ? 'track' : 'tracks'} in this account
                  </p>
                </div>
              </div>

              <div className="w-full space-y-3 lg:w-[22rem]">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
                  <div className="min-w-0">
                    <Label htmlFor="wipe-r2-storage" className="text-sm">
                      Also delete from {storage?.driver === 'r2' ? 'R2' : 'storage'}
                    </Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Only unreferenced stored audio objects are deleted.
                    </p>
                  </div>
                  <Switch
                    id="wipe-r2-storage"
                    checked={deleteStoredAudio}
                    disabled={wipingTracks}
                    onCheckedChange={setDeleteStoredAudio}
                  />
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={wipingTracks || songs.length === 0}
                      className="h-11 w-full rounded-full"
                    >
                      {wipingTracks ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Wipe all tracks
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Wipe all tracks?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes every track from your admin account.{' '}
                        {deleteStoredAudio
                          ? 'Unreferenced audio objects will also be deleted from storage.'
                          : 'Stored audio objects will be left in place.'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={wipingTracks}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={wipingTracks}
                          onClick={handleWipeTracks}
                        >
                          {wipingTracks && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Wipe all tracks
                        </Button>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({
  icon,
  label,
  primary,
  secondary,
}: {
  icon: React.ReactNode
  label: string
  primary: string
  secondary: string
}) {
  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-primary">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-2 text-xl font-bold tracking-tight">{primary}</div>
      <div className="mt-1 text-xs text-muted-foreground">{secondary}</div>
    </div>
  )
}

function EntryKeyRow({ entryKey }: { entryKey: EntryKeySummary }) {
  const consumed = Boolean(entryKey.consumedAt)

  return (
    <div className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-background px-2 py-1 text-xs font-black tracking-[0.18em] text-foreground">
            {entryKey.keyPrefix}
          </span>
          <span className="truncate font-semibold">
            {entryKey.label ?? 'Unlabeled key'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Created {formatDate(entryKey.createdAt)}
          {consumed && entryKey.consumedByUserEmail
            ? ` · used by ${entryKey.consumedByUserEmail}`
            : ''}
        </p>
      </div>
      <span
        className={
          consumed
            ? 'rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground'
            : 'rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground'
        }
      >
        {consumed ? 'Used' : 'Unused'}
      </span>
    </div>
  )
}

function StorageObjectRow({ object }: { object: StorageObjectSummary }) {
  const [copied, setCopied] = useState(false)
  const orphaned = object.activeSongCount === 0
  const r2 = object.location === 'r2'
  const displayPath = r2 ? object.storagePath.replace(/^r2:\/\//, '') : object.storagePath

  async function copyPath() {
    await navigator.clipboard.writeText(object.storagePath)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={r2 ? 'default' : 'secondary'}
            className="gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
          >
            {r2 ? (
              <Cloud className="h-3 w-3" />
            ) : (
              <HardDrive className="h-3 w-3" />
            )}
            {r2 ? 'R2' : 'Local'}
          </Badge>
          {orphaned && (
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-amber-500/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3" />
              Orphaned
            </Badge>
          )}
          {!object.exists && (
            <Badge
              variant="outline"
              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Missing
            </Badge>
          )}
          {object.sampleTitle && (
            <span className="truncate text-sm font-semibold">
              {object.sampleTitle}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={copyPath}
          title="Copy storage path"
          className="mt-1 flex w-full items-center gap-2 truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <code className="truncate font-mono">{displayPath}</code>
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Clipboard className="h-3.5 w-3.5 shrink-0 opacity-60" />
          )}
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {formatBytes(object.sizeBytes)}
            {!object.exists && object.declaredSizeBytes > 0
              ? ` actual · ${formatBytes(object.declaredSizeBytes)} declared`
              : ''}
          </span>
          <span>·</span>
          <span>
            {object.activeSongCount}/{object.songCount}{' '}
            {object.songCount === 1 ? 'reference' : 'references'}
          </span>
          {object.ownerEmails.length > 0 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {object.ownerEmails.length === 1
                  ? object.ownerEmails[0]
                  : `${object.ownerEmails.length} owners`}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <div>Updated</div>
        <div className="font-medium text-foreground">
          {formatDate(object.latestUpdatedAt)}
        </div>
      </div>
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value < 10 && unitIndex > 0 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`
}

function wipeResultDescription(deletion: AccountTrackWipeDeletion) {
  const trackSummary = `${deletion.deletedTracks} ${
    deletion.deletedTracks === 1 ? 'track was' : 'tracks were'
  } removed from this account.`

  if (!deletion.storageDeleteRequested) {
    return trackSummary
  }

  if (deletion.failedStoredObjects > 0) {
    return `${trackSummary} ${deletion.deletedStoredObjects} stored ${
      deletion.deletedStoredObjects === 1 ? 'object was' : 'objects were'
    } deleted, ${deletion.failedStoredObjects} failed.`
  }

  if (deletion.retainedStoredObjects > 0) {
    return `${trackSummary} ${deletion.deletedStoredObjects} stored ${
      deletion.deletedStoredObjects === 1 ? 'object was' : 'objects were'
    } deleted, ${deletion.retainedStoredObjects} kept because ${
      deletion.retainedStoredObjects === 1 ? 'it is' : 'they are'
    } still referenced.`
  }

  return `${trackSummary} ${deletion.deletedStoredObjects} stored ${
    deletion.deletedStoredObjects === 1 ? 'object was' : 'objects were'
  } deleted.`
}
