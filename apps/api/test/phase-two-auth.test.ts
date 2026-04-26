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
  query = "mode=mobile&returnTo=tunely%3A%2F%2Fauth%2Fcallback"
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

describe("Phase 2 auth routes", () => {
  const apps = new Set<ReturnType<typeof createApiApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
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
    expect(callbackLocation.protocol).toBe("tunely:");
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
    const { redirectUrl } = await startGoogleAuth(app, "returnTo=https%3A%2F%2Ftunely.test%2Flibrary");
    const state = redirectUrl.searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${state}&code=auth-code`
    });
    const accessToken = cookieValue(callback.headers["set-cookie"], "tunely_access");

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("https://tunely.test/library");
    expect(callback.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("tunely_access="),
        expect.stringContaining("HttpOnly"),
        expect.stringContaining("Secure"),
        expect.stringContaining("SameSite=Lax"),
        expect.stringContaining("tunely_refresh=")
      ])
    );

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: `tunely_access=${accessToken}`
      }
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        email: "ada@example.com"
      }
    });
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
    expect(callback.headers.location).toBe("/");
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
});
