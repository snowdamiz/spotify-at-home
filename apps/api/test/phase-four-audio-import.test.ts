import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import { closeTunelyDatabase, openTunelyDatabase, type SqliteDatabase } from "../src/db";
import type { AudioStorage } from "../src/songs/storage";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.tunely.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://tunely.test"]
};

const tinyMp3 = Buffer.from("ID3 tunely test audio");

function createGoogleClient(): GoogleOAuthClient {
  return {
    exchangeCodeForTokens: vi.fn(async () => ({ idToken: "mock-google-id-token" })),
    verifyIdToken: vi.fn(async () => ({
      iss: "https://accounts.google.com",
      aud: authConfig.googleClientId,
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: "google-subject-1",
      email: "ada@example.com",
      emailVerified: true,
      displayName: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png"
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
      closeTunelyDatabase(databases.pop()!);
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

  it("deletes song metadata and removes the private file", async () => {
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
    expect(existsSync(song.storagePath)).toBe(false);

    const deletedSong = await app.inject({
      method: "GET",
      url: `/api/songs/${song.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(deletedSong.statusCode).toBe(404);
  });

  function createTestApp(options: {
    audioStorage?: AudioStorage;
    maxFileSizeBytes?: number;
  } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "tunely-phase-four-"));
    const storageRoot = join(dir, "audio");
    const db = openTunelyDatabase(join(dir, "tunely.sqlite"));
    const app = createApiApp({
      db,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      },
      songs: {
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
    url: "/api/auth/google/start?mode=mobile&returnTo=tunely%3A%2F%2Fauth%2Fcallback"
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
