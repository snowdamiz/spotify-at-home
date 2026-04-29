import { randomToken } from "../auth/crypto.js";
import type { SqliteDatabase } from "./connection.js";
import type { ExternalSourceProvider, ImportPolicyMode } from "@broadside/shared";

export type ImportStatus = "pending" | "ready" | "failed";
export type RepeatMode = "off" | "one" | "all";

export interface LibraryUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Song {
  id: string;
  userId: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storagePath: string;
  importStatus: ImportStatus;
  externalSource: ExternalSource | null;
  liked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalSource {
  id: string;
  userId: string;
  songId: string;
  provider: ExternalSourceProvider;
  sourceId: string;
  canonicalUrl: string;
  originalTitle: string;
  originalUploader: string | null;
  thumbnailUrl: string | null;
  importPolicyMode: ImportPolicyMode;
  provenance: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportJob {
  id: string;
  userId: string;
  songId: string;
  sourceId: string | null;
  status: ImportStatus;
  errorCode: string | null;
  importPolicyMode: ImportPolicyMode;
  retryCount: number;
  provenance: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type SourcePolicyScopeType = "provider" | "domain" | "channel" | "source";
export type SourcePolicyAction = "allow" | "block" | "review";

export interface SourcePolicy {
  id: string;
  provider: ExternalSourceProvider;
  scopeType: SourcePolicyScopeType;
  scopeValue: string;
  action: SourcePolicyAction;
  enabled: boolean;
  reason: string | null;
  licenseType: string | null;
  licenseUrl: string | null;
  attributionText: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Playlist {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaylistSummary extends Playlist {
  songCount: number;
}

export interface PlaylistSong extends Song {
  position: number;
  addedAt: Date;
}

export interface StorageObjectSummary {
  storagePath: string;
  songCount: number;
  activeSongCount: number;
  sizeBytes: number;
  mimeType: string | null;
  ownerEmails: string[];
  sampleTitle: string | null;
  earliestCreatedAt: Date;
  latestUpdatedAt: Date;
}

export interface PlaybackState {
  userId: string;
  songId: string | null;
  positionMs: number;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  updatedAt: Date | null;
}

export class ExternalSourceAlreadyInLibraryError extends Error {
  constructor(readonly song: Song, readonly source: ExternalSource) {
    super("External source is already in this user's ready library.");
  }
}

export class SQLiteUserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    id?: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const user: LibraryUser = {
      id: input.id ?? randomToken(16),
      email: input.email,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `
          INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        user.id,
        user.email,
        user.displayName,
        user.avatarUrl,
        toSqlDate(user.createdAt),
        toSqlDate(user.updatedAt)
      );

    return user;
  }
}

export class SQLiteSongRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createSong(input: {
    id?: string;
    userId: string;
    title: string;
    artist?: string | null;
    album?: string | null;
    durationMs?: number | null;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    storagePath: string;
    importStatus?: ImportStatus;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const song: Song = {
      id: input.id ?? randomToken(16),
      userId: input.userId,
      title: input.title,
      artist: input.artist ?? null,
      album: input.album ?? null,
      durationMs: input.durationMs ?? null,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      storagePath: input.storagePath,
      importStatus: input.importStatus ?? "ready",
      externalSource: null,
      liked: false,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `
          INSERT INTO songs (
            id, user_id, title, artist, album, duration_ms, mime_type, size_bytes,
            checksum, storage_path, import_status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        song.id,
        song.userId,
        song.title,
        song.artist,
        song.album,
        song.durationMs,
        song.mimeType,
        song.sizeBytes,
        song.checksum,
        song.storagePath,
        song.importStatus,
        toSqlDate(song.createdAt),
        toSqlDate(song.updatedAt)
      );

    return song;
  }

  findSongForUser(userId: string, songId: string) {
    const row = this.db
      .prepare(
        `
          SELECT ${songSelectColumns("songs")}
          FROM songs
          LEFT JOIN external_sources es ON es.song_id = songs.id
          WHERE songs.user_id = ? AND songs.id = ? AND songs.deleted_at IS NULL
        `
      )
      .get(userId, songId);

    return row ? mapSong(row) : null;
  }

  listSongsForUser(userId: string) {
    return this.db
      .prepare(
        `
          SELECT ${songSelectColumns("songs")}
          FROM songs
          LEFT JOIN external_sources es ON es.song_id = songs.id
          WHERE songs.user_id = ? AND songs.deleted_at IS NULL
          ORDER BY songs.created_at DESC, songs.id ASC
        `
      )
      .all(userId)
      .map(mapSong);
  }

  listStoragePathsForUser(userId: string) {
    return this.db
      .prepare(
        `
          SELECT DISTINCT storage_path
          FROM songs
          WHERE user_id = ?
            AND storage_path <> ''
        `
      )
      .all(userId)
      .map((row) => String((row as { storage_path: string }).storage_path));
  }

  listReadySongsForUser(userId: string) {
    return this.db
      .prepare(
        `
          SELECT ${songSelectColumns("songs")}
          FROM songs
          LEFT JOIN external_sources es ON es.song_id = songs.id
          WHERE songs.user_id = ?
            AND songs.import_status = 'ready'
            AND songs.deleted_at IS NULL
          ORDER BY songs.created_at DESC, songs.id ASC
        `
      )
      .all(userId)
      .map(mapSong);
  }

  listRecentReadySongsForUser(userId: string, limit = 10) {
    return this.db
      .prepare(
        `
          SELECT ${songSelectColumns("songs")}
          FROM songs
          LEFT JOIN external_sources es ON es.song_id = songs.id
          WHERE songs.user_id = ?
            AND songs.import_status = 'ready'
            AND songs.deleted_at IS NULL
          ORDER BY songs.created_at DESC, songs.id ASC
          LIMIT ?
        `
      )
      .all(userId, limit)
      .map(mapSong);
  }

  countReadySongsForUser(userId: string) {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM songs
          WHERE user_id = ? AND import_status = 'ready' AND deleted_at IS NULL
        `
      )
      .get(userId) as { count?: number | bigint } | undefined;

    return Number(row?.count ?? 0);
  }

  searchReadySongsForUser(input: { userId: string; query: string; limit?: number; offset?: number }) {
    const pattern = likePattern(input.query);

    return this.db
      .prepare(
        `
          SELECT ${songSelectColumns("songs")}
          FROM songs
          LEFT JOIN external_sources es ON es.song_id = songs.id
          WHERE songs.user_id = ?
            AND songs.import_status = 'ready'
            AND songs.deleted_at IS NULL
            AND (
              songs.title LIKE ? ESCAPE '\\'
              OR songs.artist LIKE ? ESCAPE '\\'
              OR songs.album LIKE ? ESCAPE '\\'
            )
          ORDER BY songs.created_at DESC, songs.id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(input.userId, pattern, pattern, pattern, input.limit ?? 25, input.offset ?? 0)
      .map(mapSong);
  }

  sumReadySongBytesForUser(userId: string) {
    const row = this.db
      .prepare(
        `
          SELECT COALESCE(SUM(size_bytes), 0) AS total
          FROM songs
          WHERE user_id = ? AND import_status = 'ready' AND deleted_at IS NULL
        `
      )
      .get(userId) as { total?: number | bigint } | undefined;

    return Number(row?.total ?? 0);
  }

  countSongsByStoragePath(input: { storagePath: string; exceptSongId?: string }) {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM songs
          WHERE storage_path = ?
            AND (? IS NULL OR id <> ?)
        `
      )
      .get(input.storagePath, input.exceptSongId ?? null, input.exceptSongId ?? null) as
      | { count?: number | bigint }
      | undefined;

    return Number(row?.count ?? 0);
  }

  countActiveSongsByStoragePath(input: { storagePath: string }) {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM songs
          WHERE storage_path = ?
            AND deleted_at IS NULL
        `
      )
      .get(input.storagePath) as { count?: number | bigint } | undefined;

    return Number(row?.count ?? 0);
  }

  listStorageObjectsForAdmin(options: { limit?: number } = {}) {
    const limit = Math.max(1, Math.min(2000, options.limit ?? 1000));

    return this.db
      .prepare(
        `
          SELECT
            songs.storage_path AS storage_path,
            COUNT(*) AS song_count,
            SUM(CASE WHEN songs.deleted_at IS NULL THEN 1 ELSE 0 END) AS active_song_count,
            MAX(songs.size_bytes) AS size_bytes,
            MIN(songs.created_at) AS earliest_created_at,
            MAX(songs.updated_at) AS latest_updated_at,
            MAX(songs.mime_type) AS mime_type,
            (
              SELECT GROUP_CONCAT(DISTINCT users.email)
              FROM songs s2
              JOIN users ON users.id = s2.user_id
              WHERE s2.storage_path = songs.storage_path
            ) AS owner_emails,
            (
              SELECT s3.title
              FROM songs s3
              WHERE s3.storage_path = songs.storage_path
              ORDER BY s3.deleted_at IS NULL DESC, s3.updated_at DESC
              LIMIT 1
            ) AS sample_title
          FROM songs
          WHERE songs.storage_path <> ''
          GROUP BY songs.storage_path
          ORDER BY MAX(songs.updated_at) DESC
          LIMIT ?
        `
      )
      .all(limit)
      .map((row) => mapStorageObjectRow(row as Record<string, unknown>));
  }

  countStorageObjectsForAdmin() {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM (
            SELECT storage_path
            FROM songs
            WHERE storage_path <> ''
            GROUP BY storage_path
          )
        `
      )
      .get() as { count?: number | bigint } | undefined;

    return Number(row?.count ?? 0);
  }

  clearDeletedSongStoragePath(storagePath: string, now = new Date()) {
    const result = this.db
      .prepare(
        `
          UPDATE songs
          SET storage_path = '',
              updated_at = ?
          WHERE storage_path = ?
            AND deleted_at IS NOT NULL
        `
      )
      .run(toSqlDate(now), storagePath);

    return Number(result.changes);
  }

  markSongReady(input: {
    userId: string;
    songId: string;
    checksum: string;
    durationMs?: number | null;
    mimeType?: string;
    sizeBytes?: number;
    storagePath: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();

    this.db.exec("BEGIN;");

    try {
      const result = this.db
        .prepare(
          `
            UPDATE songs
            SET checksum = ?,
                duration_ms = COALESCE(?, duration_ms),
                mime_type = COALESCE(?, mime_type),
                size_bytes = COALESCE(?, size_bytes),
                storage_path = ?,
                import_status = 'ready',
                updated_at = ?
            WHERE user_id = ? AND id = ?
          `
        )
        .run(
          input.checksum,
          input.durationMs ?? null,
          input.mimeType ?? null,
          input.sizeBytes ?? null,
          input.storagePath,
          toSqlDate(now),
          input.userId,
          input.songId
        );

      this.db
        .prepare(
          `
            UPDATE import_jobs
            SET status = 'ready', error_code = NULL, updated_at = ?
            WHERE user_id = ? AND song_id = ?
          `
        )
        .run(toSqlDate(now), input.userId, input.songId);
      this.db.exec("COMMIT;");

      return Number(result.changes) > 0;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  markSongImportFailed(input: {
    userId: string;
    songId: string;
    errorCode: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();

    this.db.exec("BEGIN;");

    try {
      const result = this.db
        .prepare(
          `
            UPDATE songs
            SET import_status = 'failed', updated_at = ?
            WHERE user_id = ? AND id = ?
          `
        )
        .run(toSqlDate(now), input.userId, input.songId);

      this.db
        .prepare(
          `
            UPDATE import_jobs
            SET status = 'failed', error_code = ?, updated_at = ?
            WHERE user_id = ? AND song_id = ?
          `
        )
        .run(input.errorCode, toSqlDate(now), input.userId, input.songId);
      this.db.exec("COMMIT;");

      return Number(result.changes) > 0;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  updateSongForUser(input: {
    userId: string;
    songId: string;
    title?: string;
    artist?: string | null;
    album?: string | null;
    now?: Date;
  }) {
    const existing = this.findSongForUser(input.userId, input.songId);

    if (!existing) {
      return null;
    }

    const updated = {
      title: input.title ?? existing.title,
      artist: input.artist === undefined ? existing.artist : input.artist,
      album: input.album === undefined ? existing.album : input.album,
      updatedAt: input.now ?? new Date()
    };

    this.db
      .prepare(
        `
          UPDATE songs
          SET title = ?, artist = ?, album = ?, updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        updated.title,
        updated.artist,
        updated.album,
        toSqlDate(updated.updatedAt),
        input.userId,
        input.songId
      );

    return this.findSongForUser(input.userId, input.songId);
  }

  deleteSongForUser(userId: string, songId: string, now = new Date()) {
    if (!this.findSongForUser(userId, songId)) {
      return false;
    }

    const deletedAt = toSqlDate(now);

    this.db.exec("BEGIN;");

    try {
      this.db
        .prepare(
          `
            DELETE FROM playlist_songs
            WHERE song_id = ?
              AND playlist_id IN (
                SELECT id
                FROM playlists
                WHERE user_id = ?
              )
          `
        )
        .run(songId, userId);
      this.db
        .prepare(
          `
            DELETE FROM likes
            WHERE user_id = ? AND song_id = ?
          `
        )
        .run(userId, songId);
      this.db
        .prepare(
          `
            DELETE FROM import_jobs
            WHERE user_id = ? AND song_id = ?
          `
        )
        .run(userId, songId);
      this.db
        .prepare(
          `
            UPDATE playback_state
            SET song_id = NULL, updated_at = ?
            WHERE user_id = ? AND song_id = ?
          `
        )
        .run(deletedAt, userId, songId);
      const result = this.db
        .prepare(
          `
            UPDATE songs
            SET deleted_at = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
          `
        )
        .run(deletedAt, deletedAt, userId, songId);

      this.db.exec("COMMIT;");

      return Number(result.changes) > 0;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  deleteAllSongsForUser(userId: string, now = new Date()) {
    const deletedAt = toSqlDate(now);

    this.db.exec("BEGIN;");

    try {
      this.db
        .prepare(
          `
            DELETE FROM playlist_songs
            WHERE song_id IN (
              SELECT id
              FROM songs
              WHERE user_id = ? AND deleted_at IS NULL
            )
          `
        )
        .run(userId);
      this.db
        .prepare(
          `
            DELETE FROM likes
            WHERE song_id IN (
              SELECT id
              FROM songs
              WHERE user_id = ? AND deleted_at IS NULL
            )
          `
        )
        .run(userId);
      this.db
        .prepare(
          `
            DELETE FROM import_jobs
            WHERE song_id IN (
              SELECT id
              FROM songs
              WHERE user_id = ? AND deleted_at IS NULL
            )
          `
        )
        .run(userId);
      this.db
        .prepare(
          `
            UPDATE playback_state
            SET song_id = NULL, updated_at = ?
            WHERE user_id = ?
              AND song_id IN (
                SELECT id
                FROM songs
                WHERE user_id = ? AND deleted_at IS NULL
              )
          `
        )
        .run(deletedAt, userId, userId);
      const result = this.db
        .prepare(
          `
            UPDATE songs
            SET deleted_at = ?, updated_at = ?
            WHERE user_id = ? AND deleted_at IS NULL
          `
        )
        .run(deletedAt, deletedAt, userId);

      this.db.exec("COMMIT;");

      return Number(result.changes);
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  likeSong(input: { userId: string; songId: string; now?: Date }) {
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO likes (user_id, song_id, created_at)
          VALUES (?, ?, ?)
        `
      )
      .run(input.userId, input.songId, toSqlDate(input.now ?? new Date()));
  }

  unlikeSong(input: { userId: string; songId: string }) {
    this.db
      .prepare(
        `
          DELETE FROM likes
          WHERE user_id = ? AND song_id = ?
        `
      )
      .run(input.userId, input.songId);
  }

  listLikedSongsForUser(userId: string, limit = 25) {
    return this.db
      .prepare(
        `
          SELECT ${songSelectColumns("s")}
          FROM likes l
          INNER JOIN songs s ON s.id = l.song_id
          LEFT JOIN external_sources es ON es.song_id = s.id
          WHERE l.user_id = ?
            AND s.user_id = ?
            AND s.import_status = 'ready'
            AND s.deleted_at IS NULL
          ORDER BY l.created_at DESC, s.id ASC
          LIMIT ?
        `
      )
      .all(userId, userId, limit)
      .map(mapSong);
  }

  countLikedSongsForUser(userId: string) {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM likes l
          INNER JOIN songs s ON s.id = l.song_id
          WHERE l.user_id = ?
            AND s.user_id = ?
            AND s.import_status = 'ready'
            AND s.deleted_at IS NULL
        `
      )
      .get(userId, userId) as { count?: number | bigint } | undefined;

    return Number(row?.count ?? 0);
  }

  getPlaybackStateForUser(userId: string): PlaybackState {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM playback_state
          WHERE user_id = ?
        `
      )
      .get(userId);

    if (!row) {
      return {
        userId,
        songId: null,
        positionMs: 0,
        shuffleEnabled: false,
        repeatMode: "off",
        updatedAt: null
      };
    }

    return mapPlaybackState(row);
  }

  setPlaybackState(input: {
    userId: string;
    songId: string | null;
    positionMs?: number;
    shuffleEnabled?: boolean;
    repeatMode?: RepeatMode;
    now?: Date;
  }) {
    this.db
      .prepare(
        `
          INSERT INTO playback_state (
            user_id, song_id, position_ms, shuffle_enabled, repeat_mode, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            song_id = excluded.song_id,
            position_ms = excluded.position_ms,
            shuffle_enabled = excluded.shuffle_enabled,
            repeat_mode = excluded.repeat_mode,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.userId,
        input.songId,
        input.positionMs ?? 0,
        input.shuffleEnabled ? 1 : 0,
        input.repeatMode ?? "off",
        toSqlDate(input.now ?? new Date())
      );
  }

  clearPlaybackStateForUser(userId: string, now = new Date()) {
    this.setPlaybackState({
      userId,
      songId: null,
      positionMs: 0,
      shuffleEnabled: false,
      repeatMode: "off",
      now
    });
  }

  createImportJob(input: {
    id?: string;
    userId: string;
    songId: string;
    sourceId?: string | null;
    status?: ImportStatus;
    errorCode?: string | null;
    importPolicyMode?: ImportPolicyMode;
    retryCount?: number;
    provenance?: Record<string, unknown>;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const job: ImportJob = {
      id: input.id ?? randomToken(16),
      userId: input.userId,
      songId: input.songId,
      sourceId: input.sourceId ?? null,
      status: input.status ?? "pending",
      errorCode: input.errorCode ?? null,
      importPolicyMode: input.importPolicyMode ?? "licensed_only",
      retryCount: input.retryCount ?? 0,
      provenance: input.provenance ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `
          INSERT INTO import_jobs (
            id, user_id, song_id, source_id, status, error_code, import_policy_mode,
            retry_count, provenance_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        job.id,
        job.userId,
        job.songId,
        job.sourceId,
        job.status,
        job.errorCode,
        job.importPolicyMode,
        job.retryCount,
        JSON.stringify(job.provenance),
        toSqlDate(job.createdAt),
        toSqlDate(job.updatedAt)
      );

    return job;
  }

  findImportJobForUser(userId: string, jobId: string) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM import_jobs
          WHERE user_id = ? AND id = ?
        `
      )
      .get(userId, jobId);

    return row ? mapImportJob(row) : null;
  }

  updateImportJobProvenance(input: {
    userId: string;
    jobId: string;
    provenance: Record<string, unknown>;
    now?: Date;
  }) {
    const result = this.db
      .prepare(
        `
          UPDATE import_jobs
          SET provenance_json = ?, updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        JSON.stringify(input.provenance),
        toSqlDate(input.now ?? new Date()),
        input.userId,
        input.jobId
      );

    return Number(result.changes) > 0;
  }

  listFailedImportJobs(limit = 50) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM import_jobs
          WHERE status = 'failed'
          ORDER BY updated_at DESC, id ASC
          LIMIT ?
        `
      )
      .all(limit)
      .map(mapImportJob);
  }

  createExternalSource(input: {
    id?: string;
    userId: string;
    songId: string;
    provider: ExternalSourceProvider;
    sourceId: string;
    canonicalUrl: string;
    originalTitle: string;
    originalUploader?: string | null;
    thumbnailUrl?: string | null;
    importPolicyMode: ImportPolicyMode;
    provenance?: Record<string, unknown>;
    allowReimport?: boolean;
    now?: Date;
  }) {
    if (!input.allowReimport) {
      const duplicate = this.findReadySongByExternalSourceForUser({
        userId: input.userId,
        provider: input.provider,
        sourceId: input.sourceId
      });

      if (duplicate) {
        throw new ExternalSourceAlreadyInLibraryError(duplicate.song, duplicate.source);
      }
    }

    const now = input.now ?? new Date();
    const source: ExternalSource = {
      id: input.id ?? randomToken(16),
      userId: input.userId,
      songId: input.songId,
      provider: input.provider,
      sourceId: input.sourceId,
      canonicalUrl: input.canonicalUrl,
      originalTitle: input.originalTitle,
      originalUploader: input.originalUploader ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      importPolicyMode: input.importPolicyMode,
      provenance: input.provenance ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `
          INSERT INTO external_sources (
            id, user_id, song_id, provider, source_id, canonical_url,
            original_title, original_uploader, thumbnail_url, import_policy_mode,
            provenance_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        source.id,
        source.userId,
        source.songId,
        source.provider,
        source.sourceId,
        source.canonicalUrl,
        source.originalTitle,
        source.originalUploader,
        source.thumbnailUrl,
        source.importPolicyMode,
        JSON.stringify(source.provenance),
        toSqlDate(source.createdAt),
        toSqlDate(source.updatedAt)
      );

    return source;
  }

  findExternalSourceForSong(input: { userId: string; songId: string }) {
    const row = this.db
      .prepare(
        `
          SELECT
            id AS external_source_id,
            user_id AS external_source_user_id,
            song_id AS external_source_song_id,
            provider AS external_source_provider,
            source_id AS external_source_source_id,
            canonical_url AS external_source_canonical_url,
            original_title AS external_source_original_title,
            original_uploader AS external_source_original_uploader,
            thumbnail_url AS external_source_thumbnail_url,
            import_policy_mode AS external_source_import_policy_mode,
            provenance_json AS external_source_provenance_json,
            created_at AS external_source_created_at,
            updated_at AS external_source_updated_at
          FROM external_sources
          WHERE user_id = ? AND song_id = ?
        `
      )
      .get(input.userId, input.songId);

    return row ? mapExternalSource(row) : null;
  }

  updateExternalSourceProvenance(input: {
    userId: string;
    sourceId: string;
    provenance: Record<string, unknown>;
    now?: Date;
  }) {
    const result = this.db
      .prepare(
        `
          UPDATE external_sources
          SET provenance_json = ?, updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        JSON.stringify(input.provenance),
        toSqlDate(input.now ?? new Date()),
        input.userId,
        input.sourceId
      );

    return Number(result.changes) > 0;
  }

  findReadySongByExternalSourceForUser(input: {
    userId: string;
    provider: ExternalSourceProvider;
    sourceId: string;
  }) {
    const row = this.db
      .prepare(
        `
          SELECT ${songSelectColumns("s")}
          FROM external_sources es
          INNER JOIN songs s ON s.id = es.song_id
          WHERE es.user_id = ?
            AND es.provider = ?
            AND es.source_id = ?
            AND s.user_id = ?
            AND s.import_status = 'ready'
            AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC, s.id ASC
          LIMIT 1
        `
      )
      .get(input.userId, input.provider, input.sourceId, input.userId);

    if (!row) {
      return null;
    }

    const song = mapSong(row);

    return song.externalSource ? { song, source: song.externalSource } : null;
  }

  findReadySongByExternalSource(input: {
    provider: ExternalSourceProvider;
    sourceId: string;
  }) {
    const row = this.db
      .prepare(
        `
          SELECT ${songSelectColumns("s")}
          FROM external_sources es
          INNER JOIN songs s ON s.id = es.song_id AND s.user_id = es.user_id
          WHERE es.provider = ?
            AND es.source_id = ?
            AND s.import_status = 'ready'
          ORDER BY
            CASE WHEN s.deleted_at IS NULL THEN 0 ELSE 1 END,
            s.created_at ASC,
            s.id ASC
          LIMIT 1
        `
      )
      .get(input.provider, input.sourceId);

    if (!row) {
      return null;
    }

    const song = mapSong(row);

    return song.externalSource ? { song, source: song.externalSource } : null;
  }

  createSourcePolicy(input: {
    id?: string;
    provider: ExternalSourceProvider;
    scopeType: SourcePolicyScopeType;
    scopeValue: string;
    action: SourcePolicyAction;
    enabled?: boolean;
    reason?: string | null;
    licenseType?: string | null;
    licenseUrl?: string | null;
    attributionText?: string | null;
    createdByUserId?: string | null;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const policy: SourcePolicy = {
      id: input.id ?? randomToken(16),
      provider: input.provider,
      scopeType: input.scopeType,
      scopeValue: normalizePolicyScopeValue(input.scopeValue),
      action: input.action,
      enabled: input.enabled ?? true,
      reason: input.reason ?? null,
      licenseType: input.licenseType ?? null,
      licenseUrl: input.licenseUrl ?? null,
      attributionText: input.attributionText ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.db.exec("BEGIN;");

    try {
      this.db
        .prepare(
          `
            INSERT INTO source_policies (
              id, provider, scope_type, scope_value, action, enabled, reason,
              license_type, license_url, attribution_text, created_by_user_id,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          policy.id,
          policy.provider,
          policy.scopeType,
          policy.scopeValue,
          policy.action,
          policy.enabled ? 1 : 0,
          policy.reason,
          policy.licenseType,
          policy.licenseUrl,
          policy.attributionText,
          policy.createdByUserId,
          toSqlDate(policy.createdAt),
          toSqlDate(policy.updatedAt)
        );

      this.db
        .prepare(
          `
            INSERT INTO source_policy_audit_entries (
              id, policy_id, actor_user_id, action, snapshot_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          randomToken(16),
          policy.id,
          policy.createdByUserId,
          "created",
          JSON.stringify(policy),
          toSqlDate(now)
        );

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return policy;
  }

  listEnabledSourcePolicies(provider: ExternalSourceProvider) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM source_policies
          WHERE provider = ? AND enabled = 1
          ORDER BY updated_at DESC, id ASC
        `
      )
      .all(provider)
      .map(mapSourcePolicy);
  }
}

export class SQLitePlaylistRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findPlaylistForUser(userId: string, playlistId: string) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM playlists
          WHERE user_id = ? AND id = ?
        `
      )
      .get(userId, playlistId);

    return row ? mapPlaylist(row) : null;
  }

  findPlaylistByNameForUser(input: { userId: string; name: string }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM playlists
          WHERE user_id = ?
            AND lower(trim(name)) = lower(trim(?))
          ORDER BY updated_at DESC, id ASC
          LIMIT 1
        `
      )
      .get(input.userId, input.name);

    return row ? mapPlaylist(row) : null;
  }

  nextSongPosition(input: { userId: string; playlistId: string }) {
    const row = this.db
      .prepare(
        `
          SELECT COALESCE(MAX(ps.position) + 1, 0) AS next_position
          FROM playlists p
          LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
          WHERE p.user_id = ? AND p.id = ?
        `
      )
      .get(input.userId, input.playlistId) as { next_position?: number | bigint } | undefined;

    return Number(row?.next_position ?? 0);
  }

  listPlaylistsForUser(userId: string, limit = 25) {
    return this.db
      .prepare(
        `
          SELECT p.*, COUNT(ps.song_id) AS song_count
          FROM playlists p
          LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
          WHERE p.user_id = ?
          GROUP BY p.id
          ORDER BY p.updated_at DESC, p.id ASC
          LIMIT ?
        `
      )
      .all(userId, limit)
      .map(mapPlaylistSummary);
  }

  countPlaylistsForUser(userId: string) {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM playlists
          WHERE user_id = ?
        `
      )
      .get(userId) as { count?: number | bigint } | undefined;

    return Number(row?.count ?? 0);
  }

  searchPlaylistsForUser(input: { userId: string; query: string; limit?: number; offset?: number }) {
    const pattern = likePattern(input.query);

    return this.db
      .prepare(
        `
          SELECT p.*, COUNT(ps.song_id) AS song_count
          FROM playlists p
          LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
          WHERE p.user_id = ?
            AND (
              p.name LIKE ? ESCAPE '\\'
              OR p.description LIKE ? ESCAPE '\\'
            )
          GROUP BY p.id
          ORDER BY p.updated_at DESC, p.id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(input.userId, pattern, pattern, input.limit ?? 25, input.offset ?? 0)
      .map(mapPlaylistSummary);
  }

  createPlaylist(input: {
    id?: string;
    userId: string;
    name: string;
    description?: string | null;
    color?: string | null;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const playlist: Playlist = {
      id: input.id ?? randomToken(16),
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `
          INSERT INTO playlists (
            id, user_id, name, description, color, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        playlist.id,
        playlist.userId,
        playlist.name,
        playlist.description,
        playlist.color,
        toSqlDate(playlist.createdAt),
        toSqlDate(playlist.updatedAt)
      );

    return playlist;
  }

  updatePlaylistForUser(input: {
    userId: string;
    playlistId: string;
    name?: string;
    description?: string | null;
    color?: string | null;
    now?: Date;
  }) {
    const existing = this.findPlaylistForUser(input.userId, input.playlistId);

    if (!existing) {
      return null;
    }

    const updated = {
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      color: input.color === undefined ? existing.color : input.color,
      updatedAt: input.now ?? new Date()
    };

    this.db
      .prepare(
        `
          UPDATE playlists
          SET name = ?, description = ?, color = ?, updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        updated.name,
        updated.description,
        updated.color,
        toSqlDate(updated.updatedAt),
        input.userId,
        input.playlistId
      );

    return this.findPlaylistForUser(input.userId, input.playlistId);
  }

  deletePlaylistForUser(userId: string, playlistId: string) {
    const result = this.db
      .prepare(
        `
          DELETE FROM playlists
          WHERE user_id = ? AND id = ?
        `
      )
      .run(userId, playlistId);

    return Number(result.changes) > 0;
  }

  addSong(input: { userId: string; playlistId: string; songId: string; position?: number; now?: Date }) {
    const ownedPair = this.db
      .prepare(
        `
          SELECT
            EXISTS(SELECT 1 FROM playlists WHERE user_id = ? AND id = ?) AS owns_playlist,
            EXISTS(
              SELECT 1
              FROM songs
              WHERE user_id = ?
                AND id = ?
                AND import_status = 'ready'
                AND deleted_at IS NULL
            ) AS owns_song,
            COALESCE(
              (SELECT MAX(position) + 1 FROM playlist_songs WHERE playlist_id = ?),
              0
            ) AS next_position
        `
      )
      .get(input.userId, input.playlistId, input.userId, input.songId, input.playlistId) as
      | { next_position: number; owns_playlist: number; owns_song: number }
      | undefined;

    if (!ownedPair?.owns_playlist || !ownedPair.owns_song) {
      throw new Error("Playlist and song must belong to the same user");
    }

    const position = input.position ?? Number(ownedPair.next_position);

    this.db
      .prepare(
        `
          INSERT INTO playlist_songs (playlist_id, song_id, position, added_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(playlist_id, song_id) DO UPDATE SET
            position = excluded.position,
            added_at = excluded.added_at
        `
      )
      .run(input.playlistId, input.songId, position, toSqlDate(input.now ?? new Date()));

    this.db
      .prepare(
        `
          UPDATE playlists
          SET updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(toSqlDate(input.now ?? new Date()), input.userId, input.playlistId);
  }

  hasSong(input: { userId: string; playlistId: string; songId: string }) {
    const row = this.db
      .prepare(
        `
          SELECT EXISTS(
            SELECT 1
            FROM playlists p
            INNER JOIN playlist_songs ps ON ps.playlist_id = p.id
            INNER JOIN songs s ON s.id = ps.song_id
            WHERE p.user_id = ?
              AND p.id = ?
              AND ps.song_id = ?
              AND s.user_id = ?
              AND s.import_status = 'ready'
              AND s.deleted_at IS NULL
          ) AS has_song
        `
      )
      .get(input.userId, input.playlistId, input.songId, input.userId) as
      | { has_song: number }
      | undefined;

    return Boolean(row?.has_song);
  }

  removeSong(input: { userId: string; playlistId: string; songId: string; now?: Date }) {
    const playlist = this.findPlaylistForUser(input.userId, input.playlistId);

    if (!playlist) {
      return false;
    }

    this.db
      .prepare(
        `
          DELETE FROM playlist_songs
          WHERE playlist_id = ? AND song_id = ?
        `
      )
      .run(input.playlistId, input.songId);

    this.db
      .prepare(
        `
          UPDATE playlists
          SET updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(toSqlDate(input.now ?? new Date()), input.userId, input.playlistId);

    return true;
  }

  reorderSongs(input: { userId: string; playlistId: string; songIds: string[]; now?: Date }) {
    const currentSongs = this.listSongs({
      userId: input.userId,
      playlistId: input.playlistId
    });
    const currentIds = currentSongs.map((song) => song.id);

    if (
      currentIds.length !== input.songIds.length ||
      new Set(currentIds).size !== new Set(input.songIds).size ||
      input.songIds.some((songId) => !currentIds.includes(songId))
    ) {
      return null;
    }

    this.db.exec("BEGIN;");

    try {
      input.songIds.forEach((songId, index) => {
        this.db
          .prepare(
            `
              UPDATE playlist_songs
              SET position = ?
              WHERE playlist_id = ? AND song_id = ?
            `
          )
          .run(100000 + index, input.playlistId, songId);
      });

      input.songIds.forEach((songId, index) => {
        this.db
          .prepare(
            `
              UPDATE playlist_songs
              SET position = ?
              WHERE playlist_id = ? AND song_id = ?
            `
          )
          .run(index, input.playlistId, songId);
      });

      this.db
        .prepare(
          `
            UPDATE playlists
            SET updated_at = ?
            WHERE user_id = ? AND id = ?
          `
        )
        .run(toSqlDate(input.now ?? new Date()), input.userId, input.playlistId);

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return this.listSongs({
      userId: input.userId,
      playlistId: input.playlistId
    });
  }

  listSongs(input: { userId: string; playlistId: string }) {
    return this.db
      .prepare(
        `
          SELECT
            ${songSelectColumns("s")},
            ps.position AS playlist_position,
            ps.added_at AS playlist_added_at
          FROM playlists p
          INNER JOIN playlist_songs ps ON ps.playlist_id = p.id
          INNER JOIN songs s ON s.id = ps.song_id
          LEFT JOIN external_sources es ON es.song_id = s.id
          WHERE p.user_id = ?
            AND p.id = ?
            AND s.user_id = ?
            AND s.import_status = 'ready'
            AND s.deleted_at IS NULL
          ORDER BY ps.position ASC, ps.added_at ASC, s.id ASC
        `
      )
      .all(input.userId, input.playlistId, input.userId)
      .map((row) => {
        const song = mapSong(row);

        return {
          ...song,
          position: Number(row.playlist_position),
          addedAt: fromSqlDate(row.playlist_added_at)
        };
      });
  }
}

function songSelectColumns(songAlias: string) {
  return `
    ${songAlias}.*,
    EXISTS (
      SELECT 1
      FROM likes liked_song
      WHERE liked_song.user_id = ${songAlias}.user_id
        AND liked_song.song_id = ${songAlias}.id
    ) AS is_liked,
    es.id AS external_source_id,
    es.user_id AS external_source_user_id,
    es.song_id AS external_source_song_id,
    es.provider AS external_source_provider,
    es.source_id AS external_source_source_id,
    es.canonical_url AS external_source_canonical_url,
    es.original_title AS external_source_original_title,
    es.original_uploader AS external_source_original_uploader,
    es.thumbnail_url AS external_source_thumbnail_url,
    es.import_policy_mode AS external_source_import_policy_mode,
    es.provenance_json AS external_source_provenance_json,
    es.created_at AS external_source_created_at,
    es.updated_at AS external_source_updated_at
  `;
}

function mapStorageObjectRow(row: Record<string, unknown>): StorageObjectSummary {
  const ownerEmailsRaw = row.owner_emails;
  const ownerEmails =
    typeof ownerEmailsRaw === "string" && ownerEmailsRaw.length > 0
      ? Array.from(new Set(ownerEmailsRaw.split(",").map((email) => email.trim()).filter(Boolean)))
      : [];

  return {
    storagePath: String(row.storage_path),
    songCount: Number(row.song_count ?? 0),
    activeSongCount: Number(row.active_song_count ?? 0),
    sizeBytes: Number(row.size_bytes ?? 0),
    mimeType: nullableString(row.mime_type),
    ownerEmails,
    sampleTitle: nullableString(row.sample_title),
    earliestCreatedAt: fromSqlDate(row.earliest_created_at),
    latestUpdatedAt: fromSqlDate(row.latest_updated_at)
  };
}

function mapPlaylist(row: Record<string, unknown>): Playlist {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    description: nullableString(row.description),
    color: nullableString(row.color),
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function mapPlaylistSummary(row: Record<string, unknown>): PlaylistSummary {
  return {
    ...mapPlaylist(row),
    songCount: Number(row.song_count ?? 0)
  };
}

function mapSong(row: Record<string, unknown>): Song {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    artist: nullableString(row.artist),
    album: nullableString(row.album),
    durationMs: nullableNumber(row.duration_ms),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    checksum: String(row.checksum),
    storagePath: String(row.storage_path),
    importStatus: row.import_status as ImportStatus,
    externalSource: row.external_source_id ? mapExternalSource(row) : null,
    liked: Boolean(row.is_liked),
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function mapExternalSource(row: Record<string, unknown>): ExternalSource {
  return {
    id: String(row.external_source_id),
    userId: String(row.external_source_user_id),
    songId: String(row.external_source_song_id),
    provider: row.external_source_provider as ExternalSourceProvider,
    sourceId: String(row.external_source_source_id),
    canonicalUrl: String(row.external_source_canonical_url),
    originalTitle: String(row.external_source_original_title),
    originalUploader: nullableString(row.external_source_original_uploader),
    thumbnailUrl: nullableString(row.external_source_thumbnail_url),
    importPolicyMode: row.external_source_import_policy_mode as ImportPolicyMode,
    provenance: parseJsonObject(row.external_source_provenance_json),
    createdAt: fromSqlDate(row.external_source_created_at),
    updatedAt: fromSqlDate(row.external_source_updated_at)
  };
}

function mapImportJob(row: Record<string, unknown>): ImportJob {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    songId: String(row.song_id),
    sourceId: nullableString(row.source_id),
    status: row.status as ImportStatus,
    errorCode: nullableString(row.error_code),
    importPolicyMode: row.import_policy_mode as ImportPolicyMode,
    retryCount: Number(row.retry_count ?? 0),
    provenance: parseJsonObject(row.provenance_json),
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function mapSourcePolicy(row: Record<string, unknown>): SourcePolicy {
  return {
    id: String(row.id),
    provider: row.provider as ExternalSourceProvider,
    scopeType: row.scope_type as SourcePolicyScopeType,
    scopeValue: String(row.scope_value),
    action: row.action as SourcePolicyAction,
    enabled: Boolean(row.enabled),
    reason: nullableString(row.reason),
    licenseType: nullableString(row.license_type),
    licenseUrl: nullableString(row.license_url),
    attributionText: nullableString(row.attribution_text),
    createdByUserId: nullableString(row.created_by_user_id),
    createdAt: fromSqlDate(row.created_at),
    updatedAt: fromSqlDate(row.updated_at)
  };
}

function mapPlaybackState(row: Record<string, unknown>): PlaybackState {
  return {
    userId: String(row.user_id),
    songId: nullableString(row.song_id),
    positionMs: Number(row.position_ms),
    shuffleEnabled: Boolean(row.shuffle_enabled),
    repeatMode: row.repeat_mode as RepeatMode,
    updatedAt: row.updated_at ? fromSqlDate(row.updated_at) : null
  };
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.trim() === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toSqlDate(date: Date) {
  return date.toISOString();
}

function fromSqlDate(value: unknown) {
  return new Date(String(value));
}

function likePattern(query: string) {
  return `%${query.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

function normalizePolicyScopeValue(value: string) {
  return value.trim().toLowerCase();
}
