'use client'

import {
  AlertCircle,
  CheckCircle2,
  ListMusic,
  Loader2,
  RefreshCcw,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { Download } from '@/components/add-music-dialog'
import type { CsvImportItem } from '@/lib/api'
import { cn } from '@/lib/utils'

type CsvImportStatusToastProps = {
  avoidPlayerBar?: boolean
  downloads: Download[]
  hidden?: boolean
  onCancelImport?: (download: Download) => void | Promise<void>
  onMatchCsvImportItem?: (download: Download, item: CsvImportItem) => void
  onOpenImports: () => void
  onRetryCsvImport?: (download: Download) => void | Promise<void>
}

export function CsvImportStatusToast({
  avoidPlayerBar = false,
  downloads,
  hidden = false,
  onCancelImport,
  onMatchCsvImportItem,
  onOpenImports,
  onRetryCsvImport,
}: CsvImportStatusToastProps) {
  const csvDownloads = downloads
    .filter(isCsvImportDownload)
    .sort((a, b) => csvImportPriority(a) - csvImportPriority(b))

  if (hidden || csvDownloads.length === 0) {
    return null
  }

  const activeCount = csvDownloads.filter(
    (download) => download.status === 'downloading',
  ).length
  const needsReviewCount = csvDownloads.reduce(
    (total, download) => total + manualMatchItems(download).length,
    0,
  )
  const visibleDownloads = csvDownloads.slice(0, 2)

  return (
    <aside
      aria-live="polite"
      className={cn(
        'fixed inset-x-3 z-40 transition-[bottom] duration-200 md:left-auto md:right-6 md:w-[420px]',
        avoidPlayerBar
          ? 'bottom-[calc(8rem+env(safe-area-inset-bottom))] md:bottom-24'
          : 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-5',
      )}
    >
      <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[oklch(0.145_0_0_/_0.98)] shadow-[0_24px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.07] backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-white/[0.08] bg-white/[0.018] px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/20">
            {activeCount > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListMusic className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight">
              CSV imports
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {statusSummary(activeCount, needsReviewCount, csvDownloads.length)}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 shrink-0 rounded-full px-3 text-xs"
            onClick={onOpenImports}
          >
            Open
          </Button>
        </div>

        <div className="max-h-[min(56vh,28rem)] overflow-y-auto p-3">
          <ul className="space-y-3">
            {visibleDownloads.map((download) => (
              <CsvImportToastItem
                key={download.id}
                download={download}
                onCancelImport={onCancelImport}
                onMatchCsvImportItem={onMatchCsvImportItem}
                onRetryCsvImport={onRetryCsvImport}
              />
            ))}
          </ul>
          {csvDownloads.length > visibleDownloads.length && (
            <button
              type="button"
              onClick={onOpenImports}
              className="mt-3 w-full rounded-lg border border-dashed border-white/[0.12] bg-white/[0.015] px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-white/[0.035] hover:text-foreground"
            >
              {csvDownloads.length - visibleDownloads.length} more CSV import
              {csvDownloads.length - visibleDownloads.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

function CsvImportToastItem({
  download,
  onCancelImport,
  onMatchCsvImportItem,
  onRetryCsvImport,
}: {
  download: Download
  onCancelImport?: (download: Download) => void | Promise<void>
  onMatchCsvImportItem?: (download: Download, item: CsvImportItem) => void
  onRetryCsvImport?: (download: Download) => void | Promise<void>
}) {
  const progress = Math.round(Math.min(1, Math.max(0, download.progress)) * 100)
  const reviewItems = manualMatchItems(download)
  const retryableCount =
    download.csvImportItems?.filter((item) => item.autoRetryable).length ?? 0
  const pendingCsvCount =
    download.csvImportItems?.filter((item) => item.status === 'pending')
      .length ?? 0
  const runningCsvCount =
    download.csvImportItems?.filter((item) => item.status === 'running')
      .length ?? 0
  const resumableCsvCount = retryableCount + pendingCsvCount + runningCsvCount
  const canResumeCsvImport =
    download.status === 'error' && resumableCsvCount > 0
  const canCancel =
    download.status === 'downloading' && download.cancelable && onCancelImport

  return (
    <li className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 shadow-inner shadow-white/[0.015]">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            download.status === 'error'
              ? 'bg-destructive/10 text-destructive'
              : download.status === 'complete'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {download.status === 'downloading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : download.status === 'complete' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : download.status === 'canceled' ? (
            <X className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {download.title}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {download.artist}
              </div>
            </div>
            {canCancel && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"
                disabled={download.canceling}
                onClick={() => {
                  void onCancelImport(download)
                }}
                aria-label={`Cancel ${download.title}`}
              >
                {download.canceling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Progress value={progress} className="h-1 flex-1" />
            <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
              {progress}%
            </span>
          </div>

          {download.message && (
            <div
              className={cn(
                'mt-2 flex items-center gap-1.5 text-xs',
                download.status === 'error'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{download.message}</span>
            </div>
          )}

          {(canResumeCsvImport || reviewItems.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {canResumeCsvImport && onRetryCsvImport && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 rounded-full px-3 text-xs"
                  disabled={download.retrying}
                  onClick={() => {
                    void onRetryCsvImport(download)
                  }}
                >
                  {download.retrying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  {pendingCsvCount > 0 || runningCsvCount > 0
                    ? `Resume ${resumableCsvCount}`
                    : `Retry ${retryableCount}`}
                </Button>
              )}

              {reviewItems.slice(0, 2).map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 max-w-full rounded-full px-3 text-xs"
                  onClick={() => onMatchCsvImportItem?.(download, item)}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="max-w-40 truncate">{item.title}</span>
                </Button>
              ))}

              {reviewItems.length > 2 && (
                <span className="inline-flex h-8 items-center rounded-full px-2 text-xs text-muted-foreground">
                  +{reviewItems.length - 2} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function isCsvImportDownload(download: Download) {
  return (
    download.id.startsWith('csv-import-') ||
    Boolean(
      download.batchIds?.length ||
        download.csvImportBatches?.length ||
        download.csvImportItems?.length,
    )
  )
}

function manualMatchItems(download: Download) {
  return download.csvImportItems?.filter((item) => item.userMatchRequired) ?? []
}

function csvImportPriority(download: Download) {
  if (manualMatchItems(download).length > 0) return 0
  if (download.status === 'downloading') return 1
  if (download.status === 'error') return 2
  if (download.status === 'complete') return 3
  return 4
}

function statusSummary(
  activeCount: number,
  needsReviewCount: number,
  totalCount: number,
) {
  if (needsReviewCount > 0) {
    return needsReviewCount === 1
      ? '1 track needs your pick'
      : `${needsReviewCount} tracks need your picks`
  }

  if (activeCount > 0) {
    return activeCount === 1
      ? '1 import running'
      : `${activeCount} imports running`
  }

  return totalCount === 1 ? '1 recent import' : `${totalCount} recent imports`
}
