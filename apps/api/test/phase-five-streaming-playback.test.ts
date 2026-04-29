import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleIdentity, GoogleOAuthClient } from "../src/auth/google";
import { closeBroadsideDatabase, openBroadsideDatabase, type SqliteDatabase } from "../src/db";
import { parseRangeHeader } from "../src/songs/range";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.broadside.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://broadside.test"],
  adminEmails: ["ada@example.com", "grace@example.com"]
};

const tinyMp3 = Buffer.from("ID3 broadside test audio");

describe("Phase 5 streaming playback and hybrid cache API", () => {
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

  it("requires auth for streaming and hides another user's song", async () => {
    const { app, signIn } = createTestApp();
    const firstToken = await signIn({
      sub: "google-subject-1",
      email: "ada@example.com"
    });
    const secondToken = await signIn({
      sub: "google-subject-2",
      email: "grace@example.com"
    });
    const imported = await importSong(app, firstToken);
    const songId = imported.song.id;

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/songs/${songId}/stream`
    });
    expect(anonymous.statusCode).toBe(401);

    const otherUser = await app.inject({
      method: "GET",
      url: `/api/songs/${songId}/stream`,
      headers: {
        authorization: `Bearer ${secondToken}`
      }
    });
    expect(otherUser.statusCode).toBe(404);
    expect(otherUser.json()).toMatchObject({
      error: {
        code: "song_not_found"
      }
    });
  });

  it("streams ready audio with content headers and byte-range support", async () => {
    const { app, signIn } = createTestApp();
    const token = await signIn({ sub: "google-subject-1", email: "ada@example.com" });
    const imported = await importSong(app, token);

    const full = await app.inject({
      method: "GET",
      url: `/api/songs/${imported.song.id}/stream`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toContain("audio/mpeg");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["content-length"]).toBe(String(tinyMp3.byteLength));
    expect(full.body).toBe(tinyMp3.toString());

    const ranged = await app.inject({
      method: "GET",
      url: `/api/songs/${imported.song.id}/stream`,
      headers: {
        authorization: `Bearer ${token}`,
        range: "bytes=4-9"
      }
    });

    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-type"]).toContain("audio/mpeg");
    expect(ranged.headers["accept-ranges"]).toBe("bytes");
    expect(ranged.headers["content-range"]).toBe(`bytes 4-9/${tinyMp3.byteLength}`);
    expect(ranged.headers["content-length"]).toBe("6");
    expect(ranged.body).toBe(tinyMp3.subarray(4, 10).toString());
  });

  it("returns 416 for invalid byte ranges", async () => {
    const { app, signIn } = createTestApp();
    const token = await signIn({ sub: "google-subject-1", email: "ada@example.com" });
    const imported = await importSong(app, token);

    const response = await app.inject({
      method: "GET",
      url: `/api/songs/${imported.song.id}/stream`,
      headers: {
        authorization: `Bearer ${token}`,
        range: `bytes=${tinyMp3.byteLength + 10}-${tinyMp3.byteLength + 20}`
      }
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe(`bytes */${tinyMp3.byteLength}`);
    expect(response.json()).toMatchObject({
      error: {
        code: "invalid_range"
      }
    });
  });

  it("parses closed, open-ended, and suffix byte ranges", () => {
    expect(parseRangeHeader("bytes=4-9", 20)).toEqual({ start: 4, end: 9 });
    expect(parseRangeHeader("bytes=15-", 20)).toEqual({ start: 15, end: 19 });
    expect(parseRangeHeader("bytes=-5", 20)).toEqual({ start: 15, end: 19 });
    expect(parseRangeHeader("items=0-1", 20)).toBeNull();
    expect(parseRangeHeader("bytes=30-40", 20)).toEqual("invalid");
  });

  it("persists playback state for the authenticated user only", async () => {
    const { app, signIn } = createTestApp();
    const firstToken = await signIn({
      sub: "google-subject-1",
      email: "ada@example.com"
    });
    const secondToken = await signIn({
      sub: "google-subject-2",
      email: "grace@example.com"
    });
    const imported = await importSong(app, firstToken);

    const initial = await app.inject({
      method: "GET",
      url: "/api/playback-state",
      headers: {
        authorization: `Bearer ${firstToken}`
      }
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      playbackState: {
        songId: null,
        positionMs: 0,
        shuffleEnabled: false,
        repeatMode: "off"
      }
    });

    const crossUserUpdate = await app.inject({
      method: "PUT",
      url: "/api/playback-state",
      headers: {
        authorization: `Bearer ${secondToken}`
      },
      payload: {
        songId: imported.song.id,
        positionMs: 1250,
        shuffleEnabled: true,
        repeatMode: "all"
      }
    });
    expect(crossUserUpdate.statusCode).toBe(404);

    const update = await app.inject({
      method: "PUT",
      url: "/api/playback-state",
      headers: {
        authorization: `Bearer ${firstToken}`
      },
      payload: {
        songId: imported.song.id,
        positionMs: 1250,
        shuffleEnabled: true,
        repeatMode: "all"
      }
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      playbackState: {
        songId: imported.song.id,
        positionMs: 1250,
        shuffleEnabled: true,
        repeatMode: "all"
      }
    });

    const persisted = await app.inject({
      method: "GET",
      url: "/api/playback-state",
      headers: {
        authorization: `Bearer ${firstToken}`
      }
    });
    expect(persisted.json()).toMatchObject(update.json());
  });

  it("accepts cache intent only for owned ready songs", async () => {
    const { app, signIn } = createTestApp();
    const firstToken = await signIn({
      sub: "google-subject-1",
      email: "ada@example.com"
    });
    const secondToken = await signIn({
      sub: "google-subject-2",
      email: "grace@example.com"
    });
    const imported = await importSong(app, firstToken);

    const otherUser = await app.inject({
      method: "POST",
      url: `/api/songs/${imported.song.id}/cache-intent`,
      headers: {
        authorization: `Bearer ${secondToken}`
      }
    });
    expect(otherUser.statusCode).toBe(404);

    const owned = await app.inject({
      method: "POST",
      url: `/api/songs/${imported.song.id}/cache-intent`,
      headers: {
        authorization: `Bearer ${firstToken}`
      }
    });
    expect(owned.statusCode).toBe(202);
    expect(owned.json()).toMatchObject({
      cacheIntent: {
        checksum: expect.stringMatching(/^sha256:/),
        mimeType: "audio/mpeg",
        sizeBytes: tinyMp3.byteLength,
        songId: imported.song.id,
        streamUrl: `/api/songs/${imported.song.id}/stream`
      }
    });
  });

  function createTestApp() {
    const dir = mkdtempSync(join(tmpdir(), "broadside-phase-five-"));
    const storageRoot = join(dir, "audio");
    const db = openBroadsideDatabase(join(dir, "broadside.sqlite"));
    let nextIdentity: Pick<GoogleIdentity, "sub" | "email"> = {
      sub: "google-subject-1",
      email: "ada@example.com"
    };
    const app = createApiApp({
      db,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient(() => nextIdentity)
      },
      songs: {
        storageRoot
      }
    });

    apps.add(app);
    databases.push(db);
    dirs.push(dir);

    return {
      app,
      async signIn(identity: Pick<GoogleIdentity, "sub" | "email">) {
        nextIdentity = identity;
        return signIn(app);
      }
    };
  }
});

function createGoogleClient(
  currentIdentity: () => Pick<GoogleIdentity, "sub" | "email">
): GoogleOAuthClient {
  return {
    exchangeCodeForTokens: vi.fn(async () => ({ idToken: "mock-google-id-token" })),
    verifyIdToken: vi.fn(async () => {
      const identity = currentIdentity();

      return {
        iss: "https://accounts.google.com",
        aud: authConfig.googleClientId,
        exp: Math.floor(Date.now() / 1000) + 300,
        sub: identity.sub,
        email: identity.email,
        emailVerified: true,
        displayName: identity.email.split("@")[0],
        avatarUrl: null
      };
    })
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

async function importSong(app: ReturnType<typeof createApiApp>, token: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/songs/import",
    headers: {
      authorization: `Bearer ${token}`
    },
    payload: {
      fileName: "overture.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: tinyMp3.byteLength,
      title: "Overture",
      contentBase64: tinyMp3.toString("base64")
    }
  });

  expect(response.statusCode).toBe(201);
  expect(existsSync(response.json().song.storagePath)).toBe(true);

  return response.json() as {
    song: {
      id: string;
      storagePath: string;
    };
  };
}
