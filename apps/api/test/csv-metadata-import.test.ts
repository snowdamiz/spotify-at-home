import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalDiscoveryResult, ImportPolicyMode } from "@broadside/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import { closeBroadsideDatabase, openBroadsideDatabase, type SqliteDatabase } from "../src/db";
import { YouTubeDiscoveryError, type YouTubeDiscoveryClient } from "../src/external-discovery/youtube";
import type { YouTubeImportAdapter } from "../src/external-imports/youtubeAdapter";
import type { LibraryEventSink } from "../src/library/events";
import type { AudioImportProcessor } from "../src/songs/audio-processing";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.broadside.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://broadside.test"],
  adminEmails: ["ada@example.com"]
};

describe("CSV metadata imports", () => {
  const apps = new Set<ReturnType<typeof createApiApp>>();
  const databases: SqliteDatabase[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();

    while (databases.length > 0) {
      closeBroadsideDatabase(databases.pop()!);
    }

    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }

    vi.restoreAllMocks();
  });

  it("imports Exportify CSV metadata through the queued YouTube import pipeline", async () => {
    const youtubeProvider = createYouTubeProvider();
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app, storageRoot } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ]),
      csvFile("road_mix.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:road", "Road Song", "spotify:artist:grace", "Grace", "spotify:album:drive", "Drive", "spotify:artist:grace", "Grace", "2026-01-01", "https://i.scdn.co/image/road", "1", "2", "210000", "", "false", "40", "USROAD000001", "", "2026-01-03T00:00:00Z"]
      ])
    ];

    const preview = await app.inject({
      method: "POST",
      url: "/api/csv-imports/preview",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      csvImport: {
        files: [
          {
            fileName: "liked.csv",
            playlistName: "Liked",
            trackCount: 1
          },
          {
            fileName: "road_mix.csv",
            playlistName: "Road Mix",
            trackCount: 2
          }
        ],
        totalTracks: 3
      }
    });

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json()).toMatchObject({
      batch: {
        completedItems: 2,
        failedItems: 0,
        status: "completed",
        totalItems: 2
      }
    });
    expect(youtubeProvider.search).toHaveBeenCalledTimes(2);
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledTimes(2);

    const songs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(songs.statusCode).toBe(200);
    expect(songs.json().songs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          liked: true,
          title: "Moon Song",
          externalSource: expect.objectContaining({
            provider: "youtube",
            provenance: expect.objectContaining({
              csv: expect.objectContaining({
                fileName: "liked.csv",
                isrc: "USMOON000001",
                sourceKey: "track:moon"
              }),
              searchSource: "csv_metadata"
            })
          })
        }),
        expect.objectContaining({
          liked: false,
          title: "Road Song"
        })
      ])
    );

    for (const song of songs.json().songs) {
      expect(song.storagePath.startsWith(storageRoot)).toBe(true);
      expect(statSync(song.storagePath).size).toBeGreaterThan(0);
    }

    const playlists = await app.inject({
      method: "GET",
      url: "/api/playlists",
      headers: { authorization: `Bearer ${token}` }
    });
    const roadMix = playlists.json().playlists.find(
      (playlist: { name: string }) => playlist.name === "Road Mix"
    );
    const liked = playlists.json().playlists.find(
      (playlist: { name: string }) => playlist.name === "Liked"
    );

    expect(roadMix).toMatchObject({ songCount: 2 });
    expect(liked).toMatchObject({ songCount: 1 });

    const playlist = await app.inject({
      method: "GET",
      url: `/api/playlists/${roadMix.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(playlist.json().playlist.songs.map((song: { title: string }) => song.title)).toEqual([
      "Moon Song",
      "Road Song"
    ]);
  });

  it("merges CSV imports into an existing same-name playlist", async () => {
    const youtubeProvider = createYouTubeProvider();
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app, db, storageRoot } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const user = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("ada@example.com") as { id: string };
    const now = new Date().toISOString();

    db.prepare(
      `
        INSERT INTO songs (
          id, user_id, title, artist, album, duration_ms, mime_type, size_bytes,
          checksum, storage_path, import_status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      `
    ).run(
      "existing-mix-song",
      user.id,
      "Existing Song",
      "Ada",
      "Archive",
      180000,
      "audio/mpeg",
      3,
      "existing-checksum",
      join(storageRoot, "existing-mix-song.mp3"),
      now,
      now
    );

    const createdPlaylist = await app.inject({
      method: "POST",
      url: "/api/playlists",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Mix" }
    });
    const playlistId = createdPlaylist.json().playlist.id;

    await app.inject({
      method: "POST",
      url: `/api/playlists/${playlistId}/songs`,
      headers: { authorization: `Bearer ${token}` },
      payload: { songId: "existing-mix-song" }
    });

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        files: [
          csvFile("mix.csv", [
            ["spotify:track:road", "Road Song", "spotify:artist:grace", "Grace", "spotify:album:drive", "Drive", "spotify:artist:grace", "Grace", "2026-01-01", "https://i.scdn.co/image/road", "1", "1", "210000", "", "false", "40", "USROAD000001", "", "2026-01-03T00:00:00Z"]
          ])
        ]
      }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 1,
      failedItems: 0,
      status: "completed"
    });

    const playlists = await app.inject({
      method: "GET",
      url: "/api/playlists",
      headers: { authorization: `Bearer ${token}` }
    });
    const mixes = playlists.json().playlists.filter(
      (playlist: { name: string }) => playlist.name === "Mix"
    );

    expect(mixes).toHaveLength(1);
    expect(mixes[0]).toMatchObject({
      id: playlistId,
      songCount: 2
    });

    const playlist = await app.inject({
      method: "GET",
      url: `/api/playlists/${playlistId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(playlist.json().playlist.songs.map((song: { title: string }) => song.title)).toEqual([
      "Existing Song",
      "Road Song"
    ]);
  });

  it("normalizes CSV imported audio before storing it", async () => {
    const normalizedAudio = Buffer.from("ID3 normalized csv import audio");
    const youtubeProvider = createYouTubeProvider();
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const audioProcessor: AudioImportProcessor = {
      process: vi.fn(async (input) => ({
        content: normalizedAudio,
        durationMs: input.durationMs,
        fileName: `${input.fileName}.normalized.mp3`,
        mimeType: "audio/mpeg",
        provenance: {
          audioNormalization: {
            applied: true
          }
        }
      }))
    };
    const { app } = createTestApp({
      audioProcessor,
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(audioProcessor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "youtubeMoon01.mp3",
        mimeType: "audio/mpeg"
      })
    );

    const songs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: { authorization: `Bearer ${token}` }
    });
    const [song] = songs.json().songs;

    expect(readFileSync(song.storagePath)).toEqual(normalizedAudio);
    expect(song).toMatchObject({
      externalSource: {
        provenance: {
          audioNormalization: {
            applied: true
          }
        }
      },
      mimeType: "audio/mpeg",
      sizeBytes: normalizedAudio.byteLength
    });
  });

  it("imports multiple CSV tracks concurrently while preserving playlist membership", async () => {
    const resolveGate = deferred();
    const firstThreeResolvesStarted = deferred();
    let activeResolves = 0;
    let maxActiveResolves = 0;
    let resolveStarts = 0;
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (query, importPolicyMode) => {
        const match = /Concurrent Song (\d+)/.exec(query);
        const index = match?.[1] ?? "1";

        return {
          nextPageToken: null,
          results: [
            youtubeResult({
              creator: `Parallel Artist ${index}`,
              durationMs: 180000,
              importPolicyMode,
              sourceId: `youtubeConcurrent${index}`,
              title: `Concurrent Song ${index} Official Audio`
            })
          ]
        };
      })
    };
    const youtubeImportAdapter: YouTubeImportAdapter = {
      resolve: vi.fn(async ({ discovery }) => {
        activeResolves += 1;
        resolveStarts += 1;
        maxActiveResolves = Math.max(maxActiveResolves, activeResolves);

        if (resolveStarts === 3) {
          firstThreeResolvesStarted.resolve();
        }

        await resolveGate.promise;
        activeResolves -= 1;

        return {
          adapter: "slow_test_youtube_adapter",
          content: Buffer.concat([Buffer.from("ID3"), Buffer.from(discovery.sourceId)]),
          durationMs: discovery.durationMs,
          fileName: `${discovery.sourceId}.mp3`,
          mimeType: "audio/mpeg",
          provenance: {
            adapter: "slow_test_youtube_adapter"
          }
        };
      })
    };
    const { app } = createTestApp({
      csvImportConcurrency: 3,
      processImportsInline: true,
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("concurrent.csv", [
        ["spotify:track:one", "Concurrent Song 1", "spotify:artist:one", "Parallel Artist 1", "spotify:album:bulk", "Bulk", "spotify:artist:bulk", "Bulk", "2026-01-01", "https://i.scdn.co/image/one", "1", "1", "180000", "", "false", "50", "USCON0000001", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:two", "Concurrent Song 2", "spotify:artist:two", "Parallel Artist 2", "spotify:album:bulk", "Bulk", "spotify:artist:bulk", "Bulk", "2026-01-01", "https://i.scdn.co/image/two", "1", "2", "180000", "", "false", "50", "USCON0000002", "", "2026-01-03T00:00:00Z"],
        ["spotify:track:three", "Concurrent Song 3", "spotify:artist:three", "Parallel Artist 3", "spotify:album:bulk", "Bulk", "spotify:artist:bulk", "Bulk", "2026-01-01", "https://i.scdn.co/image/three", "1", "3", "180000", "", "false", "50", "USCON0000003", "", "2026-01-04T00:00:00Z"],
        ["spotify:track:four", "Concurrent Song 4", "spotify:artist:four", "Parallel Artist 4", "spotify:album:bulk", "Bulk", "spotify:artist:bulk", "Bulk", "2026-01-01", "https://i.scdn.co/image/four", "1", "4", "180000", "", "false", "50", "USCON0000004", "", "2026-01-05T00:00:00Z"]
      ])
    ];

    const batchPromise = app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    }).then((response) => response);

    await firstThreeResolvesStarted.promise;
    expect(maxActiveResolves).toBe(3);
    resolveGate.resolve();

    const batch = await batchPromise;

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 4,
      failedItems: 0,
      status: "completed",
      totalItems: 4
    });

    const playlists = await app.inject({
      method: "GET",
      url: "/api/playlists",
      headers: { authorization: `Bearer ${token}` }
    });
    const playlist = playlists.json().playlists.find(
      (item: { name: string }) => item.name === "Concurrent"
    );

    expect(playlist).toMatchObject({ songCount: 4 });
  });

  it("reuses stored YouTube audio when a deleted library track is imported from CSV again", async () => {
    const youtubeProvider = createYouTubeProvider();
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const firstBatch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(firstBatch.statusCode).toBe(202);
    expect(firstBatch.json()).toMatchObject({
      batch: {
        completedItems: 1,
        failedItems: 0,
        status: "completed"
      }
    });
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledTimes(1);

    const firstSongs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: { authorization: `Bearer ${token}` }
    });
    const firstSong = firstSongs.json().songs[0];
    const storagePath = firstSong.storagePath;

    expect(firstSongs.statusCode).toBe(200);
    expect(firstSong).toMatchObject({
      externalSource: {
        sourceId: "youtubeMoon01"
      },
      importStatus: "ready",
      title: "Moon Song"
    });
    expect(existsSync(storagePath)).toBe(true);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/songs/${firstSong.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(deleted.statusCode).toBe(204);
    expect(existsSync(storagePath)).toBe(true);

    const secondBatch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(secondBatch.statusCode).toBe(202);
    expect(secondBatch.json()).toMatchObject({
      batch: {
        completedItems: 1,
        failedItems: 0,
        status: "completed"
      }
    });
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledTimes(1);

    const secondSongs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: { authorization: `Bearer ${token}` }
    });
    const secondSong = secondSongs.json().songs[0];

    expect(secondSongs.statusCode).toBe(200);
    expect(secondSong.id).not.toBe(firstSong.id);
    expect(secondSong.storagePath).toBe(storagePath);
    expect(secondSong).toMatchObject({
      externalSource: {
        provenance: {
          selectedImportPath: "shared_artifact_reuse"
        },
        sourceId: "youtubeMoon01"
      },
      importStatus: "ready",
      title: "Moon Song"
    });
  });

  it("emits library change events as CSV import items complete", async () => {
    const libraryEvents: LibraryEventSink = {
      emitLibraryChanged: vi.fn((userId, payload) => ({
        ...payload,
        createdAt: new Date().toISOString(),
        id: "test-event",
        type: "library_changed" as const,
        userId
      }))
    };
    const { app } = createTestApp({
      libraryEvents,
      youtubeImportAdapter: createYouTubeImportAdapter(),
      youtubeProvider: createYouTubeProvider()
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:road", "Road Song", "spotify:artist:grace", "Grace", "spotify:album:drive", "Drive", "spotify:artist:grace", "Grace", "2026-01-01", "https://i.scdn.co/image/road", "1", "2", "210000", "", "false", "40", "USROAD000001", "", "2026-01-03T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(libraryEvents.emitLibraryChanged).toHaveBeenCalledTimes(2);
    expect(libraryEvents.emitLibraryChanged).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        csvImportBatchId: batch.json().batch.id,
        reason: "csv_import_item_completed",
        songId: expect.any(String)
      })
    );
  });

  it("accepts all-playlist-sized CSV preview payloads", async () => {
    const { app } = createTestApp({
      youtubeImportAdapter: createYouTubeImportAdapter(),
      youtubeProvider: createYouTubeProvider()
    });
    const token = await signIn(app);
    const fileName = "everything.csv";
    const csv = largeCsvContent(8_000);
    const files = [{ contentBase64: Buffer.from(csv).toString("base64"), fileName }];

    expect(JSON.stringify({ files }).length).toBeGreaterThan(1_048_576);

    const started = await app.inject({
      method: "POST",
      url: "/api/csv-imports/uploads",
      headers: { authorization: `Bearer ${token}` },
      payload: { fileName }
    });

    expect(started.statusCode).toBe(200);

    const uploadId = started.json().upload.id;
    const csvBuffer = Buffer.from(csv);
    const chunkSize = 256 * 1024;

    for (let offset = 0, chunkIndex = 0; offset < csvBuffer.byteLength; offset += chunkSize, chunkIndex += 1) {
      const chunk = csvBuffer.subarray(offset, offset + chunkSize);
      const uploaded = await app.inject({
        method: "POST",
        url: `/api/csv-imports/uploads/${uploadId}/chunks`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          chunkIndex,
          contentBase64: chunk.toString("base64")
        }
      });

      expect(uploaded.statusCode).toBe(200);
    }

    const preview = await app.inject({
      method: "POST",
      url: "/api/csv-imports/preview",
      headers: { authorization: `Bearer ${token}` },
      payload: { uploads: [{ id: uploadId }] }
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      csvImport: {
        files: [
          {
            fileName: "everything.csv",
            playlistName: "Everything",
            trackCount: 8_000
          }
        ],
        totalTracks: 8_000
      }
    });
  });

  it("scores candidates instead of importing the first weak YouTube result", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => ({
        nextPageToken: null,
        results: [
          youtubeResult({
            creator: "Random Karaoke",
            durationMs: 180000,
            importPolicyMode,
            sourceId: "badKaraoke01",
            title: "Moon Song Karaoke Cover"
          }),
          youtubeResult({
            creator: "Ada - Topic",
            durationMs: 180000,
            importPolicyMode,
            sourceId: "goodMoon01",
            title: "Moon Song Official Audio"
          })
        ]
      }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 1,
      failedItems: 0,
      status: "completed"
    });
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({
          sourceId: "goodMoon01"
        })
      })
    );
    expect(vi.mocked(youtubeProvider.search!).mock.calls.map(([query]) => query)).toEqual([
      "Ada Moon Song"
    ]);
  });

  it("filters Live-titled YouTube results during CSV auto-matching", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => ({
        nextPageToken: null,
        results: [
          youtubeResult({
            creator: "Ada Channel",
            durationMs: 180000,
            importPolicyMode,
            sourceId: "liveMoon01",
            title: "Moon Song Live"
          }),
          youtubeResult({
            creator: "Ada - Topic",
            durationMs: 180000,
            importPolicyMode,
            sourceId: "studioMoon01",
            title: "Moon Song Official Audio"
          })
        ]
      }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 1,
      failedItems: 0,
      status: "completed"
    });
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({
          sourceId: "studioMoon01"
        })
      })
    );
    expect(youtubeImportAdapter.resolve).not.toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({
          sourceId: "liveMoon01"
        })
      })
    );
  });

  it("fails low-confidence YouTube matches instead of importing unrelated audio", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => ({
        nextPageToken: null,
        results: [
          youtubeResult({
            creator: "Talk Channel",
            durationMs: 3600000,
            importPolicyMode,
            sourceId: "wrongPodcast01",
            title: "Completely Different Podcast Episode"
          })
        ]
      }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app, db } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 0,
      failedItems: 1,
      status: "failed"
    });
    expect(youtubeImportAdapter.resolve).not.toHaveBeenCalled();

    const status = await app.inject({
      method: "GET",
      url: `/api/csv-imports/batches/${batch.json().batch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    const failedItem = status.json().items[0];

    expect(failedItem).toMatchObject({
      errorCode: "youtube_match_low_confidence",
      searchQuery: "Ada Moon Song Lunar",
      status: "failed"
    });
    db.prepare("UPDATE csv_import_items SET search_query = ? WHERE id = ?").run(
      "Ada Moon Song Lunar official audio",
      failedItem.id
    );

    const legacyStatus = await app.inject({
      method: "GET",
      url: `/api/csv-imports/batches/${batch.json().batch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(legacyStatus.json().items[0]).toMatchObject({
      searchQuery: "Ada Moon Song Lunar"
    });
  });

  it("imports Unicode titles, collaborator title variants, and duplicate same-track candidates", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (query, importPolicyMode) => {
        const normalizedQuery = query.toLowerCase();

        if (normalizedQuery.includes("улет")) {
          return {
            nextPageToken: null,
            results: [
              youtubeResult({
                creator: "OXXXYMIRON FAMILY",
                durationMs: 151000,
                importPolicyMode,
                sourceId: "youtubeUlet01",
                title: "OXXXYMIRON - Улет (Official Audio)"
              })
            ]
          };
        }

        if (normalizedQuery.includes("stay")) {
          return {
            nextPageToken: null,
            results: [
              youtubeResult({
                creator: "Ace Khalifa Music",
                durationMs: 142000,
                importPolicyMode,
                sourceId: "youtubeStay01",
                title: "The Kid LAROI, Justin Bieber - Stay (Official Audio)"
              })
            ]
          };
        }

        return {
          nextPageToken: null,
          results: [
            youtubeResult({
              creator: "Witt Lowry",
              durationMs: 265000,
              importPolicyMode,
              sourceId: "youtubeMistake01",
              title: "My Mistake (feat. Trippz Michaud)"
            }),
            youtubeResult({
              creator: "RealityTracks",
              durationMs: 266000,
              importPolicyMode,
              sourceId: "youtubeMistake02",
              title: "Witt Lowry - My Mistake (feat. Trippz Michaud)"
            })
          ]
        };
      })
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:ulet", "Улет", "spotify:artist:oxxxymiron", "Oxxxymiron", "spotify:album:krasota", "Красота и Уродство", "spotify:artist:oxxxymiron", "Oxxxymiron", "2026-01-01", "https://i.scdn.co/image/ulet", "1", "1", "150900", "", "false", "50", "QMDA72177297", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:stay", "STAY (with Justin Bieber)", "spotify:artist:kid", "The Kid LAROI, Justin Bieber", "spotify:album:stay", "STAY (with Justin Bieber)", "spotify:artist:kid", "The Kid LAROI", "2026-01-01", "https://i.scdn.co/image/stay", "1", "2", "141805", "", "false", "50", "USSM12103949", "", "2026-01-03T00:00:00Z"],
        ["spotify:track:mistake", "My Mistake (feat. Trippz Michaud)", "spotify:artist:witt", "Witt Lowry, Trippz Michaud", "spotify:album:dreaming", "Dreaming With Our Eyes Open", "spotify:artist:witt", "Witt Lowry", "2026-01-01", "https://i.scdn.co/image/mistake", "1", "3", "264375", "", "false", "50", "TCACI1505440", "", "2026-01-04T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 3,
      failedItems: 0,
      status: "completed",
      totalItems: 3
    });
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({ sourceId: "youtubeUlet01" })
      })
    );
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({ sourceId: "youtubeStay01" })
      })
    );
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({ sourceId: "youtubeMistake01" })
      })
    );
  });

  it("rechecks low-confidence CSV items on retry after matcher improvements", async () => {
    let searchCount = 0;
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => {
        searchCount += 1;

        return {
          nextPageToken: null,
          results: [
            searchCount <= 2
              ? youtubeResult({
                  creator: "Talk Channel",
                  durationMs: 3600000,
                  importPolicyMode,
                  sourceId: `wrongPodcast${searchCount}`,
                  title: "Completely Different Podcast Episode"
                })
              : youtubeResult({
                  creator: "Ada Channel",
                  durationMs: 180000,
                  importPolicyMode,
                  sourceId: "youtubeMoonRecheck01",
                  title: "Moon Song Official Audio"
                })
          ]
        };
      })
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 0,
      failedItems: 1,
      status: "failed"
    });

    const retried = await app.inject({
      method: "POST",
      url: `/api/csv-imports/batches/${batch.json().batch.id}/retry`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      batch: {
        completedItems: 1,
        failedItems: 0,
        status: "completed"
      },
      retriedItems: 1
    });
    expect(retried.json().items[0]).toMatchObject({
      autoRetryable: false,
      status: "completed",
      youtubeSourceId: "youtubeMoonRecheck01"
    });
  });

  it("retries recoverable failed CSV import items", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi
        .fn()
        .mockRejectedValueOnce(
          new YouTubeDiscoveryError(
            "youtube_search_unavailable",
            "YouTube search is temporarily unavailable.",
            502,
            true
          )
        )
        .mockImplementation(async (_query, importPolicyMode) => ({
          nextPageToken: null,
          results: [
            youtubeResult({
              creator: "Ada Channel",
              durationMs: 180000,
              importPolicyMode,
              sourceId: "youtubeMoonRetry01",
              title: "Moon Song Official Audio"
            })
          ]
        }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      recoverableSearchAttempts: 1,
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 0,
      failedItems: 1,
      status: "failed"
    });

    const retried = await app.inject({
      method: "POST",
      url: `/api/csv-imports/batches/${batch.json().batch.id}/retry`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      batch: {
        completedItems: 1,
        failedItems: 0,
        status: "completed"
      },
      retriedItems: 1
    });
    expect(retried.json().items[0]).toMatchObject({
      errorCode: null,
      status: "completed",
      youtubeSourceId: "youtubeMoonRetry01"
    });
    expect(youtubeProvider.search).toHaveBeenCalledTimes(2);
  });

  it("resumes interrupted running CSV import items", async () => {
    let allowMatch = false;
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => ({
        nextPageToken: null,
        results: [
          allowMatch
            ? youtubeResult({
                creator: "Ada Channel",
                durationMs: 180000,
                importPolicyMode,
                sourceId: "youtubeMoonInterrupted01",
                title: "Moon Song Official Audio"
              })
            : youtubeResult({
                creator: "Talk Channel",
                durationMs: 3600000,
                importPolicyMode,
                sourceId: "wrongPodcastInterrupted01",
                title: "Completely Different Podcast Episode"
              })
        ]
      }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app, db } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 0,
      failedItems: 1,
      status: "failed"
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/csv-imports/batches/${batch.json().batch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    const item = status.json().items[0] as { id: string };
    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE csv_import_items
        SET status = 'running',
            error_code = NULL,
            error_message = NULL,
            updated_at = ?
        WHERE id = ?
      `
    ).run(now, item.id);
    db.prepare(
      `
        UPDATE csv_import_batches
        SET status = 'running',
            failed_items = 0,
            completed_items = 0,
            completed_at = NULL
        WHERE id = ?
      `
    ).run(batch.json().batch.id);

    allowMatch = true;

    const retried = await app.inject({
      method: "POST",
      url: `/api/csv-imports/batches/${batch.json().batch.id}/retry`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      batch: {
        completedItems: 1,
        failedItems: 0,
        status: "completed"
      },
      retriedItems: 1
    });
    expect(retried.json().items[0]).toMatchObject({
      errorCode: null,
      status: "completed",
      youtubeSourceId: "youtubeMoonInterrupted01"
    });
  });

  it("automatically retries transient YouTube search failures during CSV import", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi
        .fn()
        .mockRejectedValueOnce(
          new YouTubeDiscoveryError(
            "youtube_search_unavailable",
            "YouTube search is temporarily unavailable.",
            502,
            true
          )
        )
        .mockImplementation(async (_query, importPolicyMode) => ({
          nextPageToken: null,
          results: [
            youtubeResult({
              creator: "Ada Channel",
              durationMs: 180000,
              importPolicyMode,
              sourceId: "youtubeMoonAutoRetry01",
              title: "Moon Song Official Audio"
            })
          ]
        }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 1,
      failedItems: 0,
      status: "completed"
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/csv-imports/batches/${batch.json().batch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(status.json().items[0]).toMatchObject({
      status: "completed",
      youtubeSourceId: "youtubeMoonAutoRetry01"
    });
    expect(youtubeProvider.search).toHaveBeenCalledTimes(2);
  });

  it("keeps importing after low-confidence rows by limiting CSV auto-match search fallbacks", async () => {
    let searchCount = 0;
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (query, importPolicyMode) => {
        searchCount += 1;

        if (searchCount > 5) {
          throw new YouTubeDiscoveryError(
            "youtube_search_unavailable",
            "YouTube search is temporarily unavailable.",
            502,
            true
          );
        }

        const lowerQuery = query.toLowerCase();
        const isRiver = lowerQuery.includes("river song");

        return {
          nextPageToken: null,
          results: [
            isRiver
              ? youtubeResult({
                  creator: "Lin Channel",
                  durationMs: 220000,
                  importPolicyMode,
                  sourceId: "youtubeRiver01",
                  title: "River Song Official Audio"
                })
              : youtubeResult({
                  creator: "Talk Channel",
                  durationMs: 3600000,
                  importPolicyMode,
                  sourceId: `weakResult${searchCount}`,
                  title: "Completely Different Podcast Episode"
                })
          ]
        };
      })
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:road", "Road Song", "spotify:artist:grace", "Grace", "spotify:album:drive", "Drive", "spotify:artist:grace", "Grace", "2026-01-01", "https://i.scdn.co/image/road", "1", "2", "210000", "", "false", "40", "USROAD000001", "", "2026-01-03T00:00:00Z"],
        ["spotify:track:river", "River Song", "spotify:artist:lin", "Lin", "spotify:album:water", "Water", "spotify:artist:lin", "Lin", "2026-01-01", "https://i.scdn.co/image/river", "1", "3", "220000", "", "false", "30", "USRIVER00001", "", "2026-01-04T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 1,
      failedItems: 2,
      status: "failed",
      totalItems: 3
    });
    expect(youtubeProvider.search).toHaveBeenCalledTimes(5);
    expect(youtubeImportAdapter.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: expect.objectContaining({
          sourceId: "youtubeRiver01"
        })
      })
    );
  });

  it("pauses after repeated recoverable YouTube search failures and leaves untried CSV rows pending", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async () => {
        throw new YouTubeDiscoveryError(
          "youtube_search_unavailable",
          "YouTube search is temporarily unavailable.",
          502,
          true
        );
      })
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      recoverableFailurePauseThreshold: 3,
      recoverableSearchAttempts: 1,
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:road", "Road Song", "spotify:artist:grace", "Grace", "spotify:album:drive", "Drive", "spotify:artist:grace", "Grace", "2026-01-01", "https://i.scdn.co/image/road", "1", "2", "210000", "", "false", "40", "USROAD000001", "", "2026-01-03T00:00:00Z"],
        ["spotify:track:river", "River Song", "spotify:artist:lin", "Lin", "spotify:album:water", "Water", "spotify:artist:lin", "Lin", "2026-01-01", "https://i.scdn.co/image/river", "1", "3", "220000", "", "false", "30", "USRIVER00001", "", "2026-01-04T00:00:00Z"],
        ["spotify:track:sky", "Sky Song", "spotify:artist:kay", "Kay", "spotify:album:clouds", "Clouds", "spotify:artist:kay", "Kay", "2026-01-01", "https://i.scdn.co/image/sky", "1", "4", "230000", "", "false", "20", "USSKY0000001", "", "2026-01-05T00:00:00Z"],
        ["spotify:track:sun", "Sun Song", "spotify:artist:sol", "Sol", "spotify:album:light", "Light", "spotify:artist:sol", "Sol", "2026-01-01", "https://i.scdn.co/image/sun", "1", "5", "240000", "", "false", "10", "USSUN0000001", "", "2026-01-06T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json().batch).toMatchObject({
      completedItems: 0,
      failedItems: 3,
      status: "failed",
      totalItems: 5
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/csv-imports/batches/${batch.json().batch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    const items = status.json().items as Array<{ autoRetryable: boolean; errorCode: string | null; status: string }>;

    expect(items.filter((item) => item.status === "failed")).toHaveLength(3);
    expect(items.filter((item) => item.status === "pending")).toHaveLength(2);
    expect(items.filter((item) => item.autoRetryable)).toHaveLength(3);
    expect(items.filter((item) => item.errorCode === "youtube_search_unavailable")).toHaveLength(3);
    expect(youtubeImportAdapter.resolve).not.toHaveBeenCalled();
    expect(youtubeProvider.search).toHaveBeenCalledTimes(3);
  });

  it("imports a user-selected YouTube match for low-confidence CSV items", async () => {
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => ({
        nextPageToken: null,
        results: [
          youtubeResult({
            creator: "Talk Channel",
            durationMs: 3600000,
            importPolicyMode,
            sourceId: "wrongPodcast01",
            title: "Completely Different Podcast Episode"
          })
        ]
      }))
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("road_mix.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });
    const item = batch.json().items?.[0];
    const status = await app.inject({
      method: "GET",
      url: `/api/csv-imports/batches/${batch.json().batch.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    const failedItem = item ?? status.json().items[0];

    expect(failedItem).toMatchObject({
      errorCode: "youtube_match_low_confidence",
      status: "failed",
      userMatchRequired: true
    });

    const selected = youtubeResult({
      creator: "Ada Channel",
      durationMs: 180000,
      importPolicyMode: batch.json().batch.importPolicyMode,
      sourceId: "selectedMoon01",
      title: "Moon Song Official Audio"
    });
    const imported = await app.inject({
      method: "POST",
      url: `/api/csv-imports/batches/${batch.json().batch.id}/items/${failedItem.id}/import`,
      headers: { authorization: `Bearer ${token}` },
      payload: { discovery: selected }
    });

    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({
      batch: {
        completedItems: 1,
        failedItems: 0,
        status: "completed"
      },
      item: {
        status: "completed",
        youtubeSourceId: "selectedMoon01"
      }
    });

    const playlists = await app.inject({
      method: "GET",
      url: "/api/playlists",
      headers: { authorization: `Bearer ${token}` }
    });
    const roadMix = playlists.json().playlists.find(
      (playlist: { name: string }) => playlist.name === "Road Mix"
    );

    expect(roadMix).toMatchObject({ songCount: 1 });
  });

  it("cancels an in-progress CSV import batch and skips remaining pending items", async () => {
    const searchStarted = deferred();
    const releaseSearch = deferred();
    const youtubeProvider: YouTubeDiscoveryClient = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async (_query, importPolicyMode) => {
        searchStarted.resolve();
        await releaseSearch.promise;

        return {
          nextPageToken: null,
          results: [
            youtubeResult({
              creator: "Ada Channel",
              durationMs: 180000,
              importPolicyMode,
              sourceId: "youtubeMoon01",
              title: "Moon Song Official Audio"
            })
          ]
        };
      })
    };
    const youtubeImportAdapter = createYouTubeImportAdapter();
    const { app } = createTestApp({
      processImportsInline: false,
      youtubeImportAdapter,
      youtubeProvider
    });
    const token = await signIn(app);
    const files = [
      csvFile("liked.csv", [
        ["spotify:track:moon", "Moon Song", "spotify:artist:ada", "Ada", "spotify:album:lunar", "Lunar", "spotify:artist:ada", "Ada", "2026-01-01", "https://i.scdn.co/image/moon", "1", "1", "180000", "", "false", "50", "USMOON000001", "", "2026-01-02T00:00:00Z"],
        ["spotify:track:road", "Road Song", "spotify:artist:grace", "Grace", "spotify:album:drive", "Drive", "spotify:artist:grace", "Grace", "2026-01-01", "https://i.scdn.co/image/road", "1", "2", "210000", "", "false", "40", "USROAD000001", "", "2026-01-03T00:00:00Z"]
      ])
    ];

    const batch = await app.inject({
      method: "POST",
      url: "/api/csv-imports/batches",
      headers: { authorization: `Bearer ${token}` },
      payload: { files }
    });

    expect(batch.statusCode).toBe(202);
    await searchStarted.promise;

    const canceled = await app.inject({
      method: "POST",
      url: `/api/csv-imports/batches/${batch.json().batch.id}/cancel`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().batch).toMatchObject({
      failedItems: 2,
      status: "failed",
      totalItems: 2
    });
    expect(canceled.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorCode: "csv_import_canceled",
          status: "failed",
          title: "Moon Song"
        }),
        expect.objectContaining({
          errorCode: "csv_import_canceled",
          status: "failed",
          title: "Road Song"
        })
      ])
    );

    releaseSearch.resolve();
    await wait(25);

    expect(youtubeProvider.search).toHaveBeenCalledTimes(1);
  });

  function createTestApp(input: {
    audioProcessor?: AudioImportProcessor;
    csvImportConcurrency?: number;
    csvYouTubeSearchIntervalMs?: number;
    processImportsInline?: boolean;
    recoverableFailurePauseThreshold?: number;
    recoverableSearchAttempts?: number;
    libraryEvents?: LibraryEventSink;
    youtubeImportAdapter: YouTubeImportAdapter;
    youtubeProvider: YouTubeDiscoveryClient;
  }) {
    const dir = mkdtempSync(join(tmpdir(), "broadside-csv-import-"));
    const storageRoot = join(dir, "audio");
    const db = openBroadsideDatabase(join(dir, "broadside.sqlite"));
    const app = createApiApp({
      db,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      },
      csvImports: {
        csvImportConcurrency: input.csvImportConcurrency,
        csvYouTubeSearchIntervalMs: input.csvYouTubeSearchIntervalMs ?? 0,
        audioProcessor: input.audioProcessor,
        libraryEvents: input.libraryEvents,
        processImportsInline: input.processImportsInline ?? true,
        recoverableFailurePauseThreshold: input.recoverableFailurePauseThreshold,
        recoverableSearchAttempts: input.recoverableSearchAttempts,
        recoverableSearchRetryDelayMs: 0,
        storageRoot,
        youtubeImportAdapter: input.youtubeImportAdapter,
        youtubeProvider: input.youtubeProvider
      },
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      },
      songs: {
        storageRoot
      }
    });

    apps.add(app);
    databases.push(db);
    dirs.push(dir);

    return { app, db, storageRoot };
  }
});

function createYouTubeProvider(): YouTubeDiscoveryClient {
  return {
    search: vi.fn(async (query, importPolicyMode) => {
      const isMoon = query.toLowerCase().includes("moon");
      const sourceId = isMoon ? "youtubeMoon01" : "youtubeRoad01";

      return {
        nextPageToken: null,
        results: [
          youtubeResult({
            creator: isMoon ? "Ada Channel" : "Grace Channel",
            durationMs: isMoon ? 180000 : 210000,
            importPolicyMode,
            sourceId,
            title: isMoon ? "Moon Song Official Audio" : "Road Song Official Audio"
          })
        ]
      };
    }),
    normalizeUrl: vi.fn()
  };
}

function youtubeResult(input: {
  creator: string;
  durationMs: number;
  importPolicyMode: ImportPolicyMode;
  sourceId: string;
  title: string;
}): ExternalDiscoveryResult {
  return {
    canonicalUrl: `https://www.youtube.com/watch?v=${input.sourceId}`,
    creator: input.creator,
    description: null,
    durationMs: input.durationMs,
    importPolicyMode: input.importPolicyMode,
    provider: "youtube",
    sourceId: input.sourceId,
    thumbnailUrl: `https://i.ytimg.com/vi/${input.sourceId}/hqdefault.jpg`,
    title: input.title
  };
}

function createYouTubeImportAdapter(): YouTubeImportAdapter {
  return {
    resolve: vi.fn(async ({ discovery }) => ({
      adapter: "test_youtube_adapter",
      content: Buffer.concat([Buffer.from("ID3"), Buffer.from(discovery.sourceId)]),
      durationMs: discovery.durationMs,
      fileName: `${discovery.sourceId}.mp3`,
      mimeType: "audio/mpeg",
      provenance: {
        adapter: "test_youtube_adapter"
      }
    }))
  };
}

function csvFile(fileName: string, rows: string[][]) {
  const header = [
    "Track URI",
    "Track Name",
    "Artist URI(s)",
    "Artist Name(s)",
    "Album URI",
    "Album Name",
    "Album Artist URI(s)",
    "Album Artist Name(s)",
    "Album Release Date",
    "Album Image URL",
    "Disc Number",
    "Track Number",
    "Track Duration (ms)",
    "Track Preview URL",
    "Explicit",
    "Popularity",
    "ISRC",
    "Added By",
    "Added At"
  ];
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(","))
    .join("\n");

  return {
    contentBase64: Buffer.from(csv).toString("base64"),
    fileName
  };
}

function largeCsvContent(rowCount: number) {
  const header = [
    "Track URI",
    "Track Name",
    "Artist Name(s)",
    "Album Name",
    "Track Duration (ms)",
    "ISRC"
  ].join(",");
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const padded = String(index).padStart(5, "0");

    return [
      `spotify:track:bulk${padded}`,
      `Bulk Preview Song ${padded}`,
      `CSV Artist ${padded}`,
      `CSV Album ${padded}`,
      "180000",
      `USCSV${padded}`
    ].map((cell) => `"${cell}"`).join(",");
  });

  return [header, ...rows].join("\n");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createGoogleClient(): GoogleOAuthClient {
  return {
    exchangeCodeForTokens: vi.fn(async () => ({ idToken: "mock-google-id-token" })),
    verifyIdToken: vi.fn(async () => ({
      iss: "https://accounts.google.com",
      aud: authConfig.googleClientId,
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: "google-subject-ada",
      email: "ada@example.com",
      emailVerified: true,
      displayName: "Ada",
      avatarUrl: "https://example.com/avatar.png"
    }))
  };
}

async function signIn(app: ReturnType<typeof createApiApp>) {
  const start = await app.inject({
    method: "GET",
    url: "/api/auth/google/start?mode=mobile&returnTo=broadside%3A%2F%2Fauth%2Fcallback"
  });
  const state = new URL(String(start.headers.location)).searchParams.get("state");
  const callback = await app.inject({
    method: "GET",
    url: `/api/auth/google/callback?state=${state}&code=auth-code`
  });
  const exchangeCode = new URL(String(callback.headers.location)).searchParams.get(
    "session_exchange_code"
  );
  const session = await app.inject({
    method: "POST",
    url: "/api/auth/session/exchange",
    payload: { code: exchangeCode }
  });

  return String(session.json().accessToken);
}
