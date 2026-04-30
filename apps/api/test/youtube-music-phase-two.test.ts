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
  googleRedirectUri: "https://api.broadside.test/api/auth/google/callback",
  cookieSecure: true,
  allowedReturnToOrigins: ["https://broadside.test"],
  adminEmails: ["ada@example.com", "grace@example.com"]
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
    expect(parseYouTubeVideoUrl("youtu.be/abc123XYZ09")).toEqual({
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
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hq720.jpg",
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
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hq720.jpg",
      durationMs: null,
      description: null,
      importPolicyMode: "review_required"
    });
  });

  it("searches YouTube keyword results from the public results page without an API key", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.origin).toBe("https://www.youtube.com");
      expect(url.pathname).toBe("/results");
      expect(url.searchParams.get("search_query")).toBe("lofi beats");
      expect(url.searchParams.has("key")).toBe(false);
      expect(url.searchParams.has("part")).toBe(false);

      return textResponse(
        youtubeSearchHtml([
          {
            channel: "Study Channel",
            description: "A soft mix for focus.",
            duration: "3:45",
            id: "abc123XYZ09",
            title: "Lofi Study Beat"
          },
          {
            channel: "Ada Channel",
            description: "Warm keys and drums.",
            duration: "1:02:03",
            id: "def456UVW12",
            title: "Coding Beats Live"
          }
        ])
      );
    });
    const provider = new YouTubeDiscoveryProvider({
      fetch: fetchMock
    });

    const result = await provider.search("  lofi   beats  ", "open_test", {
      limit: 2
    });

    expect(result).toEqual({
      nextPageToken: null,
      results: [
        {
          provider: "youtube",
          sourceId: "abc123XYZ09",
          canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ09",
          title: "Lofi Study Beat",
          creator: "Study Channel",
          thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ09/hq720.jpg",
          durationMs: 225000,
          description: "A soft mix for focus.",
          importPolicyMode: "open_test"
        },
        {
          provider: "youtube",
          sourceId: "def456UVW12",
          canonicalUrl: "https://www.youtube.com/watch?v=def456UVW12",
          title: "Coding Beats Live",
          creator: "Ada Channel",
          thumbnailUrl: "https://i.ytimg.com/vi/def456UVW12/hq720.jpg",
          durationMs: 3723000,
          description: "Warm keys and drums.",
          importPolicyMode: "open_test"
        }
      ]
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

  it("returns YouTube search results when an authenticated tester posts a keyword query", async () => {
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
          },
          {
            provider: "youtube" as const,
            sourceId: "def456UVW12",
            canonicalUrl: "https://www.youtube.com/watch?v=def456UVW12",
            title: "Tiny Desk Encore",
            creator: "Grace Channel",
            thumbnailUrl: "https://i.ytimg.com/vi/def456UVW12/hqdefault.jpg",
            durationMs: 181000,
            description: null,
            importPolicyMode: "open_test" as const
          }
        ]
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
        limit: 5,
        query: "tiny desk"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(youtubeProvider.search).toHaveBeenCalledWith("tiny desk", "open_test", {
      limit: 5
    });
    expect(youtubeProvider.normalizeUrl).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      discovery: {
        importPolicy: {
          mode: "open_test"
        },
        nextPageToken: null,
        results: [
          {
            eligibility: {
              state: "importable"
            },
            provider: "youtube",
            sourceId: "abc123XYZ09",
            title: "Tiny Desk Song"
          },
          {
            eligibility: {
              state: "importable"
            },
            provider: "youtube",
            sourceId: "def456UVW12",
            title: "Tiny Desk Encore"
          }
        ]
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html"
    }
  });
}

function youtubeSearchHtml(
  videos: Array<{
    channel: string;
    description: string;
    duration: string;
    id: string;
    title: string;
  }>
) {
  return `<html><body><script>var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: videos.map((video) => ({
                    videoRenderer: {
                      descriptionSnippet: {
                        runs: [{ text: video.description }]
                      },
                      lengthText: {
                        simpleText: video.duration
                      },
                      ownerText: {
                        runs: [{ text: video.channel }]
                      },
                      shortBylineText: {
                        runs: [{ text: video.channel }]
                      },
                      thumbnail: {
                        thumbnails: [
                          {
                            height: 90,
                            url: `https://i.ytimg.com/vi/${video.id}/default.jpg`,
                            width: 120
                          },
                          {
                            height: 720,
                            url: `https://i.ytimg.com/vi/${video.id}/hq720.jpg`,
                            width: 1280
                          }
                        ]
                      },
                      title: {
                        runs: [{ text: video.title }]
                      },
                      videoId: video.id
                    }
                  }))
                }
              }
            ]
          }
        }
      }
    }
  })};</script></body></html>`;
}
