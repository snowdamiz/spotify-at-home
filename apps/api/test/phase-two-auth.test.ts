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

function createGoogleClient(overrides: Partial<GoogleOAuthClient> = {}): GoogleOAuthClient {
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
    })),
    ...overrides
  };
}

async function startGoogleAuth(
  app: ReturnType<typeof createApiApp>,
  query = "mode=mobile&returnTo=broadside%3A%2F%2Fauth%2Fcallback"
) {
  const response = await app.inject({
    method: "GET",
    url: `/api/auth/google/start?${query}`
  });
  const location = response.headers.location;

  if (typeof location !== "string") {
    throw new Error("Expected auth start to return a redirect location");
  }

  return {
    response,
    redirectUrl: new URL(location)
  };
}

function cookieValue(setCookie: string | string[] | undefined, name: string) {
  const cookieHeaders = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
  const cookie = cookieHeaders.find((header) => header.startsWith(`${name}=`));

  if (!cookie) {
    throw new Error(`Expected ${name} cookie`);
  }

  return cookie.split(";")[0].slice(name.length + 1);
}

async function signIn(app: ReturnType<typeof createApiApp>) {
  const { redirectUrl } = await startGoogleAuth(app);
  const callback = await app.inject({
    method: "GET",
    url: `/api/auth/google/callback?state=${redirectUrl.searchParams.get("state")}&code=auth-code`
  });
  const exchangeCode = new URL(String(callback.headers.location)).searchParams.get(
    "session_exchange_code"
  );
  const session = await app.inject({
    method: "POST",
    url: "/api/auth/session/exchange",
    payload: { code: exchangeCode }
  });

  return session.json() as {
    accessToken: string;
    refreshToken: string;
    user: {
      email: string;
      entryKeyRedeemedAt: string | null;
      hasEntryAccess: boolean;
      isAdmin: boolean;
    };
  };
}

describe("Phase 2 auth routes", () => {
  const apps = new Set<ReturnType<typeof createApiApp>>();
  const databases = new Set<SqliteDatabase>();
  const dirs = new Set<string>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();

    for (const db of databases) {
      closeBroadsideDatabase(db);
    }
    databases.clear();

    for (const dir of dirs) {
      rmSync(dir, { force: true, recursive: true });
    }
    dirs.clear();

    vi.restoreAllMocks();
  });

  it("redirects to Google with OAuth state and PKCE parameters", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);

    const { response, redirectUrl } = await startGoogleAuth(app);

    expect(response.statusCode).toBe(302);
    expect(redirectUrl.origin).toBe("https://accounts.google.com");
    expect(redirectUrl.pathname).toBe("/o/oauth2/v2/auth");
    expect(redirectUrl.searchParams.get("client_id")).toBe(authConfig.googleClientId);
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(authConfig.googleRedirectUri);
    expect(redirectUrl.searchParams.get("response_type")).toBe("code");
    expect(redirectUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(redirectUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(redirectUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(redirectUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("reports the active Google OAuth config without exposing the secret", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/config"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      configured: true,
      clientId: "google-client-id",
      redirectUri: authConfig.googleRedirectUri,
      allowedReturnToOrigins: authConfig.allowedReturnToOrigins
    });
    expect(JSON.stringify(response.json())).not.toContain(authConfig.googleClientSecret);
  });

  it("fails before redirecting to Google when OAuth env is not configured", async () => {
    const app = createApiApp({
      auth: {
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: ""
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/start?mode=web&returnTo=%2F"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "google_oauth_not_configured",
      message: "GOOGLE_CLIENT_ID must be set to the OAuth client ID from Google Cloud Console."
    });
  });

  it("rejects a callback with a missing or mismatched state", async () => {
    const googleOAuthClient = createGoogleClient();
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?state=unknown-state&code=auth-code"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_oauth_state",
      message: "OAuth state is missing, expired, or already used."
    });
    expect(googleOAuthClient.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("creates a local user from a valid Google callback and exchanges a mobile session code once", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);
    const { redirectUrl } = await startGoogleAuth(app);
    const state = redirectUrl.searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${state}&code=auth-code`
    });
    const callbackLocation = new URL(String(callback.headers.location));
    const exchangeCode = callbackLocation.searchParams.get("session_exchange_code");

    expect(callback.statusCode).toBe(302);
    expect(callbackLocation.origin).toBe("null");
    expect(callbackLocation.protocol).toBe("broadside:");
    expect(exchangeCode).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const exchange = await app.inject({
      method: "POST",
      url: "/api/auth/session/exchange",
      payload: { code: exchangeCode }
    });

    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        email: "ada@example.com",
        displayName: "Ada Lovelace",
        avatarUrl: "https://example.com/ada.png"
      }
    });

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        authorization: `Bearer ${exchange.json().accessToken}`
      }
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        email: "ada@example.com",
        displayName: "Ada Lovelace"
      }
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/session/exchange",
      payload: { code: exchangeCode }
    });

    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({
      error: "invalid_exchange_code",
      message: "Session exchange code is invalid or expired."
    });
  });

  it("sets secure HTTP-only web cookies after a valid web callback", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);
    const { redirectUrl } = await startGoogleAuth(app, "returnTo=https%3A%2F%2Fbroadside.test%2Flibrary");
    const state = redirectUrl.searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${state}&code=auth-code`
    });
    const accessToken = cookieValue(callback.headers["set-cookie"], "broadside_access");

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("https://broadside.test/library");
    expect(callback.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("broadside_access="),
        expect.stringContaining("HttpOnly"),
        expect.stringContaining("Secure"),
        expect.stringContaining("SameSite=Lax"),
        expect.stringContaining("broadside_refresh=")
      ])
    );

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: `broadside_access=${accessToken}`
      }
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        email: "ada@example.com"
      }
    });
  });

  it("keeps web sessions refreshable after the API restarts with the same database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "broadside-auth-"));
    const dbPath = join(dir, "broadside.sqlite");
    dirs.add(dir);

    const firstDb = openBroadsideDatabase(dbPath);
    databases.add(firstDb);
    const firstApp = createApiApp({
      db: firstDb,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(firstApp);

    const { redirectUrl } = await startGoogleAuth(
      firstApp,
      "mode=web&returnTo=https%3A%2F%2Fbroadside.test%2Flibrary"
    );
    const callback = await firstApp.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${redirectUrl.searchParams.get("state")}&code=auth-code`
    });
    const refreshToken = cookieValue(callback.headers["set-cookie"], "broadside_refresh");

    await firstApp.close();
    apps.delete(firstApp);
    closeBroadsideDatabase(firstDb);
    databases.delete(firstDb);

    const restartedDb = openBroadsideDatabase(dbPath);
    databases.add(restartedDb);
    const restartedApp = createApiApp({
      db: restartedDb,
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(restartedApp);

    const refresh = await restartedApp.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        cookie: `broadside_refresh=${refreshToken}`
      }
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        email: "ada@example.com"
      }
    });

    const accessToken = cookieValue(refresh.headers["set-cookie"], "broadside_access");
    const me = await restartedApp.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: `broadside_access=${accessToken}`
      }
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        email: "ada@example.com"
      }
    });
  });

  it("resolves relative and missing web return URLs to the configured app origin", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);

    const relativeStart = await startGoogleAuth(app, "mode=web&returnTo=%2Flibrary");
    const relativeCallback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${relativeStart.redirectUrl.searchParams.get("state")}&code=auth-code`
    });

    expect(relativeCallback.statusCode).toBe(302);
    expect(relativeCallback.headers.location).toBe("https://broadside.test/library");

    const fallbackStart = await startGoogleAuth(app, "mode=web");
    const fallbackCallback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${fallbackStart.redirectUrl.searchParams.get("state")}&code=auth-code`
    });

    expect(fallbackCallback.statusCode).toBe(302);
    expect(fallbackCallback.headers.location).toBe("https://broadside.test");
  });

  it("falls back instead of redirecting to an unapproved web return URL", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);
    const { redirectUrl } = await startGoogleAuth(app, "returnTo=https%3A%2F%2Fevil.example%2Fsteal");
    const state = redirectUrl.searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${state}&code=auth-code`
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("https://broadside.test");
  });

  it("rotates refresh tokens and rejects token reuse", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);
    const { redirectUrl } = await startGoogleAuth(app);
    const state = redirectUrl.searchParams.get("state");
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${state}&code=auth-code`
    });
    const exchangeCode = new URL(String(callback.headers.location)).searchParams.get("session_exchange_code");
    const session = await app.inject({
      method: "POST",
      url: "/api/auth/session/exchange",
      payload: { code: exchangeCode }
    });
    const firstRefreshToken = session.json().refreshToken;

    const refresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: firstRefreshToken }
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String)
    });
    expect(refresh.json().refreshToken).not.toBe(firstRefreshToken);

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: firstRefreshToken }
    });

    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({
      error: "invalid_refresh_token",
      message: "Refresh token is invalid, expired, revoked, or reused."
    });
  });

  it("requires a valid session for /api/me and revokes the active session on logout", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/me"
    });

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({
      error: "unauthorized",
      message: "A valid session is required."
    });

    const { redirectUrl } = await startGoogleAuth(app);
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${redirectUrl.searchParams.get("state")}&code=auth-code`
    });
    const exchangeCode = new URL(String(callback.headers.location)).searchParams.get("session_exchange_code");
    const session = await app.inject({
      method: "POST",
      url: "/api/auth/session/exchange",
      payload: { code: exchangeCode }
    });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${session.json().accessToken}`
      }
    });

    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        authorization: `Bearer ${session.json().accessToken}`
      }
    });

    expect(afterLogout.statusCode).toBe(401);

    const refreshAfterLogout = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: session.json().refreshToken }
    });

    expect(refreshAfterLogout.statusCode).toBe(401);
  });

  it("requires a one-time entry key before a non-admin account can use protected app routes", async () => {
    let identity: Pick<GoogleIdentity, "sub" | "email" | "displayName"> = {
      sub: "google-admin-subject",
      email: "admin@example.com",
      displayName: "Admin"
    };
    const googleOAuthClient = createGoogleClient({
      verifyIdToken: vi.fn(async () => ({
        iss: "https://accounts.google.com",
        aud: authConfig.googleClientId,
        exp: Math.floor(Date.now() / 1000) + 300,
        sub: identity.sub,
        email: identity.email,
        emailVerified: true,
        displayName: identity.displayName,
        avatarUrl: null
      }))
    });
    const app = createApiApp({
      auth: {
        ...authConfig,
        adminEmails: ["admin@example.com"],
        googleOAuthClient
      }
    });
    apps.add(app);

    const adminSession = await signIn(app);

    expect(adminSession.user).toMatchObject({
      email: "admin@example.com",
      hasEntryAccess: true,
      isAdmin: true
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/entry-keys",
      headers: {
        authorization: `Bearer ${adminSession.accessToken}`
      },
      payload: {
        label: "grace@example.com"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      entryKey: {
        label: "grace@example.com",
        consumedAt: null,
        consumedByUserEmail: null
      },
      secret: expect.stringMatching(/^[A-Z0-9]{5}$/)
    });
    expect(JSON.stringify(created.json().entryKey)).not.toContain("keyHash");

    identity = {
      sub: "google-grace-subject",
      email: "grace@example.com",
      displayName: "Grace Hopper"
    };
    const userSession = await signIn(app);

    expect(userSession.user).toMatchObject({
      email: "grace@example.com",
      entryKeyRedeemedAt: null,
      hasEntryAccess: false,
      isAdmin: false
    });

    const beforeRedeem = await app.inject({
      method: "GET",
      url: "/api/library/summary",
      headers: {
        authorization: `Bearer ${userSession.accessToken}`
      }
    });

    expect(beforeRedeem.statusCode).toBe(403);
    expect(beforeRedeem.json()).toMatchObject({
      error: {
        code: "entry_key_required"
      }
    });

    const redeemed = await app.inject({
      method: "POST",
      url: "/api/entry-keys/redeem",
      headers: {
        authorization: `Bearer ${userSession.accessToken}`
      },
      payload: {
        key: created.json().secret
      }
    });

    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({
      user: {
        email: "grace@example.com",
        entryKeyRedeemedAt: expect.any(String),
        hasEntryAccess: true,
        isAdmin: false
      }
    });

    const afterRedeem = await app.inject({
      method: "GET",
      url: "/api/library/summary",
      headers: {
        authorization: `Bearer ${userSession.accessToken}`
      }
    });

    expect(afterRedeem.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/entry-keys",
      headers: {
        authorization: `Bearer ${adminSession.accessToken}`
      }
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      entryKeys: [
        {
          label: "grace@example.com",
          consumedByUserEmail: "grace@example.com",
          consumedAt: expect.any(String)
        }
      ]
    });

    identity = {
      sub: "google-linus-subject",
      email: "linus@example.com",
      displayName: "Linus"
    };
    const secondUserSession = await signIn(app);
    const replay = await app.inject({
      method: "POST",
      url: "/api/entry-keys/redeem",
      headers: {
        authorization: `Bearer ${secondUserSession.accessToken}`
      },
      payload: {
        key: created.json().secret
      }
    });

    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({
      error: "invalid_entry_key",
      message: "Entry key is invalid or has already been used."
    });
  });

  it("blocks non-admin accounts from managing entry keys", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        adminEmails: ["admin@example.com"],
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);
    const session = await signIn(app);

    const create = await app.inject({
      method: "POST",
      url: "/api/admin/entry-keys",
      headers: {
        authorization: `Bearer ${session.accessToken}`
      },
      payload: {
        label: "blocked"
      }
    });

    expect(create.statusCode).toBe(403);
    expect(create.json()).toEqual({
      error: "admin_required",
      message: "Admin access is required."
    });
  });
});
