import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import { closeBroadsideDatabase, openBroadsideDatabase, type SqliteDatabase } from "../src/db";
import type { AudioImportProcessor } from "../src/songs/audio-processing";
import type { AudioStorage } from "../src/songs/storage";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.broadside.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://broadside.test"],
  adminEmails: ["ada@example.com", "grace@example.com"]
};

const tinyMp3 = Buffer.from("ID3 broadside test audio");

function createGoogleClient(identity: Partial<{
  avatarUrl: string | null;
  displayName: string;
  email: string;
  sub: string;
}> = {}): GoogleOAuthClient {
  return {
    exchangeCodeForTokens: vi.fn(async () => ({ idToken: "mock-google-id-token" })),
    verifyIdToken: vi.fn(async () => ({
      iss: "https://accounts.google.com",
      aud: authConfig.googleClientId,
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: identity.sub ?? "google-subject-1",
      email: identity.email ?? "ada@example.com",
      emailVerified: true,
      displayName: identity.displayName ?? "Ada Lovelace",
      avatarUrl: identity.avatarUrl ?? "https://example.com/ada.png"
    }))
  };
}

describe("Phase 4 audio imports and private storage", () => {
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

  it("rejects unauthenticated import requests", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      payload: mp3Payload()
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "unauthorized"
      }
    });
  });

  it("rejects unsupported MIME types before storing the file", async () => {
    const { app, storageRoot } = createTestApp();
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({
        fileName: "notes.txt",
        mimeType: "text/plain"
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "unsupported_audio_type"
      }
    });
    expect(existsSync(storageRoot)).toBe(false);
  });

  it("rejects files larger than the configured max before writing content", async () => {
    const { app, storageRoot } = createTestApp({ maxFileSizeBytes: 10 });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({
        sizeBytes: tinyMp3.byteLength
      })
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: {
        code: "audio_file_too_large"
      }
    });
    expect(existsSync(storageRoot)).toBe(false);
  });

  it("creates a ready song and stores the file under the authenticated user's private directory", async () => {
    const { app, storageRoot } = createTestApp();
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({
        title: "Analytical Engine Overture"
      })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      song: {
        title: "Analytical Engine Overture",
        mimeType: "audio/mpeg",
        sizeBytes: tinyMp3.byteLength,
        importStatus: "ready"
      }
    });

    const song = response.json().song;
    expect(relative(storageRoot, song.storagePath)).toBe(`${song.userId}/${song.id}/original`);
    expect(readFileSync(song.storagePath)).toEqual(tinyMp3);

    const library = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(library.statusCode).toBe(200);
    expect(library.json()).toMatchObject({
      songs: [
        {
          id: song.id,
          title: "Analytical Engine Overture",
          importStatus: "ready"
        }
      ]
    });
  });

  it("normalizes audio before writing imports to private storage", async () => {
    const normalizedAudio = Buffer.from("ID3 normalized broadside test audio");
    const audioProcessor: AudioImportProcessor = {
      process: vi.fn(async (input) => ({
        content: normalizedAudio,
        durationMs: input.durationMs ?? 1234,
        fileName: "overture.normalized.mp3",
        mimeType: "audio/mpeg",
        provenance: {
          audioNormalization: {
            applied: true
          }
        }
      }))
    };
    const { app } = createTestApp({ audioProcessor });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({
        title: "Normalized Overture"
      })
    });

    expect(response.statusCode).toBe(201);
    expect(audioProcessor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        content: tinyMp3,
        fileName: "overture.mp3",
        mimeType: "audio/mpeg"
      })
    );
    expect(response.json()).toMatchObject({
      song: {
        checksum: `sha256:${createHash("sha256").update(normalizedAudio).digest("hex")}`,
        durationMs: 1234,
        mimeType: "audio/mpeg",
        sizeBytes: normalizedAudio.byteLength,
        title: "Normalized Overture"
      }
    });
    expect(readFileSync(response.json().song.storagePath)).toEqual(normalizedAudio);
  });

  it("accepts raw audio uploads without base64 encoding", async () => {
    const { app, storageRoot } = createTestApp();
    const token = await signIn(app);
    const params = new URLSearchParams({
      fileName: "binary-overture.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: String(tinyMp3.byteLength),
      title: "Binary Overture"
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/songs/import?${params}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "audio/mpeg"
      },
      payload: tinyMp3
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      song: {
        title: "Binary Overture",
        mimeType: "audio/mpeg",
        sizeBytes: tinyMp3.byteLength,
        importStatus: "ready"
      }
    });

    const song = response.json().song;
    expect(relative(storageRoot, song.storagePath)).toBe(`${song.userId}/${song.id}/original`);
    expect(readFileSync(song.storagePath)).toEqual(tinyMp3);
  });

  it("marks failed imports as failed and does not expose them as ready songs", async () => {
    const failingStorage: AudioStorage = {
      async writeOriginal() {
        throw new Error("disk refused write");
      },
      async deleteOriginal() {}
    };
    const { app } = createTestApp({ audioStorage: failingStorage });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        code: "audio_storage_write_failed"
      }
    });

    const library = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(library.statusCode).toBe(200);
    expect(library.json()).toEqual({ songs: [] });
  });

  it("removes a song from the user library while keeping cached audio", async () => {
    const { app } = createTestApp();
    const token = await signIn(app);
    const imported = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload()
    });
    const song = imported.json().song;

    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/songs/${song.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(deletion.statusCode).toBe(204);
    expect(existsSync(song.storagePath)).toBe(true);

    const deletedSong = await app.inject({
      method: "GET",
      url: `/api/songs/${song.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(deletedSong.statusCode).toBe(404);

    const library = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(library.statusCode).toBe(200);
    expect(library.json()).toEqual({ songs: [] });
  });

  it("blocks non-admin accounts from wiping account tracks", async () => {
    const { app } = createTestApp({
      googleIdentity: {
        displayName: "Linus",
        email: "linus@example.com",
        sub: "google-linus-subject"
      }
    });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/account/tracks/wipe",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        deleteStoredAudio: false
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "admin_required"
      }
    });
  });

  it("lets admins wipe all account tracks while leaving stored audio in place", async () => {
    const { app } = createTestApp();
    const token = await signIn(app);
    const first = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ title: "First wipe target" })
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ title: "Second wipe target" })
    });
    const firstPath = String(first.json().song.storagePath);
    const secondPath = String(second.json().song.storagePath);

    const response = await app.inject({
      method: "POST",
      url: "/api/account/tracks/wipe",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        deleteStoredAudio: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deletion: {
        deletedTracks: 2,
        deletedStoredObjects: 0,
        failedStoredObjects: 0,
        retainedStoredObjects: 0,
        storageCandidates: 0,
        storageDeleteRequested: false
      }
    });
    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(secondPath)).toBe(true);

    const library = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(library.statusCode).toBe(200);
    expect(library.json()).toEqual({ songs: [] });
  });

  it("lets admins wipe all account tracks and delete unreferenced stored audio", async () => {
    const { app } = createTestApp();
    const token = await signIn(app);
    const imported = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ title: "Stored wipe target" })
    });
    const storagePath = String(imported.json().song.storagePath);

    expect(existsSync(storagePath)).toBe(true);

    const response = await app.inject({
      method: "POST",
      url: "/api/account/tracks/wipe",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        deleteStoredAudio: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deletion: {
        deletedTracks: 1,
        deletedStoredObjects: 1,
        failedStoredObjects: 0,
        retainedStoredObjects: 0,
        storageCandidates: 1,
        storageDeleteRequested: true
      }
    });
    expect(existsSync(storagePath)).toBe(false);
  });

  it("cleans already orphaned local storage references during an admin storage wipe", async () => {
    const { app } = createTestApp();
    const token = await signIn(app);
    const imported = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ title: "Already orphaned target" })
    });
    const song = imported.json().song;

    const removedFromLibrary = await app.inject({
      method: "DELETE",
      url: `/api/songs/${song.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(removedFromLibrary.statusCode).toBe(204);
    expect(existsSync(song.storagePath)).toBe(true);

    const storageBefore = await app.inject({
      method: "GET",
      url: "/api/admin/storage-objects",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(storageBefore.statusCode).toBe(200);
    expect(storageBefore.json()).toMatchObject({
      storage: {
        totalObjects: 1,
        objects: [
          {
            activeSongCount: 0,
            storagePath: song.storagePath
          }
        ]
      }
    });

    const wipe = await app.inject({
      method: "POST",
      url: "/api/account/tracks/wipe",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        deleteStoredAudio: true
      }
    });

    expect(wipe.statusCode).toBe(200);
    expect(wipe.json()).toMatchObject({
      deletion: {
        clearedStorageReferences: 1,
        deletedStoredObjects: 1,
        failedStoredObjects: 0,
        storageDeleteRequested: true
      }
    });
    expect(existsSync(song.storagePath)).toBe(false);

    const storageAfter = await app.inject({
      method: "GET",
      url: "/api/admin/storage-objects",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(storageAfter.statusCode).toBe(200);
    expect(storageAfter.json()).toMatchObject({
      storage: {
        totalObjects: 0,
        objects: []
      }
    });
  });

  function createTestApp(options: {
    audioProcessor?: AudioImportProcessor;
    audioStorage?: AudioStorage;
    googleIdentity?: Partial<{
      avatarUrl: string | null;
      displayName: string;
      email: string;
      sub: string;
    }>;
    maxFileSizeBytes?: number;
  } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "broadside-phase-four-"));
    const storageRoot = join(dir, "audio");
    const db = openBroadsideDatabase(join(dir, "broadside.sqlite"));
    const app = createApiApp({
      db,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient(options.googleIdentity)
      },
      songs: {
        audioProcessor: options.audioProcessor,
        audioStorage: options.audioStorage,
        storageRoot,
        maxFileSizeBytes: options.maxFileSizeBytes
      }
    });

    apps.add(app);
    databases.push(db);
    dirs.push(dir);

    return { app, storageRoot };
  }
});

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

function mp3Payload(overrides: Partial<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  title: string;
}> = {}) {
  return {
    fileName: overrides.fileName ?? "overture.mp3",
    mimeType: overrides.mimeType ?? "audio/mpeg",
    sizeBytes: overrides.sizeBytes ?? tinyMp3.byteLength,
    title: overrides.title ?? "Overture",
    contentBase64: tinyMp3.toString("base64")
  };
}
