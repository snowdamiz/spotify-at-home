import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeBroadsideDatabase,
  migrations,
  openBroadsideDatabase,
  runMigrations,
  SQLitePlaylistRepository,
  SQLiteSongRepository,
  SQLiteUserRepository,
  type SqliteDatabase
} from "../src/db";

const createdDatabases: SqliteDatabase[] = [];
const createdDirs: string[] = [];

describe("Phase 3 SQLite schema and repositories", () => {
  afterEach(() => {
    while (createdDatabases.length > 0) {
      closeBroadsideDatabase(createdDatabases.pop()!);
    }

    while (createdDirs.length > 0) {
      rmSync(createdDirs.pop()!, { force: true, recursive: true });
    }
  });

  it("runs migrations repeatedly, creates all tables, enables foreign keys, and uses WAL for file databases", () => {
    const db = openTestFileDatabase();

    runMigrations(db);
    runMigrations(db);

    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "users",
        "oauth_accounts",
        "sessions",
        "songs",
        "playlists",
        "playlist_songs",
        "likes",
        "playback_state",
        "import_jobs",
        "external_sources",
        "schema_migrations"
      ])
    );
    expect(pragmaValue(db, "foreign_keys")).toBe(1);
    expect(String(pragmaValue(db, "journal_mode")).toLowerCase()).toBe("wal");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()
    ).toMatchObject({ count: migrations.length });
  });

  it("keeps song reads scoped to the requesting user", () => {
    const { songRepository, userRepository } = migratedInMemoryDatabase();
    const userA = userRepository.create({ id: "user-a", email: "a@example.com" });
    const userB = userRepository.create({ id: "user-b", email: "b@example.com" });
    const privateSong = songRepository.createSong({
      id: "song-a",
      userId: userA.id,
      title: "Private Track",
      mimeType: "audio/mpeg",
      sizeBytes: 123,
      checksum: "sha256:a",
      storagePath: "/data/audio/user-a/song-a/original"
    });

    expect(songRepository.findSongForUser(userA.id, privateSong.id)?.title).toBe("Private Track");
    expect(songRepository.findSongForUser(userB.id, privateSong.id)).toBeNull();
    expect(songRepository.listSongsForUser(userB.id)).toEqual([]);
  });

  it("returns playlist songs in explicit position order", () => {
    const { playlistRepository, songRepository, userRepository } = migratedInMemoryDatabase();
    const user = userRepository.create({ id: "user-a", email: "a@example.com" });
    const third = songRepository.createSong({
      id: "song-third",
      userId: user.id,
      title: "Third",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:third",
      storagePath: "/data/audio/user-a/song-third/original"
    });
    const first = songRepository.createSong({
      id: "song-first",
      userId: user.id,
      title: "First",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:first",
      storagePath: "/data/audio/user-a/song-first/original"
    });
    const second = songRepository.createSong({
      id: "song-second",
      userId: user.id,
      title: "Second",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:second",
      storagePath: "/data/audio/user-a/song-second/original"
    });
    const playlist = playlistRepository.createPlaylist({
      id: "playlist-a",
      userId: user.id,
      name: "Road Mix"
    });

    playlistRepository.addSong({ userId: user.id, playlistId: playlist.id, songId: third.id, position: 30 });
    playlistRepository.addSong({ userId: user.id, playlistId: playlist.id, songId: first.id, position: 10 });
    playlistRepository.addSong({ userId: user.id, playlistId: playlist.id, songId: second.id, position: 20 });

    expect(playlistRepository.listSongs({ userId: user.id, playlistId: playlist.id }).map((song) => song.title)).toEqual([
      "First",
      "Second",
      "Third"
    ]);
  });

  it("deleting a song removes memberships, likes, playback references, and import jobs", () => {
    const { db, playlistRepository, songRepository, userRepository } = migratedInMemoryDatabase();
    const user = userRepository.create({ id: "user-a", email: "a@example.com" });
    const song = songRepository.createSong({
      id: "song-a",
      userId: user.id,
      title: "Cascade Me",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:cascade",
      storagePath: "/data/audio/user-a/song-a/original"
    });
    const playlist = playlistRepository.createPlaylist({
      id: "playlist-a",
      userId: user.id,
      name: "Cleanup"
    });

    playlistRepository.addSong({ userId: user.id, playlistId: playlist.id, songId: song.id, position: 1 });
    songRepository.likeSong({ userId: user.id, songId: song.id });
    songRepository.setPlaybackState({ userId: user.id, songId: song.id, positionMs: 42 });
    songRepository.createImportJob({ id: "import-a", userId: user.id, songId: song.id, status: "ready" });

    expect(songRepository.deleteSongForUser(user.id, song.id)).toBe(true);

    expect(countRows(db, "playlist_songs")).toBe(0);
    expect(countRows(db, "likes")).toBe(0);
    expect(countRows(db, "import_jobs")).toBe(0);
    expect(db.prepare("SELECT song_id FROM playback_state WHERE user_id = ?").get(user.id)).toMatchObject({
      song_id: null
    });
  });

  it("deleting all songs for a user clears account track references without touching other users", () => {
    const { db, playlistRepository, songRepository, userRepository } = migratedInMemoryDatabase();
    const user = userRepository.create({ id: "user-a", email: "a@example.com" });
    const otherUser = userRepository.create({ id: "user-b", email: "b@example.com" });
    const sharedStoragePath = "/data/audio/external/youtube/shared/original";
    const first = songRepository.createSong({
      id: "song-a",
      userId: user.id,
      title: "First Cleanup",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:first-cleanup",
      storagePath: sharedStoragePath
    });
    const second = songRepository.createSong({
      id: "song-b",
      userId: user.id,
      title: "Second Cleanup",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:second-cleanup",
      storagePath: "/data/audio/user-a/song-b/original"
    });
    songRepository.createSong({
      id: "song-other",
      userId: otherUser.id,
      title: "Still Here",
      mimeType: "audio/mpeg",
      sizeBytes: 10,
      checksum: "sha256:other",
      storagePath: sharedStoragePath
    });
    const playlist = playlistRepository.createPlaylist({
      id: "playlist-a",
      userId: user.id,
      name: "Bulk Cleanup"
    });

    playlistRepository.addSong({ userId: user.id, playlistId: playlist.id, songId: first.id, position: 0 });
    playlistRepository.addSong({ userId: user.id, playlistId: playlist.id, songId: second.id, position: 1 });
    songRepository.likeSong({ userId: user.id, songId: first.id });
    songRepository.setPlaybackState({ userId: user.id, songId: second.id, positionMs: 42 });
    songRepository.createImportJob({ id: "import-a", userId: user.id, songId: first.id, status: "ready" });
    songRepository.createImportJob({ id: "import-b", userId: user.id, songId: second.id, status: "ready" });

    expect(songRepository.deleteAllSongsForUser(user.id)).toBe(2);

    expect(songRepository.listSongsForUser(user.id)).toEqual([]);
    expect(songRepository.listSongsForUser(otherUser.id).map((song) => song.title)).toEqual(["Still Here"]);
    expect(countRows(db, "playlist_songs")).toBe(0);
    expect(countRows(db, "likes")).toBe(0);
    expect(countRows(db, "import_jobs")).toBe(0);
    expect(db.prepare("SELECT song_id FROM playback_state WHERE user_id = ?").get(user.id)).toMatchObject({
      song_id: null
    });
    expect(songRepository.countActiveSongsByStoragePath({ storagePath: sharedStoragePath })).toBe(1);
  });
});

function migratedInMemoryDatabase() {
  const db = openBroadsideDatabase();
  createdDatabases.push(db);
  runMigrations(db);

  return {
    db,
    playlistRepository: new SQLitePlaylistRepository(db),
    songRepository: new SQLiteSongRepository(db),
    userRepository: new SQLiteUserRepository(db)
  };
}

function openTestFileDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "broadside-sqlite-"));
  createdDirs.push(dir);
  const db = openBroadsideDatabase(join(dir, "broadside.sqlite"));
  createdDatabases.push(db);

  return db;
}

function tableNames(db: SqliteDatabase) {
  return db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `
    )
    .all()
    .map((row) => row.name);
}

function pragmaValue(db: SqliteDatabase, pragma: "foreign_keys" | "journal_mode") {
  return Object.values(db.prepare(`PRAGMA ${pragma}`).get() ?? {})[0];
}

function countRows(db: SqliteDatabase, table: "playlist_songs" | "likes" | "import_jobs") {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
}
