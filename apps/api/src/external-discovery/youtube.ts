import type {
  ExternalDiscoveryResult,
  ImportPolicyMode
} from "@tunely/shared";

const youtubeOEmbedUrl = "https://www.youtube.com/oembed";
const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{6,64}$/;

export interface YouTubeDiscoveryProviderOptions {
  fetch?: typeof fetch;
  oEmbedUrl?: string;
}

export interface ParsedYouTubeUrl {
  videoId: string;
  canonicalUrl: string;
}

interface YouTubeOEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

export class YouTubeDiscoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly recoverable: boolean
  ) {
    super(message);
  }
}

export interface YouTubeDiscoveryClient {
  normalizeUrl(url: string, importPolicyMode: ImportPolicyMode): Promise<ExternalDiscoveryResult>;
}

export class YouTubeDiscoveryProvider implements YouTubeDiscoveryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly oEmbedUrl: string;

  constructor(options: YouTubeDiscoveryProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.oEmbedUrl = options.oEmbedUrl ?? youtubeOEmbedUrl;
  }

  async normalizeUrl(
    url: string,
    importPolicyMode: ImportPolicyMode
  ): Promise<ExternalDiscoveryResult> {
    const parsed = parseYouTubeVideoUrl(url);

    if (!parsed) {
      throw new YouTubeDiscoveryError(
        "invalid_youtube_url",
        "A valid YouTube video URL is required.",
        400,
        false
      );
    }

    const metadata = await this.fetchOEmbedMetadata(parsed.canonicalUrl);

    return {
      provider: "youtube",
      sourceId: parsed.videoId,
      canonicalUrl: parsed.canonicalUrl,
      title: metadata.title ?? `YouTube video ${parsed.videoId}`,
      creator: metadata.creator,
      thumbnailUrl: metadata.thumbnailUrl ?? defaultThumbnailUrl(parsed.videoId),
      durationMs: null,
      description: null,
      importPolicyMode
    };
  }

  private async fetchOEmbedMetadata(canonicalUrl: string) {
    const url = new URL(this.oEmbedUrl);

    url.searchParams.set("format", "json");
    url.searchParams.set("url", canonicalUrl);

    try {
      const response = await this.fetchImpl(url);

      if (!response.ok) {
        return emptyMetadata();
      }

      const body = (await response.json()) as YouTubeOEmbedResponse;

      return {
        title: normalizeText(body.title),
        creator: normalizeText(body.author_name),
        thumbnailUrl: normalizeText(body.thumbnail_url)
      };
    } catch {
      return emptyMetadata();
    }
  }
}

export function parseYouTubeVideoUrl(value: string): ParsedYouTubeUrl | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId: string | null = null;

  if (hostname === "youtu.be") {
    videoId = cleanPathSegment(url.pathname.slice(1).split("/")[0]);
  }

  if (hostname === "youtube.com" || hostname === "music.youtube.com" || hostname === "m.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
      videoId = cleanPathSegment(url.pathname.split("/")[2]);
    }
  }

  if (!isYouTubeVideoId(videoId)) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: canonicalWatchUrl(videoId)
  };
}

function emptyMetadata() {
  return {
    title: null,
    creator: null,
    thumbnailUrl: null
  };
}

function normalizeText(value: string | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function isYouTubeVideoId(value: string | null | undefined): value is string {
  return typeof value === "string" && youtubeVideoIdPattern.test(value);
}

function cleanPathSegment(value: string | undefined) {
  return value ? decodeURIComponent(value).trim() : null;
}

function canonicalWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function defaultThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}
