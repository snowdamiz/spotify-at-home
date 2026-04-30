import type { ImportPolicyMode } from "@broadside/shared";
import { randomToken } from "../auth/crypto.js";
import type { SqliteDatabase } from "../db/index.js";

export type CsvImportBatchStatus = "pending" | "running" | "completed" | "failed";
export type CsvImportItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface CsvPlaylistTarget {
  playlistId: string;
  playlistName: string;
  position: number;
}

export interface CsvImportBatch {
  id: string;
  userId: string;
  importPolicyMode: ImportPolicyMode;
  status: CsvImportBatchStatus;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CsvImportItem {
  id: string;
  batchId: string;
  userId: string;
  fileName: string;
  playlistName: string;
  sourceKey: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  sourceUrl: string | null;
  isrc: string | null;
  searchQuery: string;
  likeAfterImport: boolean;
  playlistTargets: CsvPlaylistTarget[];
  status: CsvImportItemStatus;
  songId: string | null;
  youtubeSourceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CsvImportItemInput {
  album?: string | null;
  artist?: string | null;
  artworkUrl?: string | null;
  durationMs?: number | null;
  fileName: string;
  isrc?: string | null;
  likeAfterImport: boolean;
  playlistName: string;
  playlistTargets: CsvPlaylistTarget[];
  searchQuery: string;
  sourceKey: string;
  sourceUrl?: string | null;
  title: string;
}

export class SQLiteCsvImportRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createImportBatch(input: {
    userId: string;
    importPolicyMode: ImportPolicyMode;
    items: CsvImportItemInput[];
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const batch: CsvImportBatch = {
      id: randomToken(16),
      userId: input.userId,
      importPolicyMode: input.importPolicyMode,
      status: "pending",
      totalItems: input.items.length,
      completedItems: 0,
      failedItems: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null
    };

    this.db.exec("BEGIN;");

    try {
      this.db
        .prepare(
          `
            INSERT INTO csv_import_batches (
              id, user_id, import_policy_mode, status, total_items,
              completed_items, failed_items, created_at, started_at, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          batch.id,
          batch.userId,
          batch.importPolicyMode,
          batch.status,
          batch.totalItems,
          batch.completedItems,
          batch.failedItems,
          toSqlDate(batch.createdAt),
          null,
          null
        );

      for (const item of input.items) {
        this.db
          .prepare(
            `
              INSERT INTO csv_import_items (
                id, batch_id, user_id, file_name, playlist_name, source_key,
                title, artist, album, duration_ms, artwork_url, source_url, isrc,
                search_query, like_after_import, playlist_targets_json, status,
                created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `
          )
          .run(
            randomToken(16),
            batch.id,
            input.userId,
            item.fileName,
            item.playlistName,
            item.sourceKey,
            item.title,
            item.artist ?? null,
            item.album ?? null,
            item.durationMs ?? null,
            item.artworkUrl ?? null,
            item.sourceUrl ?? null,
            item.isrc ?? null,
            item.searchQuery,
            item.likeAfterImport ? 1 : 0,
            JSON.stringify(item.playlistTargets),
            toSqlDate(now),
            toSqlDate(now)
          );
      }

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return batch;
  }

  findImportBatchForUser(input: { userId: string; batchId: string }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_batches
          WHERE user_id = ? AND id = ?
        `
      )
      .get(input.userId, input.batchId);

    return row ? mapImportBatch(row) : null;
  }

  listImportItemsForBatch(input: { userId: string; batchId: string }) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_items
          WHERE user_id = ? AND batch_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(input.userId, input.batchId)
      .map(mapImportItem);
  }

  listPendingImportItems(input: { userId: string; batchId: string }) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_items
          WHERE user_id = ? AND batch_id = ? AND status = 'pending'
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(input.userId, input.batchId)
      .map(mapImportItem);
  }

  listAttentionImportItemsForBatch(input: {
    userId: string;
    batchId: string;
    errorCodes: string[];
  }) {
    const errorCodes = [...new Set(input.errorCodes.filter(Boolean))];

    if (errorCodes.length === 0) {
      return this.db
        .prepare(
          `
            SELECT *
            FROM csv_import_items
            WHERE user_id = ? AND batch_id = ? AND status = 'running'
            ORDER BY created_at ASC, id ASC
          `
        )
        .all(input.userId, input.batchId)
        .map(mapImportItem);
    }

    const placeholders = errorCodes.map(() => "?").join(", ");

    return this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_items
          WHERE user_id = ?
            AND batch_id = ?
            AND (
              status = 'running'
              OR (status = 'failed' AND error_code IN (${placeholders}))
            )
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(input.userId, input.batchId, ...errorCodes)
      .map(mapImportItem);
  }

  listActiveImportBatchesForUser(input: { userId: string; limit?: number }) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_batches
          WHERE user_id = ? AND status IN ('pending', 'running')
          ORDER BY created_at DESC, id ASC
          LIMIT ?
        `
      )
      .all(input.userId, input.limit ?? 10)
      .map(mapImportBatch);
  }

  findImportItemForUser(input: { userId: string; batchId: string; itemId: string }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_items
          WHERE user_id = ? AND batch_id = ? AND id = ?
        `
      )
      .get(input.userId, input.batchId, input.itemId);

    return row ? mapImportItem(row) : null;
  }

  findLatestCompletedImportItemForSourceKey(input: {
    userId: string;
    sourceKey: string;
    excludeBatchId?: string;
  }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_items
          WHERE user_id = ?
            AND source_key = ?
            AND status IN ('completed', 'skipped')
            AND song_id IS NOT NULL
            AND batch_id != ?
          ORDER BY updated_at DESC, created_at DESC, id ASC
          LIMIT 1
        `
      )
      .get(input.userId, input.sourceKey, input.excludeBatchId ?? "");

    return row ? mapImportItem(row) : null;
  }

  findNextPendingImportItem(input: { userId: string; batchId: string }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM csv_import_items
          WHERE user_id = ? AND batch_id = ? AND status = 'pending'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `
      )
      .get(input.userId, input.batchId);

    return row ? mapImportItem(row) : null;
  }

  resetFailedItemsForRetry(input: {
    userId: string;
    batchId: string;
    errorCodes: string[];
    now?: Date;
  }) {
    const errorCodes = [...new Set(input.errorCodes.filter(Boolean))];

    if (errorCodes.length === 0) {
      return {
        batch: this.findImportBatchForUser(input),
        retriedItems: 0
      };
    }

    const sqlNow = toSqlDate(input.now ?? new Date());
    const placeholders = errorCodes.map(() => "?").join(", ");
    this.db.exec("BEGIN;");

    try {
      const result = this.db
        .prepare(
          `
            UPDATE csv_import_items
            SET status = 'pending',
                song_id = NULL,
                youtube_source_id = NULL,
                error_code = NULL,
                error_message = NULL,
                updated_at = ?
            WHERE user_id = ?
              AND batch_id = ?
              AND status = 'failed'
              AND error_code IN (${placeholders})
          `
        )
        .run(sqlNow, input.userId, input.batchId, ...errorCodes);
      const retriedItems = Number(result.changes);

      if (retriedItems > 0) {
        this.db
          .prepare(
            `
              UPDATE csv_import_batches
              SET status = 'pending',
                  completed_items = (
                    SELECT SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END)
                    FROM csv_import_items
                    WHERE user_id = ? AND batch_id = ?
                  ),
                  failed_items = (
                    SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
                    FROM csv_import_items
                    WHERE user_id = ? AND batch_id = ?
                  ),
                  completed_at = NULL
              WHERE user_id = ? AND id = ?
            `
          )
          .run(
            input.userId,
            input.batchId,
            input.userId,
            input.batchId,
            input.userId,
            input.batchId
          );
      }

      this.db.exec("COMMIT;");

      return {
        batch: this.findImportBatchForUser(input),
        retriedItems
      };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  resetInterruptedItemsForRetry(input: { userId: string; batchId: string; now?: Date }) {
    const sqlNow = toSqlDate(input.now ?? new Date());
    this.db.exec("BEGIN;");

    try {
      const result = this.db
        .prepare(
          `
            UPDATE csv_import_items
            SET status = 'pending',
                song_id = NULL,
                youtube_source_id = NULL,
                error_code = NULL,
                error_message = NULL,
                updated_at = ?
            WHERE user_id = ?
              AND batch_id = ?
              AND status = 'running'
          `
        )
        .run(sqlNow, input.userId, input.batchId);
      const retriedItems = Number(result.changes);

      if (retriedItems > 0) {
        this.db
          .prepare(
            `
              UPDATE csv_import_batches
              SET status = 'pending',
                  completed_items = (
                    SELECT SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END)
                    FROM csv_import_items
                    WHERE user_id = ? AND batch_id = ?
                  ),
                  failed_items = (
                    SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
                    FROM csv_import_items
                    WHERE user_id = ? AND batch_id = ?
                  ),
                  completed_at = NULL
              WHERE user_id = ? AND id = ?
            `
          )
          .run(
            input.userId,
            input.batchId,
            input.userId,
            input.batchId,
            input.userId,
            input.batchId
          );
      }

      this.db.exec("COMMIT;");

      return {
        batch: this.findImportBatchForUser(input),
        retriedItems
      };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  pauseInterruptedRunningImports(input: { now?: Date } = {}) {
    const sqlNow = toSqlDate(input.now ?? new Date());
    this.db.exec("BEGIN;");

    try {
      const batchRows = this.db
        .prepare(
          `
            SELECT id, user_id
            FROM csv_import_batches
            WHERE status = 'running'
          `
        )
        .all() as Array<{ id: string; user_id: string }>;

      const itemResult = this.db
        .prepare(
          `
            UPDATE csv_import_items
            SET status = 'pending',
                song_id = NULL,
                youtube_source_id = NULL,
                error_code = NULL,
                error_message = NULL,
                updated_at = ?
            WHERE status = 'running'
          `
        )
        .run(sqlNow);

      for (const row of batchRows) {
        const counts = this.db
          .prepare(
            `
              SELECT
                SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                COUNT(*) AS total
              FROM csv_import_items
              WHERE user_id = ? AND batch_id = ?
            `
          )
          .get(row.user_id, row.id) as
          | { completed?: number | bigint; failed?: number | bigint; total?: number | bigint }
          | undefined;
        const total = Number(counts?.total ?? 0);
        const completed = Number(counts?.completed ?? 0);
        const failed = Number(counts?.failed ?? 0);
        const done = completed + failed >= total;
        const status: CsvImportBatchStatus = done
          ? failed > 0
            ? "failed"
            : "completed"
          : "failed";

        this.db
          .prepare(
            `
              UPDATE csv_import_batches
              SET status = ?,
                  completed_items = ?,
                  failed_items = ?,
                  completed_at = ?
              WHERE user_id = ? AND id = ?
            `
          )
          .run(status, completed, failed, sqlNow, row.user_id, row.id);
      }

      this.db.exec("COMMIT;");

      return {
        batchesPaused: batchRows.length,
        itemsReset: Number(itemResult.changes)
      };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  markBatchRunning(input: { userId: string; batchId: string; now?: Date }) {
    const now = input.now ?? new Date();

    this.db
      .prepare(
        `
          UPDATE csv_import_batches
          SET status = 'running',
              started_at = COALESCE(started_at, ?)
          WHERE user_id = ? AND id = ? AND status IN ('pending', 'running')
        `
      )
      .run(toSqlDate(now), input.userId, input.batchId);
  }

  markItemRunning(input: { userId: string; itemId: string; now?: Date }) {
    this.db
      .prepare(
        `
          UPDATE csv_import_items
          SET status = 'running',
              error_code = NULL,
              error_message = NULL,
              updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(toSqlDate(input.now ?? new Date()), input.userId, input.itemId);
  }

  markItemCompleted(input: {
    userId: string;
    itemId: string;
    songId: string;
    youtubeSourceId?: string | null;
    now?: Date;
  }) {
    this.db
      .prepare(
        `
          UPDATE csv_import_items
          SET status = 'completed',
              song_id = ?,
              youtube_source_id = ?,
              error_code = NULL,
              error_message = NULL,
              updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        input.songId,
        input.youtubeSourceId ?? null,
        toSqlDate(input.now ?? new Date()),
        input.userId,
        input.itemId
      );
  }

  markItemSkipped(input: {
    userId: string;
    itemId: string;
    songId: string;
    youtubeSourceId?: string | null;
    now?: Date;
  }) {
    this.db
      .prepare(
        `
          UPDATE csv_import_items
          SET status = 'skipped',
              song_id = ?,
              youtube_source_id = ?,
              error_code = NULL,
              error_message = NULL,
              updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        input.songId,
        input.youtubeSourceId ?? null,
        toSqlDate(input.now ?? new Date()),
        input.userId,
        input.itemId
      );
  }

  markItemFailed(input: {
    userId: string;
    itemId: string;
    errorCode: string;
    errorMessage: string;
    now?: Date;
  }) {
    this.db
      .prepare(
        `
          UPDATE csv_import_items
          SET status = 'failed',
              error_code = ?,
              error_message = ?,
              updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        input.errorCode,
        input.errorMessage,
        toSqlDate(input.now ?? new Date()),
        input.userId,
        input.itemId
      );
  }

  markBatchFailedRetainingPending(input: { userId: string; batchId: string; now?: Date }) {
    const counts = this.db
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM csv_import_items
          WHERE user_id = ? AND batch_id = ?
        `
      )
      .get(input.userId, input.batchId) as
      | { completed?: number | bigint; failed?: number | bigint }
      | undefined;

    this.db
      .prepare(
        `
          UPDATE csv_import_batches
          SET completed_items = ?,
              failed_items = ?,
              status = 'failed',
              completed_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        Number(counts?.completed ?? 0),
        Number(counts?.failed ?? 0),
        toSqlDate(input.now ?? new Date()),
        input.userId,
        input.batchId
      );

    return this.findImportBatchForUser(input);
  }

  refreshBatchCounts(input: { userId: string; batchId: string; now?: Date }) {
    const counts = this.db
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COUNT(*) AS total
          FROM csv_import_items
          WHERE user_id = ? AND batch_id = ?
        `
      )
      .get(input.userId, input.batchId) as
      | { completed?: number | bigint; failed?: number | bigint; total?: number | bigint }
      | undefined;
    const total = Number(counts?.total ?? 0);
    const completed = Number(counts?.completed ?? 0);
    const failed = Number(counts?.failed ?? 0);
    const done = completed + failed >= total;
    const status: CsvImportBatchStatus = done ? (failed > 0 ? "failed" : "completed") : "running";

    this.db
      .prepare(
        `
          UPDATE csv_import_batches
          SET completed_items = ?,
              failed_items = ?,
              status = ?,
              completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        completed,
        failed,
        status,
        done ? 1 : 0,
        done ? toSqlDate(input.now ?? new Date()) : null,
        input.userId,
        input.batchId
      );

    return this.findImportBatchForUser(input);
  }

  cancelImportBatch(input: { userId: string; batchId: string; now?: Date }) {
    const batch = this.findImportBatchForUser(input);

    if (!batch) {
      return null;
    }

    if (batch.status !== "pending" && batch.status !== "running") {
      return batch;
    }

    const now = input.now ?? new Date();
    const sqlNow = toSqlDate(now);

    this.db.exec("BEGIN;");

    try {
      this.db
        .prepare(
          `
            UPDATE csv_import_items
            SET status = 'failed',
                error_code = 'csv_import_canceled',
                error_message = 'CSV import canceled.',
                updated_at = ?
            WHERE user_id = ?
              AND batch_id = ?
              AND status IN ('pending', 'running')
          `
        )
        .run(sqlNow, input.userId, input.batchId);

      const counts = this.db
        .prepare(
          `
            SELECT
              SUM(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM csv_import_items
            WHERE user_id = ? AND batch_id = ?
          `
        )
        .get(input.userId, input.batchId) as
        | { completed?: number | bigint; failed?: number | bigint }
        | undefined;

      this.db
        .prepare(
          `
            UPDATE csv_import_batches
            SET status = 'failed',
                completed_items = ?,
                failed_items = ?,
                started_at = COALESCE(started_at, ?),
                completed_at = ?
            WHERE user_id = ? AND id = ?
          `
        )
        .run(
          Number(counts?.completed ?? 0),
          Number(counts?.failed ?? 0),
          sqlNow,
          sqlNow,
          input.userId,
          input.batchId
        );

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return this.findImportBatchForUser(input);
  }
}

function mapImportBatch(row: Record<string, unknown>): CsvImportBatch {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    importPolicyMode: row.import_policy_mode as ImportPolicyMode,
    status: row.status as CsvImportBatchStatus,
    totalItems: Number(row.total_items ?? 0),
    completedItems: Number(row.completed_items ?? 0),
    failedItems: Number(row.failed_items ?? 0),
    createdAt: fromSqlDate(row.created_at),
    startedAt: row.started_at ? fromSqlDate(row.started_at) : null,
    completedAt: row.completed_at ? fromSqlDate(row.completed_at) : null
  };
}

function mapImportItem(row: Record<string, unknown>): CsvImportItem {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    userId: String(row.user_id),
    fileName: String(row.file_name),
    playlistName: String(row.playlist_name),
    sourceKey: String(row.source_key),
    title: String(row.title),
    artist: nullableString(row.artist),
    album: nullableString(row.album),
    durationMs: nullableNumber(row.duration_ms),
    artworkUrl: nullableString(row.artwork_url),
    sourceUrl: nullableString(row.source_url),
    isrc: nullableString(row.isrc),
    searchQuery: String(row.search_query),
    likeAfterImport: Boolean(row.like_after_import),
    playlistTargets: parsePlaylistTargets(row.playlist_targets_json),
    status: row.status as CsvImportItemStatus,
    songId: nullableString(row.song_id),
    youtubeSourceId: nullableString(row.youtube_source_id),
    errorCode: nullableString(row.error_code),
    errorMessage: nullableString(row.error_message),
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function parsePlaylistTargets(value: unknown): CsvPlaylistTarget[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((target) => {
      if (!target || typeof target !== "object") {
        return [];
      }

      const record = target as Record<string, unknown>;
      const playlistId = nullableString(record.playlistId);
      const playlistName = nullableString(record.playlistName);
      const position = Number(record.position);

      return playlistId && playlistName && Number.isFinite(position)
        ? [{ playlistId, playlistName, position: Math.max(0, Math.floor(position)) }]
        : [];
    });
  } catch {
    return [];
  }
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function toSqlDate(date: Date) {
  return date.toISOString();
}

function fromSqlDate(value: unknown) {
  return new Date(String(value));
}
