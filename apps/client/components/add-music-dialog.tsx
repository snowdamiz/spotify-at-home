'use client'

import { useCallback, useRef, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  Music,
  Upload,
  X,
} from 'lucide-react'
import type { ExternalDiscoveryResult } from '@tunely/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { isSupportedAudioFile, type ServerImportPolicy } from '@/lib/api'
import {
  PLATFORMS,
  detectPlatform,
  getPlatform,
  isLikelyUrl,
} from '@/lib/url-import'

export type Download = {
  id: string
  url: string
  platform: ReturnType<typeof detectPlatform>
  title: string
  artist: string
  progress: number // 0..1
  status: 'downloading' | 'complete' | 'error'
  message?: string
}

type AddMusicDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  downloads: Download[]
  externalResult: ExternalDiscoveryResult | null
  importPolicy: ServerImportPolicy
  isDiscoveringLink: boolean
  isImportingLink: boolean
  onFilesSelected: (files: FileList | File[]) => void
  onImportExternalResult: (result: ExternalDiscoveryResult) => void | Promise<void>
  onSubmitUrl: (url: string) => void | Promise<void>
}

export function AddMusicDialog({
  open,
  onOpenChange,
  downloads,
  externalResult,
  importPolicy,
  isDiscoveringLink,
  isImportingLink,
  onFilesSelected,
  onImportExternalResult,
  onSubmitUrl,
}: AddMusicDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [tab, setTab] = useState<'upload' | 'link'>('upload')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const detected = url ? detectPlatform(url) : null
  const detectedPlatform = detected ? getPlatform(detected) : null

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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      setError('Paste a link to get started.')
      return
    }
    if (!isLikelyUrl(url)) {
      setError("That doesn't look like a valid URL.")
      return
    }
    setError(null)
    void onSubmitUrl(url.trim())
  }

  const canImportExternal =
    externalResult?.eligibility?.state === 'importable' ||
    (externalResult?.importPolicyMode === 'open_test' &&
      importPolicy.mode === 'open_test')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto bg-card p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-xl">Add music</DialogTitle>
          <DialogDescription>
            Upload audio from your device or pull songs in from a link.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'upload' | 'link')}
          className="px-6 pt-4 pb-6"
        >
          <TabsList className="grid w-full grid-cols-2 bg-muted">
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link2 className="h-4 w-4" />
              From link
            </TabsTrigger>
          </TabsList>

          {/* Upload tab */}
          <TabsContent value="upload" className="mt-5">
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
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/40 px-6 py-10 text-center transition-colors',
                dragOver && 'border-primary bg-primary/5',
              )}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Upload className="h-6 w-6" />
              </div>
              <div className="mt-3 text-sm font-semibold">
                Drop audio files here
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                MP3, WAV, OGG, FLAC, M4A
              </div>
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPickFiles()
                }}
                className="mt-4 rounded-full"
                variant="secondary"
              >
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
            <p className="mt-3 text-xs text-muted-foreground">
              Files are uploaded to your authenticated Tunely server and become
              available across your devices.
            </p>
          </TabsContent>

          {/* Link tab */}
          <TabsContent value="link" className="mt-5">
            <form onSubmit={onSubmit}>
              <label
                htmlFor="add-music-url"
                className="text-sm font-semibold"
              >
                Paste a link
              </label>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="add-music-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      if (error) setError(null)
                    }}
                    className="h-10 bg-background pl-9"
                  />
                </div>
                <Button
                  type="submit"
                  className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={isDiscoveringLink}
                >
                  {isDiscoveringLink ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Discover'
                  )}
                </Button>
              </div>
              {error && (
                <p className="mt-2 text-xs text-destructive">{error}</p>
              )}
              {detectedPlatform && !error && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full',
                      detectedPlatform.dotClass,
                    )}
                    aria-hidden="true"
                  />
                  Detected:{' '}
                  <span className="font-medium text-foreground">
                    {detectedPlatform.name}
                  </span>
                </p>
              )}
            </form>

            <section className="mt-5 rounded-lg border border-border bg-background/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Import policy
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {importPolicy.copy.badge}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {importPolicy.copy.description}
                  </p>
                </div>
              </div>
            </section>

            {externalResult && (
              <section className="mt-3 rounded-lg border border-border bg-background/80 p-3">
                <div className="flex gap-3">
                  {externalResult.thumbnailUrl ? (
                    <img
                      alt=""
                      src={externalResult.thumbnailUrl}
                      className="h-16 w-16 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Music className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {externalResult.title}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {externalResult.creator ?? 'YouTube'}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {externalResult.eligibility?.message ??
                        importPolicy.copy.description}
                    </p>
                    {externalResult.attributionText && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {externalResult.attributionText}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    disabled={!canImportExternal || isImportingLink}
                    onClick={() => onImportExternalResult(externalResult)}
                  >
                    {isImportingLink ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Add to Library
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    asChild
                  >
                    <a
                      href={externalResult.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Preview
                    </a>
                  </Button>
                </div>
              </section>
            )}

            <div className="mt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Supported services
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                      p.badgeClass,
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-1.5 w-1.5 rounded-full',
                        p.dotClass,
                      )}
                      aria-hidden="true"
                    />
                    {p.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Active downloads */}
            {downloads.length > 0 && (
              <div className="mt-6">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Imports
                </div>
                <ul className="mt-2 space-y-2">
                  {downloads.map((d) => {
                    const platform = getPlatform(d.platform)
                    return (
                      <li
                        key={d.id}
                        className="rounded-xl border border-border bg-background/60 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            {d.status === 'downloading' && (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {d.status === 'complete' && (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            )}
                            {d.status === 'error' && (
                              <X className="h-4 w-4 text-destructive" />
                            )}
                            {d.status === 'downloading' &&
                              d.progress === 0 && (
                                <Music className="h-4 w-4" aria-hidden />
                              )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-medium">
                                {d.title}
                              </div>
                              {platform && (
                                <span
                                  className={cn(
                                    'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                                    platform.badgeClass,
                                  )}
                                >
                                  {platform.name}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {d.artist}
                            </div>
                            {d.status === 'downloading' && (
                              <div className="mt-2 flex items-center gap-2">
                                <Progress
                                  value={Math.round(d.progress * 100)}
                                  className="h-1.5 flex-1"
                                />
                                <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                                  {Math.round(d.progress * 100)}%
                                </span>
                              </div>
                            )}
                            {d.status === 'complete' && (
                              <div className="mt-1 text-xs text-primary">
                                Added to your library
                              </div>
                            )}
                            {d.status === 'error' && d.message && (
                              <div className="mt-1 text-xs text-destructive">
                                {d.message}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
