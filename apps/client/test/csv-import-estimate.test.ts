import { describe, expect, it } from 'vitest'
import type { CsvImportBatch } from '../lib/api'
import {
  formatCsvImportTimeEstimate,
  getCsvImportTimeEstimate,
} from '../lib/csv-import-estimate'

describe('CSV import estimates', () => {
  it('estimates remaining time from processed rows and elapsed runtime', () => {
    const estimate = getCsvImportTimeEstimate(
      [
        csvImportBatch({
          completedItems: 20,
          failedItems: 5,
          startedAt: '2026-04-29T12:00:00.000Z',
          totalItems: 100,
        }),
      ],
      Date.parse('2026-04-29T12:10:00.000Z'),
    )

    expect(estimate).toMatchObject({
      elapsedMs: 600_000,
      processedItems: 25,
      remainingItems: 75,
      remainingMs: 1_800_000,
      rowsPerMinute: 2.5,
      totalItems: 100,
    })
  })

  it('waits until there is enough progress to calculate a rate', () => {
    expect(
      getCsvImportTimeEstimate([
        csvImportBatch({
          completedItems: 0,
          failedItems: 0,
          startedAt: '2026-04-29T12:00:00.000Z',
          totalItems: 100,
        }),
      ]),
    ).toBeNull()
  })

  it('formats the estimate for compact status surfaces', () => {
    expect(
      formatCsvImportTimeEstimate({
        elapsedMs: 1,
        processedItems: 1,
        remainingItems: 1,
        remainingMs: 8_820_000,
        rowsPerMinute: 4.96,
        totalItems: 2,
      }),
    ).toBe('About 2 hr 27 min left at 5.0 rows/min')
  })
})

function csvImportBatch(input: Partial<CsvImportBatch>): CsvImportBatch {
  return {
    completedAt: null,
    completedItems: 0,
    createdAt: '2026-04-29T11:59:00.000Z',
    failedItems: 0,
    id: 'batch-1',
    importPolicyMode: 'licensed_only',
    startedAt: null,
    status: 'running',
    totalItems: 0,
    userId: 'user-1',
    ...input,
  }
}
