import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import { closeBroadsideDatabase, openBroadsideDatabase, type SqliteDatabase } from "../src/db";
import type { YouTubeImportAdapter } from "../src/external-imports/youtubeAdapter";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.broadside.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://broadside.test"],
  adminEmails: ["ada@example.com", "grace@example.com"]
};

describe("YouTube Music external import flow", () => {
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

  it("imports an open-test YouTube candidate into the private song library", async () => {
    const { app, storageRoot } = createTestApp({
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      }
    });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      alreadyInLibrary: false,
      job: {
        importPolicyMode: "open_test",
        status: "ready"
      },
      song: {
        externalSource: {
          provider: "youtube",
          sourceId: "abc123XYZ09",
          thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg"
        },
        importStatus: "ready",
        mimeType: "audio/mpeg",
        title: expect.stringContaining("abc123XYZ09")
      }
    });
    expect(statSync(response.json().song.storagePath).size).toBeGreaterThan(44);
    expect(response.json().song.storagePath.startsWith(storageRoot)).toBe(true);

    const songs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(songs.json().songs).toHaveLength(1);
    expect(songs.json().songs[0]).toMatchObject({
      externalSource: {
        thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg"
      }
    });
  });

  it("reuses an existing YouTube audio artifact for another user", async () => {
    const resolvedAudio = Buffer.from("RIFF shared youtube audio");
    const adapter: YouTubeImportAdapter = {
      resolve: vi.fn(async ({ discovery }) => ({
        adapter: "test_youtube_adapter",
        content: resolvedAudio,
        durationMs: discovery.durationMs ?? 1200,
        fileName: `${discovery.sourceId}.wav`,
        mimeType: "audio/wav",
        provenance: {
          adapter: "test_youtube_adapter"
        }
      }))
    };
    const { app, signInAs } = createTestApp({
      externalImports: {
        youtubeImportAdapter: adapter
      },
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com", "grace@example.com"]
      }
    });
    const adaToken = await signInAs({
      email: "ada@example.com",
      sub: "google-subject-ada"
    });
    const graceToken = await signInAs({
      email: "grace@example.com",
      sub: "google-subject-grace"
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${adaToken}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${graceToken}` },
      payload: {
        url: "https://www.youtube.com/watch?v=abc123XYZ09"
      }
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    expect(second.json()).toMatchObject({
      alreadyInLibrary: false,
      job: {
        status: "ready"
      },
      song: {
        externalSource: {
          provenance: {
            selectedImportPath: "shared_artifact_reuse"
          },
          sourceId: "abc123XYZ09"
        },
        importStatus: "ready"
      }
    });
    expect(second.json().song.storagePath).toBe(first.json().song.storagePath);

    const storagePath = first.json().song.storagePath;
    expect(statSync(storagePath).size).toBe(resolvedAudio.byteLength);

    const deleteFirst = await app.inject({
      method: "DELETE",
      url: `/api/songs/${first.json().song.id}`,
      headers: { authorization: `Bearer ${adaToken}` }
    });

    expect(deleteFirst.statusCode).toBe(204);
    expect(existsSync(storagePath)).toBe(true);

    const deleteSecond = await app.inject({
      method: "DELETE",
      url: `/api/songs/${second.json().song.id}`,
      headers: { authorization: `Bearer ${graceToken}` }
    });

    expect(deleteSecond.statusCode).toBe(204);
    expect(existsSync(storagePath)).toBe(true);

    const third = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${adaToken}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });

    expect(third.statusCode).toBe(201);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    expect(third.json()).toMatchObject({
      alreadyInLibrary: false,
      job: {
        status: "ready"
      },
      song: {
        externalSource: {
          provenance: {
            selectedImportPath: "shared_artifact_reuse"
          },
          sourceId: "abc123XYZ09"
        },
        importStatus: "ready"
      }
    });
    expect(third.json().song.storagePath).toBe(storagePath);
  });

  it("allows YouTube imports even when no allow policy matches", async () => {
    const { app } = createTestApp({
      importPolicy: {
        environment: "production",
        mode: "licensed_only"
      }
    });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://www.youtube.com/watch?v=abc123XYZ09"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      alreadyInLibrary: false,
      job: {
        importPolicyMode: "licensed_only",
        status: "ready"
      },
      song: {
        externalSource: {
          provider: "youtube",
          sourceId: "abc123XYZ09"
        },
        importStatus: "ready"
      }
    });
  });

  it("allows licensed-only imports when an admin source policy approves the source", async () => {
    const { app } = createTestApp({
      importPolicy: {
        adminUserEmails: ["ada@example.com"],
        environment: "production",
        mode: "licensed_only"
      }
    });
    const token = await signIn(app);

    const policy = await app.inject({
      method: "POST",
      url: "/api/admin/source-policies",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: "allow",
        attributionText: "Ada Channel - approved test source",
        licenseType: "approved_test_license",
        scopeType: "source",
        scopeValue: "abc123XYZ09"
      }
    });

    expect(policy.statusCode).toBe(201);

    const discovery = await app.inject({
      method: "POST",
      url: "/api/external-discovery/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://www.youtube.com/watch?v=abc123XYZ09"
      }
    });

    expect(discovery.json()).toMatchObject({
      discovery: {
        results: [
          {
            attributionText: "Ada Channel - approved test source",
            eligibility: {
              state: "importable"
            },
            licenseType: "approved_test_license"
          }
        ]
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        discovery: discovery.json().discovery.results[0]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      song: {
        externalSource: {
          importPolicyMode: "licensed_only",
          provenance: {
            attributionText: "Ada Channel - approved test source",
            licenseType: "approved_test_license"
          }
        },
        importStatus: "ready"
      }
    });
  });

  it("persists failed jobs for admin diagnostics", async () => {
    const failingAdapter: YouTubeImportAdapter = {
      async resolve() {
        throw new Error("provider unavailable");
      }
    };
    const { app } = createTestApp({
      externalImports: {
        youtubeImportAdapter: failingAdapter
      },
      importPolicy: {
        adminUserEmails: ["ada@example.com"],
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      }
    });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });

    expect(response.statusCode).toBe(500);

    const failed = await app.inject({
      method: "GET",
      url: "/api/admin/external-import-jobs/failed",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      jobs: [
        {
          errorCode: "external_import_failed",
          status: "failed"
        }
      ]
    });
  });

  function createTestApp(options: Parameters<typeof createApiApp>[0] = {}) {
    const dir = mkdtempSync(join(tmpdir(), "broadside-youtube-import-"));
    const storageRoot = join(dir, "audio");
    const db = openBroadsideDatabase(join(dir, "broadside.sqlite"));
    let nextIdentity = {
      sub: "google-subject-ada",
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
      },
      ...options,
      externalImports: {
        youtubeImportAdapter: createFixtureYouTubeImportAdapter(),
        storageRoot,
        ...options.externalImports
      }
    });

    apps.add(app);
    databases.push(db);
    dirs.push(dir);

    return {
      app,
      storageRoot,
      async signInAs(identity: { email: string; sub: string }) {
        nextIdentity = identity;
        return signIn(app);
      }
    };
  }
});

function createFixtureYouTubeImportAdapter(): YouTubeImportAdapter {
  return {
    resolve: vi.fn(async ({ discovery }) => ({
      adapter: "test_youtube_adapter",
      content: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(128, 1)]),
      durationMs: discovery.durationMs ?? 180000,
      fileName: `${discovery.sourceId}.mp3`,
      mimeType: "audio/mpeg",
      provenance: {
        adapter: "test_youtube_adapter"
      }
    }))
  };
}

function createGoogleClient(
  currentIdentity: () => { email: string; sub: string } = () => ({
    email: "ada@example.com",
    sub: "google-subject-ada"
  })
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
        avatarUrl: "https://example.com/avatar.png"
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
