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

export interface PlaylistSong extends Song {
  position: number;
  addedAt: Date;
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

  addSong(input: { userId: string; playlistId: string; songId: string; position: number; now?: Date }) {
    const ownedPair = this.db
      .prepare(
        `
          SELECT
            EXISTS(SELECT 1 FROM playlists WHERE user_id = ? AND id = ?) AS owns_playlist,
            EXISTS(SELECT 1 FROM songs WHERE user_id = ? AND id = ?) AS owns_song
        `
      )
      .get(input.userId, input.playlistId, input.userId, input.songId) as
      | { owns_playlist: number; owns_song: number }
      | undefined;

    if (!ownedPair?.owns_playlist || !ownedPair.owns_song) {
      throw new Error("Playlist and song must belong to the same user");
    }

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
      .run(input.playlistId, input.songId, input.position, toSqlDate(input.now ?? new Date()));
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
