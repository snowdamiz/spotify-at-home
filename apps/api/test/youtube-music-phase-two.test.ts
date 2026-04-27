import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app";
import type { GoogleOAuthClient } from "../src/auth/google";
import {
  YouTubeDiscoveryProvider,
  parseYouTubeVideoUrl
} from "../src/external-discovery/youtube";

const authConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "https://api.tunely.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://tunely.test"]
};

describe("YouTube Music Phase 2 direct link discovery", () => {
  const apps = new Set<ReturnType<typeof createApiApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
    vi.restoreAllMocks();
  });

  it("parses common YouTube URL forms into a canonical watch URL", () => {
    expect(parseYouTubeVideoUrl("https://www.youtube.com/watch?v=abc123XYZ09&t=42s")).toEqual({
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
      videoId: "abc123XYZ09"
    });
    expect(parseYouTubeVideoUrl("https://youtu.be/abc123XYZ09?si=share-token")).toEqual({
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
      videoId: "abc123XYZ09"
    });
    expect(parseYouTubeVideoUrl("https://music.youtube.com/watch?v=abc123XYZ09")).toEqual({
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
      videoId: "abc123XYZ09"
    });
    expect(parseYouTubeVideoUrl("https://www.youtube.com/shorts/abc123XYZ09")).toEqual({
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
      videoId: "abc123XYZ09"
    });
  });

  it("normalizes a posted YouTube URL without any YouTube API key", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.origin).toBe("https://www.youtube.com");
      expect(url.pathname).toBe("/oembed");
      expect(url.searchParams.get("url")).toBe("https://www.youtube.com/watch?v=abc123XYZ09");
      expect(url.searchParams.has("key")).toBe(false);

      return jsonResponse({
        title: "Tiny Desk Song",
        author_name: "Ada Channel",
        thumbnail_url: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg"
      });
    });
    const provider = new YouTubeDiscoveryProvider({
      fetch: fetchMock
    });

    const result = await provider.normalizeUrl(
      "https://www.youtube.com/watch?v=abc123XYZ09&t=42s",
      "open_test"
    );

    expect(result).toEqual({
      provider: "youtube",
      sourceId: "abc123XYZ09",
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
      title: "Tiny Desk Song",
      creator: "Ada Channel",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg",
      durationMs: null,
      description: null,
      importPolicyMode: "open_test"
    });
  });

  it("still returns an importable result when no-key metadata lookup fails", async () => {
    const provider = new YouTubeDiscoveryProvider({
      fetch: vi.fn(async () => jsonResponse({ error: "not found" }, 404))
    });

    await expect(
      provider.normalizeUrl("https://youtu.be/abc123XYZ09", "review_required")
    ).resolves.toEqual({
      provider: "youtube",
      sourceId: "abc123XYZ09",
      canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
      title: "YouTube video abc123XYZ09",
      creator: null,
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg",
      durationMs: null,
      description: null,
      importPolicyMode: "review_required"
    });
  });

  it("returns a normalized discovery result when an authenticated tester posts a YouTube link", async () => {
    const youtubeProvider = {
      normalizeUrl: vi.fn(async () => ({
        provider: "youtube" as const,
        sourceId: "abc123XYZ09",
        canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
        title: "Tiny Desk Song",
        creator: "Ada Channel",
        thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg",
        durationMs: null,
        description: null,
        importPolicyMode: "open_test" as const
      }))
    };
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      },
      externalDiscovery: {
        youtubeProvider
      },
      importPolicy: {
        environment: "test",
        mode: "open_test",
        openTestAllowedEnvironments: ["test"],
        openTestAllowedUserEmails: ["ada@example.com"]
      }
    });
    apps.add(app);
    const token = await signIn(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/external-discovery/youtube",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        url: "https://youtu.be/abc123XYZ09"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(youtubeProvider.normalizeUrl).toHaveBeenCalledWith(
      "https://youtu.be/abc123XYZ09",
      "open_test"
    );
    expect(response.json()).toMatchObject({
      discovery: {
        importPolicy: {
          mode: "open_test"
        },
        nextPageToken: null,
        results: [
          {
            provider: "youtube",
            sourceId: "abc123XYZ09",
            title: "Tiny Desk Song",
            importPolicyMode: "open_test"
          }
        ]
      }
    });
  });

  it("rejects missing or invalid posted YouTube links cleanly", async () => {
    const app = createApiApp({
      auth: {
        ...authConfig,
        googleOAuthClient: createGoogleClient()
      }
    });
    apps.add(app);
    const token = await signIn(app);

    const missing = await app.inject({
      method: "POST",
      url: "/api/external-discovery/youtube",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {}
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/external-discovery/youtube",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        url: "https://example.com/not-youtube"
      }
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      error: {
        code: "youtube_url_required"
      }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: {
        code: "invalid_youtube_url"
      }
    });
  });
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
