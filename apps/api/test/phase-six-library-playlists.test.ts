import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleIdentity, GoogleOAuthClient } from "../src/auth/google";
import { closeBroadsideDatabase, openBroadsideDatabase, type SqliteDatabase } from "../src/db";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.broadside.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://broadside.test"],
  adminEmails: ["ada@example.com", "grace@example.com"]
};

describe("Phase 6 library, search, and playlist features", () => {
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

  it("returns empty-state library data for a new authenticated user", async () => {
    const { app, signIn } = createTestApp();
    const token = await signIn({ sub: "google-subject-1", email: "ada@example.com" });

    const summary = await app.inject({
      method: "GET",
      url: "/api/library/summary",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual({
      summary: {
        counts: {
          likedSongs: 0,
          playlists: 0,
          songs: 0
        },
        isEmpty: true,
        likedSongs: [],
        playlists: [],
        recentSongs: []
      }
    });
  });

  it("summarizes real imports and searches only owned songs and playlists", async () => {
    const { app, signIn } = createTestApp();
    const firstToken = await signIn({ sub: "google-subject-1", email: "ada@example.com" });
    const secondToken = await signIn({ sub: "google-subject-2", email: "grace@example.com" });
    const privateSong = await importSong(app, firstToken, {
      fileName: "private-moon.mp3",
      title: "Private Moon",
      artist: "Ada"
    });
    await importSong(app, secondToken, {
      fileName: "other-moon.mp3",
      title: "Other Moon",
      artist: "Grace"
    });

    const playlist = await app.inject({
      method: "POST",
      url: "/api/playlists",
      headers: {
        authorization: `Bearer ${firstToken}`
      },
      payload: {
        name: "Moon Mix",
        color: "#1ed760"
      }
    });
    expect(playlist.statusCode).toBe(201);

    const summary = await app.inject({
      method: "GET",
      url: "/api/library/summary",
      headers: {
        authorization: `Bearer ${firstToken}`
      }
    });
    expect(summary.json()).toMatchObject({
      summary: {
        counts: {
          playlists: 1,
          songs: 1
        },
        isEmpty: false,
        playlists: [
          {
            id: playlist.json().playlist.id,
            name: "Moon Mix"
          }
        ],
        recentSongs: [
          {
            id: privateSong.id,
            title: "Private Moon"
          }
        ]
      }
    });

    const search = await app.inject({
      method: "GET",
      url: "/api/search?query=moon",
      headers: {
        authorization: `Bearer ${firstToken}`
      }
    });

    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({
      results: {
        playlists: [
          {
            id: playlist.json().playlist.id,
            name: "Moon Mix"
          }
        ],
        songs: [
          {
            id: privateSong.id,
            title: "Private Moon"
          }
        ]
      }
    });
    expect(JSON.stringify(search.json())).not.toContain("Other Moon");
  });

  it("creates playlists, preserves order, reorders songs transactionally, and removes members", async () => {
    const { app, signIn } = createTestApp();
    const token = await signIn({ sub: "google-subject-1", email: "ada@example.com" });
    const first = await importSong(app, token, { fileName: "first.mp3", title: "First" });
    const second = await importSong(app, token, { fileName: "second.mp3", title: "Second" });
    const third = await importSong(app, token, { fileName: "third.mp3", title: "Third" });
    const created = await app.inject({
      method: "POST",
      url: "/api/playlists",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: "Road Mix"
      }
    });
    const playlistId = created.json().playlist.id;

    for (const song of [
      { id: third.id, position: 30 },
      { id: first.id, position: 10 },
      { id: second.id, position: 20 }
    ]) {
      const added = await app.inject({
        method: "POST",
        url: `/api/playlists/${playlistId}/songs`,
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: song
      });
      expect(added.statusCode).toBe(200);
    }

    const ordered = await getPlaylist(app, token, playlistId);
    expect(ordered.playlist.songs.map((song: { title: string }) => song.title)).toEqual([
      "First",
      "Second",
      "Third"
    ]);

    const reordered = await app.inject({
      method: "PUT",
      url: `/api/playlists/${playlistId}/order`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        songIds: [third.id, second.id, first.id]
      }
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().playlist.songs.map((song: { title: string }) => song.title)).toEqual([
      "Third",
      "Second",
      "First"
    ]);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/playlists/${playlistId}/songs/${second.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(removed.statusCode).toBe(204);

    const afterRemoval = await getPlaylist(app, token, playlistId);
    expect(afterRemoval.playlist.songs.map((song: { id: string }) => song.id)).toEqual([
      third.id,
      first.id
    ]);
  });

  it("treats liking and unliking a song as idempotent Liked Songs membership", async () => {
    const { app, signIn } = createTestApp();
    const token = await signIn({ sub: "google-subject-1", email: "ada@example.com" });
    const song = await importSong(app, token, { title: "Favorite Engine" });

    expect(song.liked).toBe(false);

    for (let index = 0; index < 2; index += 1) {
      const liked = await app.inject({
        method: "POST",
        url: `/api/songs/${song.id}/like`,
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      expect(liked.statusCode).toBe(200);
      expect(liked.json().song).toMatchObject({
        id: song.id,
        liked: true
      });
    }

    const likedSummary = await app.inject({
      method: "GET",
      url: "/api/library/summary",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(likedSummary.json()).toMatchObject({
      summary: {
        counts: {
          likedSongs: 1
        },
        likedSongs: [
          {
            id: song.id,
            liked: true,
            title: "Favorite Engine"
          }
        ]
      }
    });

    for (let index = 0; index < 2; index += 1) {
      const unliked = await app.inject({
        method: "DELETE",
        url: `/api/songs/${song.id}/like`,
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      expect(unliked.statusCode).toBe(204);
    }

    const unlikedSummary = await app.inject({
      method: "GET",
      url: "/api/library/summary",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(unlikedSummary.json().summary.counts.likedSongs).toBe(0);
    expect(unlikedSummary.json().summary.likedSongs).toEqual([]);

    const songs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(songs.json().songs).toMatchObject([
      {
        id: song.id,
        liked: false
      }
    ]);
  });

  function createTestApp() {
    const dir = mkdtempSync(join(tmpdir(), "broadside-phase-six-"));
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

async function importSong(
  app: ReturnType<typeof createApiApp>,
  token: string,
  overrides: Partial<{
    artist: string;
    fileName: string;
    title: string;
  }> = {}
) {
  const content = Buffer.from(`ID3 ${overrides.title ?? "Overture"}`);
  const response = await app.inject({
    method: "POST",
    url: "/api/songs/import",
    headers: {
      authorization: `Bearer ${token}`
    },
    payload: {
      artist: overrides.artist,
      fileName: overrides.fileName ?? "overture.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: content.byteLength,
      title: overrides.title ?? "Overture",
      contentBase64: content.toString("base64")
    }
  });

  expect(response.statusCode).toBe(201);

  return response.json().song as {
    id: string;
    liked: boolean;
    title: string;
  };
}

async function getPlaylist(app: ReturnType<typeof createApiApp>, token: string, playlistId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/playlists/${playlistId}`,
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  expect(response.statusCode).toBe(200);

  return response.json();
}
