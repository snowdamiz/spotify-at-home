'use client'

import { useCallback, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileAudio,
  Loader2,
  Music2,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import type { ExternalDiscoveryResult } from '@broadside/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { isSupportedAudioFile } from '@/lib/api'
import type { detectPlatform } from '@/lib/url-import'

export type Download = {
  id: string
  url: string
  platform: ReturnType<typeof detectPlatform>
  title: string
  artist: string
  thumbnailUrl?: string | null
  progress: number // 0..1
  status: 'downloading' | 'complete' | 'error'
  message?: string
}

type AddMusicDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  downloads: Download[]
  externalResults: ExternalDiscoveryResult[]
  isDiscoveringLink: boolean
  isImportingLink: boolean
  onFilesSelected: (files: FileList | File[]) => void
  onImportExternalResult: (result: ExternalDiscoveryResult) => void | Promise<void>
  onSubmitUrl: (url: string) => void | Promise<void>
}

const QUICK_SEARCHES = [
  'Tame Impala',
  'lo-fi beats',
  'Daft Punk - Around the World',
]

const SUPPORTED_FORMATS = ['MP3', 'WAV', 'OGG', 'FLAC', 'M4A']

function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function AddMusicDialog({
  open,
  onOpenChange,
  downloads,
  externalResults,
  isDiscoveringLink,
  isImportingLink,
  onFilesSelected,
  onImportExternalResult,
  onSubmitUrl,
}: AddMusicDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [tab, setTab] = useState<'youtube' | 'upload'>('youtube')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [pendingResultId, setPendingResultId] = useState<string | null>(null)

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).filter(isSupportedAudioFile)
      if (list.length === 0) return
      onFilesSelected(list)
    },
    [onFilesSelected],
  )

  const onPickFiles = () => fileInputRef.current?.click()

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }

  const submitQuery = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Enter a search or link to get started.')
      return
    }
    setError(null)
    setHasSearched(true)
    void onSubmitUrl(trimmed)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submitQuery(url)
  }

  const onSuggestionClick = (value: string) => {
    setUrl(value)
    inputRef.current?.focus()
    submitQuery(value)
  }

  const handleImport = async (result: ExternalDiscoveryResult) => {
    setPendingResultId(result.sourceId)
    try {
      await onImportExternalResult(result)
    } finally {
      setPendingResultId((current) =>
        current === result.sourceId ? null : current,
      )
    }
  }

  const canImportExternal = (result: ExternalDiscoveryResult) =>
    result.eligibility?.state !== 'blocked'

  const showResults = externalResults.length > 0
  const showEmptySearchHint = !hasSearched && !isDiscoveringLink && !showResults
  const showNoMatches = hasSearched && !isDiscoveringLink && !showResults

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 left-0 top-0 grid h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">Add music</DialogTitle>
        <DialogDescription className="sr-only">
          Upload audio from your device or pull songs in from a link.
        </DialogDescription>

        {/* Header */}
        <header className="relative z-20 flex shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-xl md:px-8 md:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/20">
              <Music2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold leading-tight tracking-tight md:text-lg">
                Add music
              </div>
              <div className="hidden truncate text-xs text-muted-foreground sm:block">
                Bring songs into your library from anywhere.
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Close add music"
          >
            <X className="h-5 w-5" />
          </Button>
        </header>

        {/* Body */}
        <div className="relative min-h-0 overflow-y-auto">
          {/* Ambient backdrop */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(255,150,80,0.18)_0%,rgba(255,150,80,0.06)_30%,transparent_70%)]"
          />

          <div className="relative mx-auto w-full max-w-5xl px-4 pb-32 pt-8 md:px-8 md:pt-14">
            {/* Tab switcher */}
            <div className="flex justify-center">
              <div
                role="tablist"
                aria-label="Add music method"
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 p-1 shadow-sm backdrop-blur"
              >
                <TabButton
                  active={tab === 'youtube'}
                  onClick={() => setTab('youtube')}
                  icon={<Search className="h-4 w-4" />}
                  label="Search & link"
                />
                <TabButton
                  active={tab === 'upload'}
                  onClick={() => setTab('upload')}
                  icon={<Upload className="h-4 w-4" />}
                  label="Upload files"
                />
              </div>
            </div>

            {tab === 'youtube' ? (
              <SearchPanel
                inputRef={inputRef}
                url={url}
                setUrl={setUrl}
                error={error}
                setError={setError}
                onSubmit={onSubmit}
                onSuggestionClick={onSuggestionClick}
                isDiscoveringLink={isDiscoveringLink}
                isImportingLink={isImportingLink}
                pendingResultId={pendingResultId}
                externalResults={externalResults}
                showResults={showResults}
                showEmptySearchHint={showEmptySearchHint}
                showNoMatches={showNoMatches}
                onImport={handleImport}
                canImportExternal={canImportExternal}
              />
            ) : (
              <UploadPanel
                fileInputRef={fileInputRef}
                dragOver={dragOver}
                setDragOver={setDragOver}
                onDrop={onDrop}
                onPickFiles={onPickFiles}
                handleFiles={handleFiles}
              />
            )}

            {/* Imports — shared across tabs */}
            {downloads.length > 0 && <ImportsList downloads={downloads} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Tab switcher                                                       */
/* ------------------------------------------------------------------ */

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-all',
        active
          ? 'bg-foreground text-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Search panel                                                       */
/* ------------------------------------------------------------------ */

type SearchPanelProps = {
  inputRef: React.RefObject<HTMLInputElement | null>
  url: string
  setUrl: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  onSubmit: (e: React.FormEvent) => void
  onSuggestionClick: (value: string) => void
  isDiscoveringLink: boolean
  isImportingLink: boolean
  pendingResultId: string | null
  externalResults: ExternalDiscoveryResult[]
  showResults: boolean
  showEmptySearchHint: boolean
  showNoMatches: boolean
  onImport: (result: ExternalDiscoveryResult) => void | Promise<void>
  canImportExternal: (result: ExternalDiscoveryResult) => boolean
}

function SearchPanel({
  inputRef,
  url,
  setUrl,
  error,
  setError,
  onSubmit,
  onSuggestionClick,
  isDiscoveringLink,
  isImportingLink,
  pendingResultId,
  externalResults,
  showResults,
  showEmptySearchHint,
  showNoMatches,
  onImport,
  canImportExternal,
}: SearchPanelProps) {
  return (
    <section className="mt-10">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
          What do you want to hear?
        </h1>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">
          Search YouTube or paste a link — we&rsquo;ll bring it into your library.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="mx-auto mt-8 w-full max-w-2xl"
      >
        <div
          className={cn(
            'group relative flex items-center overflow-hidden rounded-full border bg-card/60 backdrop-blur transition-all',
            'focus-within:border-primary/60 focus-within:bg-card focus-within:shadow-[0_0_0_4px_rgba(255,150,80,0.12)]',
            error ? 'border-destructive/60' : 'border-border/70',
          )}
        >
          <Search className="pointer-events-none ml-5 h-5 w-5 shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Song, artist, or YouTube URL"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (error) setError(null)
            }}
            className="h-14 min-w-0 flex-1 bg-transparent px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none md:h-16 md:text-lg"
            aria-label="Search YouTube"
          />
          <Button
            type="submit"
            className="m-1.5 h-11 shrink-0 rounded-full px-5 text-sm font-semibold md:m-2 md:h-12 md:px-6"
            disabled={isDiscoveringLink}
          >
            {isDiscoveringLink ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Searching</span>
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Search</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {/* Quick suggestions */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Try
          </span>
          {QUICK_SEARCHES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onSuggestionClick(q)}
              className="rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </form>

      {/* Results / loading / empty state */}
      <div className="mx-auto mt-12 w-full max-w-3xl">
        {isDiscoveringLink && !showResults && (
          <div className="flex flex-col items-center py-12 text-sm text-muted-foreground">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            </div>
            <p className="mt-4">Searching YouTube&hellip;</p>
          </div>
        )}

        {showResults && (
          <div>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Top results
              </h2>
              <span className="text-xs text-muted-foreground">
                {externalResults.length}{' '}
                {externalResults.length === 1 ? 'match' : 'matches'}
              </span>
            </div>
            <ul className="space-y-2">
              {externalResults.map((result) => (
                <ResultRow
                  key={result.sourceId}
                  result={result}
                  isPending={pendingResultId === result.sourceId && isImportingLink}
                  isAnyPending={isImportingLink && pendingResultId !== null}
                  canImport={canImportExternal(result)}
                  onImport={onImport}
                />
              ))}
            </ul>
          </div>
        )}

        {showEmptySearchHint && (
          <EmptySearchHint />
        )}

        {showNoMatches && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Search className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium">
              No results for &ldquo;{url}&rdquo;
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different spelling or paste a direct YouTube link.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function EmptySearchHint() {
  const tips = [
    {
      icon: <Search className="h-4 w-4" />,
      title: 'Search by title or artist',
      desc: 'We surface the closest matches on YouTube.',
    },
    {
      icon: <ExternalLink className="h-4 w-4" />,
      title: 'Paste a link',
      desc: 'Drop in any YouTube URL to import directly.',
    },
    {
      icon: <Music2 className="h-4 w-4" />,
      title: 'One click to your library',
      desc: 'Tracks are converted and ready to play offline.',
    },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tips.map((t) => (
        <div
          key={t.title}
          className="rounded-xl border border-border/50 bg-card/40 p-4"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {t.icon}
          </div>
          <div className="mt-3 text-sm font-semibold">{t.title}</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t.desc}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Result row                                                         */
/* ------------------------------------------------------------------ */

function ResultRow({
  result,
  isPending,
  isAnyPending,
  canImport,
  onImport,
}: {
  result: ExternalDiscoveryResult
  isPending: boolean
  isAnyPending: boolean
  canImport: boolean
  onImport: (r: ExternalDiscoveryResult) => void | Promise<void>
}) {
  const duration = formatDuration(result.durationMs)
  const blocked = result.eligibility?.state === 'blocked'
  const blockedMessage = blocked ? result.eligibility?.message : null

  return (
    <li className="group relative overflow-hidden rounded-xl border border-border/50 bg-card/50 transition-all hover:border-border hover:bg-card">
      <div className="flex items-center gap-4 p-3">
        {/* Thumbnail */}
        <a
          href={result.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          className="relative block h-[72px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-muted ring-0 ring-primary/0 transition-all hover:ring-2 hover:ring-primary/40 sm:h-[78px] sm:w-[132px]"
          aria-label={`Open ${result.title} on YouTube`}
        >
          {result.thumbnailUrl ? (
            <img
              alt=""
              src={result.thumbnailUrl}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Music2 className="h-6 w-6" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          {duration && (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white tabular-nums">
              {duration}
            </span>
          )}
        </a>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 break-words text-sm font-semibold leading-snug">
                {result.title}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="truncate">
                  {result.creator ?? 'YouTube'}
                </span>
                <span className="hidden h-1 w-1 rounded-full bg-muted-foreground/60 sm:inline-block" />
                <span className="hidden truncate sm:inline">YouTube</span>
              </div>
              {blockedMessage && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {blockedMessage}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden rounded-full text-muted-foreground hover:text-foreground sm:inline-flex"
            asChild
            aria-label="Preview on YouTube"
          >
            <a href={result.canonicalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-full px-4 font-semibold"
            disabled={!canImport || isAnyPending}
            onClick={() => onImport(result)}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Adding</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Add
              </>
            )}
          </Button>
        </div>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Upload panel                                                       */
/* ------------------------------------------------------------------ */

function UploadPanel({
  fileInputRef,
  dragOver,
  setDragOver,
  onDrop,
  onPickFiles,
  handleFiles,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  dragOver: boolean
  setDragOver: (v: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onPickFiles: () => void
  handleFiles: (files: FileList | File[]) => void
}) {
  return (
    <section className="mt-10">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
          Upload from your device
        </h1>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">
          Drop audio files or pick them from your device. They sync everywhere
          you&rsquo;re signed in.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onPickFiles}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onPickFiles()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'group relative mx-auto mt-8 flex max-w-2xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed bg-card/40 px-6 py-16 text-center transition-all',
          dragOver
            ? 'border-primary bg-primary/10 shadow-[0_0_0_6px_rgba(255,150,80,0.10)]'
            : 'border-border/70 hover:border-border hover:bg-card/60',
        )}
      >
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/10 to-transparent opacity-0 transition-opacity',
            dragOver && 'opacity-100',
          )}
        />
        <div
          className={cn(
            'relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary transition-transform',
            dragOver ? 'scale-110' : 'group-hover:scale-105',
          )}
        >
          <FileAudio className="h-9 w-9" />
        </div>
        <div className="mt-5 text-lg font-semibold">
          {dragOver ? 'Drop to upload' : 'Drop audio files here'}
        </div>
        <div className="mt-1.5 text-sm text-muted-foreground">
          or click anywhere to browse your device
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
          {SUPPORTED_FORMATS.map((fmt) => (
            <span
              key={fmt}
              className="rounded-md border border-border/50 bg-background/60 px-2 py-0.5 text-[11px] font-mono font-medium text-muted-foreground"
            >
              {fmt}
            </span>
          ))}
        </div>

        <Button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onPickFiles()
          }}
          className="mt-6 rounded-full px-6 font-semibold"
        >
          <Upload className="h-4 w-4" />
          Choose files
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files)
            e.target.value = ''
          }}
          aria-hidden="true"
        />
      </div>

      <p className="mx-auto mt-5 max-w-2xl text-center text-xs text-muted-foreground">
        Files upload to your authenticated Broadside server and become available
        across all your devices.
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Imports list                                                       */
/* ------------------------------------------------------------------ */

function ImportsList({ downloads }: { downloads: Download[] }) {
  const active = downloads.filter((d) => d.status === 'downloading').length
  return (
    <section className="mx-auto mt-14 max-w-3xl">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Recent imports
        </h2>
        {active > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            {active} in progress
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {downloads.map((d) => (
          <li
            key={d.id}
            className="overflow-hidden rounded-xl border border-border/50 bg-card/50 p-3"
          >
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                {d.thumbnailUrl ? (
                  <img
                    alt=""
                    src={d.thumbnailUrl}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Music2 className="h-5 w-5" />
                  </div>
                )}
                {d.status === 'downloading' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                {d.status === 'complete' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-primary/80">
                    <CheckCircle2 className="h-5 w-5 text-primary-foreground" />
                  </div>
                )}
                {d.status === 'error' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-destructive/80">
                    <AlertCircle className="h-5 w-5 text-destructive-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.artist}
                </div>
                {d.status === 'downloading' && (
                  <div className="mt-2 flex items-center gap-2">
                    <Progress
                      value={Math.round(d.progress * 100)}
                      className="h-1 flex-1"
                    />
                    <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                      {Math.round(d.progress * 100)}%
                    </span>
                  </div>
                )}
                {d.status === 'complete' && (
                  <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <CheckCircle2 className="h-3 w-3" />
                    Added to your library
                  </div>
                )}
                {d.status === 'error' && d.message && (
                  <div className="mt-1 inline-flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {d.message}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
