import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import { closeBroadsideDatabase, openBroadsideDatabase, type SqliteDatabase } from "../src/db";
import type { YouTubeImportAdapter } from "../src/external-imports/youtubeAdapter";
import type { AudioImportProcessor } from "../src/songs/audio-processing";

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

    const started = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      alreadyInLibrary: false,
      job: {
        importPolicyMode: "open_test",
        status: "pending"
      },
      song: {
        importStatus: "pending"
      }
    });

    const response = await waitForExternalImportJob(
      app,
      token,
      started.json().job.id,
      "ready"
    );
    expect(response).toMatchObject({
      job: {
        importPolicyMode: "open_test",
        status: "ready"
      },
      song: {
        externalSource: {
          provider: "youtube",
          sourceId: "abc123XYZ09",
          thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hq720.jpg"
        },
        importStatus: "ready",
        mimeType: "audio/mpeg",
        title: expect.stringContaining("abc123XYZ09")
      }
    });
    expect(statSync(response.song.storagePath).size).toBeGreaterThan(44);
    expect(response.song.storagePath.startsWith(storageRoot)).toBe(true);

    const songs = await app.inject({
      method: "GET",
      url: "/api/songs",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(songs.json().songs).toHaveLength(1);
    expect(songs.json().songs[0]).toMatchObject({
      externalSource: {
        thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hq720.jpg"
      }
    });
  });

  it("normalizes downloaded YouTube audio before storing the shared artifact", async () => {
    const resolvedAudio = Buffer.from("RIFF raw youtube audio");
    const normalizedAudio = Buffer.from("ID3 normalized youtube audio");
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
      externalImports: {
        audioProcessor,
        youtubeImportAdapter: adapter
      },
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      }
    });
    const token = await signIn(app);

    const started = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });

    expect(started.statusCode).toBe(202);
    const response = await waitForExternalImportJob(
      app,
      token,
      started.json().job.id,
      "ready"
    );
    expect(audioProcessor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        content: resolvedAudio,
        fileName: "abc123XYZ09.wav",
        mimeType: "audio/wav"
      })
    );
    expect(readFileSync(response.song.storagePath)).toEqual(normalizedAudio);
    expect(response).toMatchObject({
      song: {
        checksum: `sha256:${createHash("sha256").update(normalizedAudio).digest("hex")}`,
        externalSource: {
          provenance: {
            audioNormalization: {
              applied: true
            }
          }
        },
        mimeType: "audio/mpeg",
        sizeBytes: normalizedAudio.byteLength
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

    const firstStarted = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${adaToken}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });
    const first = await waitForExternalImportJob(
      app,
      adaToken,
      firstStarted.json().job.id,
      "ready"
    );
    const second = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${graceToken}` },
      payload: {
        url: "https://www.youtube.com/watch?v=abc123XYZ09"
      }
    });

    expect(firstStarted.statusCode).toBe(202);
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
    expect(second.json().song.storagePath).toBe(first.song.storagePath);

    const storagePath = first.song.storagePath;
    expect(statSync(storagePath).size).toBe(resolvedAudio.byteLength);

    const deleteFirst = await app.inject({
      method: "DELETE",
      url: `/api/songs/${first.song.id}`,
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

  it("marks discovery results that can link an existing shared storage object", async () => {
    const storedAudio = Buffer.from("ID3 shared object already in storage");
    const adapter: YouTubeImportAdapter = {
      resolve: vi.fn(async () => {
        throw new Error("should not download existing shared audio");
      })
    };
    const youtubeProvider = {
      normalizeUrl: vi.fn(),
      search: vi.fn(async () => ({
        nextPageToken: null,
        results: [
          {
            provider: "youtube" as const,
            sourceId: "abc123XYZ09",
            canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
            title: "Tiny Desk Song",
            creator: "Ada Channel",
            thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg",
            durationMs: 225000,
            description: "A live session",
            importPolicyMode: "open_test" as const
          }
        ]
      }))
    };
    const { app, storageRoot } = createTestApp({
      externalDiscovery: {
        youtubeProvider
      },
      externalImports: {
        youtubeImportAdapter: adapter
      },
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      }
    });
    const sharedDirectory = join(
      storageRoot,
      "external",
      "youtube",
      createHash("sha256").update("abc123XYZ09").digest("hex")
    );

    mkdirSync(sharedDirectory, { recursive: true });
    writeFileSync(join(sharedDirectory, "original"), storedAudio);

    const token = await signIn(app);
    const discovery = await app.inject({
      method: "POST",
      url: "/api/external-discovery/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        query: "tiny desk"
      }
    });

    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      discovery: {
        results: [
          {
            reusableAudio: {
              sizeBytes: storedAudio.byteLength,
              state: "stored_audio_available",
              storageLocation: "local"
            },
            sourceId: "abc123XYZ09"
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
    expect(adapter.resolve).not.toHaveBeenCalled();
    expect(readFileSync(response.json().song.storagePath)).toEqual(storedAudio);
    expect(response.json()).toMatchObject({
      alreadyInLibrary: false,
      job: {
        status: "ready"
      },
      song: {
        externalSource: {
          provenance: {
            selectedImportPath: "shared_object_reuse"
          },
          sourceId: "abc123XYZ09"
        },
        importStatus: "ready",
        sizeBytes: storedAudio.byteLength
      }
    });
  });

  it("allows YouTube imports even when no allow policy matches", async () => {
    const { app } = createTestApp({
      importPolicy: {
        environment: "production",
        mode: "licensed_only"
      }
    });
    const token = await signIn(app);

    const started = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://www.youtube.com/watch?v=abc123XYZ09"
      }
    });

    expect(started.statusCode).toBe(202);
    const response = await waitForExternalImportJob(
      app,
      token,
      started.json().job.id,
      "ready"
    );
    expect(response).toMatchObject({
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

    const started = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        discovery: discovery.json().discovery.results[0]
      }
    });

    expect(started.statusCode).toBe(202);
    const response = await waitForExternalImportJob(
      app,
      token,
      started.json().job.id,
      "ready"
    );
    expect(response).toMatchObject({
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

  it("returns the existing pending job when the same source is imported again", async () => {
    let finishDownload: (() => void) | null = null;
    const downloadReady = new Promise<void>((resolve) => {
      finishDownload = resolve;
    });
    const adapter: YouTubeImportAdapter = {
      resolve: vi.fn(async ({ discovery }) => {
        await downloadReady;

        return {
          adapter: "test_youtube_adapter",
          content: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(128, 1)]),
          durationMs: discovery.durationMs ?? 180000,
          fileName: `${discovery.sourceId}.mp3`,
          mimeType: "audio/mpeg",
          provenance: {
            adapter: "test_youtube_adapter"
          }
        };
      })
    };
    const { app } = createTestApp({
      externalImports: {
        youtubeImportAdapter: adapter
      },
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      }
    });
    const token = await signIn(app);

    const first = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://www.youtube.com/watch?v=abc123XYZ09"
      }
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().job.id).toBe(first.json().job.id);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);

    finishDownload?.();
    const completed = await waitForExternalImportJob(
      app,
      token,
      first.json().job.id,
      "ready"
    );

    expect(completed).toMatchObject({
      job: {
        status: "ready"
      },
      song: {
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

    const started = await app.inject({
      method: "POST",
      url: "/api/external-imports/youtube",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });

    expect(started.statusCode).toBe(202);
    await waitForExternalImportJob(app, token, started.json().job.id, "failed");

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

async function waitForExternalImportJob(
  app: ReturnType<typeof createApiApp>,
  token: string,
  jobId: string,
  expectedStatus: "failed" | "ready"
) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/external-import-jobs/${jobId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json();

    if (payload.job.status === expectedStatus) {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for external import job ${jobId} to finish.`);
}
