import { describe, expect, it } from "vitest";
import {
  closeBroadsideDatabase,
  migrations,
  openBroadsideDatabase,
  runMigrations,
  SQLiteSongRepository,
  SQLiteUserRepository,
  ExternalSourceAlreadyInLibraryError,
  type SqliteDatabase
} from "../src/db";

describe("YouTube Music Phase 1 external import data model", () => {
  it("creates and reads an external source linked to a song", () => {
    const { db, songRepository, userRepository } = migratedInMemoryDatabase();

    try {
      const user = userRepository.create({ id: "user-a", email: "ada@example.com" });
      const song = songRepository.createSong({
        id: "song-youtube-a",
        userId: user.id,
        title: "Normalized Track",
        artist: "Ada Channel",
        durationMs: 123000,
        mimeType: "audio/mpeg",
        sizeBytes: 1024,
        checksum: "sha256:youtube-a",
        storagePath: "/data/audio/user-a/song-youtube-a/original"
      });

      const source = songRepository.createExternalSource({
        id: "source-youtube-a",
        userId: user.id,
        songId: song.id,
        provider: "youtube",
        sourceId: "yt-video-a",
        canonicalUrl: "https://www.youtube.com/watch?v=yt-video-a",
        originalTitle: "Original YouTube Title",
        originalUploader: "Ada Channel",
        thumbnailUrl: "https://i.ytimg.com/vi/yt-video-a/hqdefault.jpg",
        importPolicyMode: "open_test",
        provenance: {
          selectedImportPath: "open_test_adapter",
          watchUrl: "https://www.youtube.com/watch?v=yt-video-a"
        }
      });
      const job = songRepository.createImportJob({
        id: "job-youtube-a",
        userId: user.id,
        songId: song.id,
        sourceId: source.id,
        status: "pending",
        importPolicyMode: "open_test",
        retryCount: 1,
        provenance: {
          adapter: "youtube_open_test"
        }
      });

      expect(songRepository.findExternalSourceForSong({ userId: user.id, songId: song.id })).toMatchObject({
        provider: "youtube",
        sourceId: "yt-video-a",
        canonicalUrl: "https://www.youtube.com/watch?v=yt-video-a",
        importPolicyMode: "open_test",
        provenance: {
          selectedImportPath: "open_test_adapter"
        }
      });
      expect(songRepository.findSongForUser(user.id, song.id)?.externalSource).toMatchObject({
        id: "source-youtube-a",
        originalTitle: "Original YouTube Title"
      });
      expect(songRepository.findImportJobForUser(user.id, job.id)).toMatchObject({
        sourceId: "source-youtube-a",
        status: "pending",
        retryCount: 1,
        importPolicyMode: "open_test",
        provenance: {
          adapter: "youtube_open_test"
        }
      });
      expect(tableNames(db)).toContain("external_sources");
    } finally {
      closeBroadsideDatabase(db);
    }
  });

  it("prevents duplicate ready songs for the same user/source unless reimport is explicit", () => {
    const { db, songRepository, userRepository } = migratedInMemoryDatabase();

    try {
      const user = userRepository.create({ id: "user-a", email: "ada@example.com" });
      const first = createReadySong(songRepository, user.id, "song-first");
      const second = createReadySong(songRepository, user.id, "song-second");

      songRepository.createExternalSource({
        id: "source-first",
        userId: user.id,
        songId: first.id,
        provider: "youtube",
        sourceId: "duplicate-video",
        canonicalUrl: "https://www.youtube.com/watch?v=duplicate-video",
        originalTitle: "Duplicate Video",
        importPolicyMode: "open_test"
      });

      expect(() =>
        songRepository.createExternalSource({
          id: "source-second",
          userId: user.id,
          songId: second.id,
          provider: "youtube",
          sourceId: "duplicate-video",
          canonicalUrl: "https://www.youtube.com/watch?v=duplicate-video",
          originalTitle: "Duplicate Video Again",
          importPolicyMode: "open_test"
        })
      ).toThrow(ExternalSourceAlreadyInLibraryError);

      expect(
        songRepository.findReadySongByExternalSourceForUser({
          userId: user.id,
          provider: "youtube",
          sourceId: "duplicate-video"
        })?.song.id
      ).toBe(first.id);

      expect(
        songRepository.createExternalSource({
          id: "source-second-reimport",
          userId: user.id,
          songId: second.id,
          provider: "youtube",
          sourceId: "duplicate-video",
          canonicalUrl: "https://www.youtube.com/watch?v=duplicate-video",
          originalTitle: "Duplicate Video Again",
          importPolicyMode: "open_test",
          allowReimport: true
        })
      ).toMatchObject({ id: "source-second-reimport" });
    } finally {
      closeBroadsideDatabase(db);
    }
  });

  it("adds external import metadata without disturbing existing uploaded songs", () => {
    const db = openBroadsideDatabase();

    try {
      applyOnlyInitialMigration(db);
      const userRepository = new SQLiteUserRepository(db);
      const songRepository = new SQLiteSongRepository(db);
      const user = userRepository.create({ id: "user-a", email: "ada@example.com" });
      const uploaded = songRepository.createSong({
        id: "local-upload-a",
        userId: user.id,
        title: "Existing Upload",
        mimeType: "audio/mpeg",
        sizeBytes: 2048,
        checksum: "sha256:existing",
        storagePath: "/data/audio/user-a/local-upload-a/original"
      });

      runMigrations(db);

      expect(songRepository.findSongForUser(user.id, uploaded.id)).toMatchObject({
        id: "local-upload-a",
        title: "Existing Upload",
        externalSource: null,
        importStatus: "ready"
      });
      expect(tableNames(db)).toEqual(expect.arrayContaining(["songs", "import_jobs", "external_sources"]));
      expect(Number(db.prepare("SELECT COUNT(*) AS count FROM songs").get()?.count)).toBe(1);
    } finally {
      closeBroadsideDatabase(db);
    }
  });
});

function migratedInMemoryDatabase() {
  const db = openBroadsideDatabase();
  runMigrations(db);

  return {
    db,
    songRepository: new SQLiteSongRepository(db),
    userRepository: new SQLiteUserRepository(db)
  };
}

function createReadySong(songRepository: SQLiteSongRepository, userId: string, id: string) {
  return songRepository.createSong({
    id,
    userId,
    title: id,
    mimeType: "audio/mpeg",
    sizeBytes: 10,
    checksum: `sha256:${id}`,
    storagePath: `/data/audio/${userId}/${id}/original`
  });
}

function applyOnlyInitialMigration(db: SqliteDatabase) {
  db.exec(migrations[0]!.up);
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
    migrations[0]!.version,
    migrations[0]!.name
  );
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
