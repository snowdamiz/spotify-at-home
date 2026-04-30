import type { CsvImportBatch } from '@/lib/api'

export type CsvImportTimeEstimate = {
  elapsedMs: number
  processedItems: number
  remainingItems: number
  remainingMs: number
  rowsPerMinute: number
  totalItems: number
}

export function getCsvImportTimeEstimate(
  batches: CsvImportBatch[] | null | undefined,
  nowMs = Date.now(),
): CsvImportTimeEstimate | null {
  const validBatches = (batches ?? []).filter((batch) => batch.totalItems > 0)

  if (validBatches.length === 0) {
    return null
  }

  const totalItems = validBatches.reduce(
    (total, batch) => total + batch.totalItems,
    0,
  )
  const processedItems = validBatches.reduce(
    (total, batch) =>
      total + Math.min(batch.totalItems, batch.completedItems + batch.failedItems),
    0,
  )
  const remainingItems = Math.max(0, totalItems - processedItems)

  if (processedItems <= 0 || remainingItems <= 0) {
    return null
  }

  const startedAtMs = validBatches.reduce<number | null>((earliest, batch) => {
    if (!batch.startedAt) {
      return earliest
    }

    const timestamp = Date.parse(batch.startedAt)

    if (!Number.isFinite(timestamp)) {
      return earliest
    }

    return earliest === null ? timestamp : Math.min(earliest, timestamp)
  }, null)

  if (startedAtMs === null) {
    return null
  }

  const elapsedMs = nowMs - startedAtMs

  if (elapsedMs <= 0) {
    return null
  }

  const recentRowsPerMinute = recentRowsPerMinuteForBatches(validBatches)
  const rowsPerMinute =
    recentRowsPerMinute ?? processedItems / (elapsedMs / 60_000)

  if (!Number.isFinite(rowsPerMinute) || rowsPerMinute <= 0) {
    return null
  }

  return {
    elapsedMs,
    processedItems,
    remainingItems,
    remainingMs: (remainingItems / rowsPerMinute) * 60_000,
    rowsPerMinute,
    totalItems,
  }
}

function recentRowsPerMinuteForBatches(batches: CsvImportBatch[]) {
  const runningBatchesWithRemainingItems = batches.filter(
    (batch) =>
      batch.status === 'running' &&
      batch.completedItems + batch.failedItems < batch.totalItems,
  )

  if (runningBatchesWithRemainingItems.length === 0) {
    return null
  }

  let rowsPerMinute = 0

  for (const batch of runningBatchesWithRemainingItems) {
    const recentItemsPerMinute = batch.recentItemsPerMinute

    if (
      typeof recentItemsPerMinute !== 'number' ||
      !Number.isFinite(recentItemsPerMinute) ||
      recentItemsPerMinute <= 0
    ) {
      return null
    }

    rowsPerMinute += recentItemsPerMinute
  }

  return rowsPerMinute > 0 ? rowsPerMinute : null
}

export function formatCsvImportTimeEstimate(
  estimate: CsvImportTimeEstimate,
) {
  return `${formatRemainingTime(estimate.remainingMs)} at ${formatRowsPerMinute(
    estimate.rowsPerMinute,
  )}`
}

function formatRemainingTime(remainingMs: number) {
  if (remainingMs < 60_000) {
    return 'Less than 1 min left'
  }

  const totalMinutes = Math.max(1, Math.round(remainingMs / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0
      ? `About ${days} ${pluralize(days, 'day')} ${hours} hr left`
      : `About ${days} ${pluralize(days, 'day')} left`
  }

  if (hours > 0) {
    return minutes > 0
      ? `About ${hours} hr ${minutes} min left`
      : `About ${hours} hr left`
  }

  return `About ${minutes} min left`
}

function formatRowsPerMinute(rowsPerMinute: number) {
  const rounded =
    rowsPerMinute >= 10
      ? Math.round(rowsPerMinute).toString()
      : rowsPerMinute >= 1
        ? rowsPerMinute.toFixed(1)
        : rowsPerMinute.toFixed(2)
  const value = Number.parseFloat(rounded)

  return `${rounded} ${value === 1 ? 'row' : 'rows'}/min`
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`
}
