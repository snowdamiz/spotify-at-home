import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.tunely.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://tunely.test"]
};

const tinyMp3 = Buffer.from("ID3 open test policy");

function createGoogleClient(email = "ada@example.com"): GoogleOAuthClient {
  return {
    exchangeCodeForTokens: vi.fn(async () => ({ idToken: "mock-google-id-token" })),
    verifyIdToken: vi.fn(async () => ({
      iss: "https://accounts.google.com",
      aud: authConfig.googleClientId,
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: `google-subject-${email}`,
      email,
      emailVerified: true,
      displayName: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png"
    }))
  };
}

describe("YouTube Music Phase 0 import policy gate", () => {
  const apps = new Set<ReturnType<typeof createApiApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
    vi.restoreAllMocks();
  });

  it("rejects open_test imports for users outside the account allowlist", async () => {
    const app = createTestApp({
      allowedEmails: ["internal@example.com"],
      email: "ada@example.com",
      environment: "test"
    });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ importPolicyMode: "open_test" })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "open_test_import_not_allowed"
      }
    });
  });

  it("rejects open_test imports in production even for allowlisted users", async () => {
    const app = createTestApp({
      allowedEmails: ["ada@example.com"],
      email: "ada@example.com",
      environment: "production"
    });
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ importPolicyMode: "open_test" })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "open_test_import_not_allowed"
      }
    });
  });

  it("allows open_test imports and reports the active mode for allowlisted testers", async () => {
    const app = createTestApp({
      allowedEmails: ["ada@example.com"],
      email: "ada@example.com",
      environment: "test"
    });
    const token = await signIn(app);

    const policy = await app.inject({
      method: "GET",
      url: "/api/import-policy",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({
      importPolicy: {
        configuredMode: "open_test",
        copy: {
          badge: "Open test mode"
        },
        mode: "open_test",
        openTestAllowed: true
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/songs/import",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: mp3Payload({ importPolicyMode: "open_test" })
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      song: {
        importStatus: "ready",
        title: "Open Test Overture"
      }
    });
  });

  it("defaults policy reporting to licensed_only when no open_test config is present", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/import-policy"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      importPolicy: {
        configuredMode: "licensed_only",
        mode: "licensed_only",
        openTestAllowed: false
      }
    });
  });

  function createTestApp(options: {
    allowedEmails: string[];
    email: string;
    environment: string;
  }) {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient(options.email)
      },
      importPolicy: {
        environment: options.environment,
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: options.allowedEmails
      }
    });
    apps.add(app);

    return app;
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

function mp3Payload(overrides: { importPolicyMode?: string } = {}) {
  return {
    fileName: "open-test-overture.mp3",
    importPolicyMode: overrides.importPolicyMode,
    mimeType: "audio/mpeg",
    sizeBytes: tinyMp3.byteLength,
    title: "Open Test Overture",
    contentBase64: tinyMp3.toString("base64")
  };
}
