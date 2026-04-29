'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CheckCircle2,
  Clipboard,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createAdminEntryKey,
  fetchAdminEntryKeys,
  type EntryKeySummary,
} from '@/lib/api'
import { toast } from '@/hooks/use-toast'

export function AdminView() {
  const [entryKeys, setEntryKeys] = useState<EntryKeySummary[]>([])
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const unusedCount = useMemo(
    () => entryKeys.filter((entryKey) => !entryKey.consumedAt).length,
    [entryKeys],
  )

  const loadEntryKeys = useCallback(async () => {
    setLoading(true)

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
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEntryKeys()
  }, [loadEntryKeys])

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

  return (
    <div className="px-4 pb-6 md:px-6">
      <header className="pt-2 pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one-time entry keys for new Broadside accounts.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={loadEntryKeys}
            disabled={loading}
            className="rounded-full"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">New entry key</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The full key is shown once after creation.
              </p>
              <form onSubmit={handleCreate} className="mt-4 space-y-3">
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={120}
                  placeholder="Label or invitee email"
                  className="h-11 rounded-full"
                />
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
                  Create key
                </Button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">Key status</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {unusedCount} unused of {entryKeys.length} created.
              </p>
            </div>
          </div>

          {secret && (
            <div className="mt-4 rounded-md border border-primary/30 bg-primary/10 p-3">
              <div className="text-xs font-black uppercase tracking-wider text-primary">
                New key
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background px-3 py-2 text-lg font-black tracking-[0.24em] text-foreground">
                  {secret}
                </div>
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
          )}

          <div className="mt-4 overflow-hidden rounded-md border border-border">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading entry keys
              </div>
            ) : entryKeys.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No entry keys yet.
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
            ? `, used by ${entryKey.consumedByUserEmail}`
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
