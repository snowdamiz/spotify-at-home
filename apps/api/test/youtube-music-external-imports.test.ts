import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import { closeTunelyDatabase, openTunelyDatabase, type SqliteDatabase } from "../src/db";
import type { YouTubeImportAdapter } from "../src/external-imports/youtubeAdapter";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.tunely.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://tunely.test"]
};

describe("YouTube Music external import flow", () => {
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
          sourceId: "abc123XYZ09"
        },
        importStatus: "ready",
        mimeType: "audio/wav",
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
  });

  it("rejects a launch-mode import when no allow policy matches", async () => {
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

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "licensed_source_required"
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
    const dir = mkdtempSync(join(tmpdir(), "tunely-youtube-import-"));
    const storageRoot = join(dir, "audio");
    const db = openTunelyDatabase(join(dir, "tunely.sqlite"));
    const app = createApiApp({
      db,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      },
      songs: {
        storageRoot
      },
      ...options,
      externalImports: {
        storageRoot,
        ...options.externalImports
      }
    });

    apps.add(app);
    databases.push(db);
    dirs.push(dir);

    return { app, storageRoot };
  }
});

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
      displayName: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png"
    }))
  };
}

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
