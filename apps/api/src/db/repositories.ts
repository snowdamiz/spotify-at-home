import { randomToken } from "../auth/crypto.js";
import type { SqliteDatabase } from "./connection.js";

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

export interface PlaybackState {
  userId: string;
  songId: string | null;
  positionMs: number;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  updatedAt: Date | null;
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
          SELECT *
          FROM songs
          WHERE user_id = ? AND id = ?
        `
      )
      .get(userId, songId);

    return row ? mapSong(row) : null;
  }

  listSongsForUser(userId: string) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM songs
          WHERE user_id = ?
          ORDER BY created_at DESC, id ASC
        `
      )
      .all(userId)
      .map(mapSong);
  }

  listReadySongsForUser(userId: string) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM songs
          WHERE user_id = ? AND import_status = 'ready'
          ORDER BY created_at DESC, id ASC
        `
      )
      .all(userId)
      .map(mapSong);
  }

  listRecentReadySongsForUser(userId: string, limit = 10) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM songs
          WHERE user_id = ? AND import_status = 'ready'
          ORDER BY created_at DESC, id ASC
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
          WHERE user_id = ? AND import_status = 'ready'
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
          SELECT *
          FROM songs
          WHERE user_id = ?
            AND import_status = 'ready'
            AND (
              title LIKE ? ESCAPE '\\'
              OR artist LIKE ? ESCAPE '\\'
              OR album LIKE ? ESCAPE '\\'
            )
          ORDER BY created_at DESC, id ASC
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
          WHERE user_id = ? AND import_status = 'ready'
        `
      )
      .get(userId) as { total?: number | bigint } | undefined;

    return Number(row?.total ?? 0);
  }

  markSongReady(input: {
    userId: string;
    songId: string;
    checksum: string;
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
                storage_path = ?,
                import_status = 'ready',
                updated_at = ?
            WHERE user_id = ? AND id = ?
          `
        )
        .run(input.checksum, input.storagePath, toSqlDate(now), input.userId, input.songId);

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

  deleteSongForUser(userId: string, songId: string) {
    const result = this.db.prepare("DELETE FROM songs WHERE user_id = ? AND id = ?").run(userId, songId);

    return Number(result.changes) > 0;
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
          SELECT s.*
          FROM likes l
          INNER JOIN songs s ON s.id = l.song_id
          WHERE l.user_id = ? AND s.user_id = ? AND s.import_status = 'ready'
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
          WHERE l.user_id = ? AND s.user_id = ? AND s.import_status = 'ready'
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
    status?: ImportStatus;
    errorCode?: string | null;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const id = input.id ?? randomToken(16);

    this.db
      .prepare(
        `
          INSERT INTO import_jobs (
            id, user_id, song_id, status, error_code, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.userId,
        input.songId,
        input.status ?? "pending",
        input.errorCode ?? null,
        toSqlDate(now),
        toSqlDate(now)
      );

    return id;
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
              WHERE user_id = ? AND id = ? AND import_status = 'ready'
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
            s.*,
            ps.position AS playlist_position,
            ps.added_at AS playlist_added_at
          FROM playlists p
          INNER JOIN playlist_songs ps ON ps.playlist_id = p.id
          INNER JOIN songs s ON s.id = ps.song_id
          WHERE p.user_id = ? AND p.id = ? AND s.user_id = ?
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

function toSqlDate(date: Date) {
  return date.toISOString();
}

function fromSqlDate(value: unknown) {
  return new Date(String(value));
}

function likePattern(query: string) {
  return `%${query.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}
