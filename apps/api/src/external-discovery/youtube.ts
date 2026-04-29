import type {
  ExternalDiscoveryResult,
  ExternalDiscoveryResponse,
  ImportPolicyMode
} from "@broadside/shared";

const youtubeOEmbedUrl = "https://www.youtube.com/oembed";
const youtubeSearchUrl = "https://www.youtube.com/results";
const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{6,64}$/;
const defaultSearchLimit = 10;
const maxSearchLimit = 20;
const videoSearchParams = "EgIQAfABAQ==";

export interface YouTubeDiscoveryProviderOptions {
  fetch?: typeof fetch;
  oEmbedUrl?: string;
  searchUrl?: string;
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
    readonly recoverable: boolean,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export interface YouTubeDiscoveryClient {
  normalizeUrl(url: string, importPolicyMode: ImportPolicyMode): Promise<ExternalDiscoveryResult>;
  search?(
    query: string,
    importPolicyMode: ImportPolicyMode,
    options?: YouTubeSearchOptions
  ): Promise<ExternalDiscoveryResponse>;
}

export interface YouTubeSearchOptions {
  limit?: number;
}

export class YouTubeDiscoveryProvider implements YouTubeDiscoveryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly oEmbedUrl: string;
  private readonly searchUrl: string;

  constructor(options: YouTubeDiscoveryProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.oEmbedUrl = options.oEmbedUrl ?? youtubeOEmbedUrl;
    this.searchUrl = options.searchUrl ?? youtubeSearchUrl;
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

  async search(
    query: string,
    importPolicyMode: ImportPolicyMode,
    options: YouTubeSearchOptions = {}
  ): Promise<ExternalDiscoveryResponse> {
    const normalizedQuery = normalizeSearchQuery(query);

    if (!normalizedQuery) {
      throw new YouTubeDiscoveryError(
        "youtube_query_required",
        "A YouTube search query is required.",
        400,
        false
      );
    }

    const limit = normalizeSearchLimit(options.limit);
    const searchUrl = new URL(this.searchUrl);
    searchUrl.searchParams.set("search_query", normalizedQuery);
    searchUrl.searchParams.set("sp", videoSearchParams);
    searchUrl.searchParams.set("hl", "en");
    searchUrl.searchParams.set("gl", "US");

    try {
      const response = await this.fetchImpl(searchUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "user-agent":
            "Mozilla/5.0 (compatible; OnVibeDiscovery/1.0; +https://onvibe.local)"
        }
      });

      if (!response.ok) {
        throw new YouTubeDiscoveryError(
          "youtube_search_unavailable",
          `YouTube search is temporarily unavailable (HTTP ${response.status}).`,
          502,
          true,
          {
            upstreamStatus: response.status,
            upstreamStatusText: response.statusText,
            url: searchUrl.toString()
          }
        );
      }

      const html = await response.text();
      const initialData = extractYouTubeInitialData(html);

      if (!initialData) {
        throw new YouTubeDiscoveryError(
          "youtube_search_parse_failed",
          "YouTube search results could not be read.",
          502,
          true
        );
      }

      return {
        nextPageToken: null,
        results: extractYouTubeVideoResults(initialData, importPolicyMode, limit)
      };
    } catch (error) {
      if (error instanceof YouTubeDiscoveryError) {
        throw error;
      }

      throw new YouTubeDiscoveryError(
        "youtube_search_unavailable",
        `YouTube search is temporarily unavailable: ${messageForError(error)}.`,
        502,
        true,
        {
          cause: messageForError(error),
          url: searchUrl.toString()
        }
      );
    }
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
    try {
      url = new URL(`https://${value}`);
    } catch {
      return null;
    }
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

function messageForError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "unknown error";
}

export function extractYouTubeInitialData(html: string): unknown | null {
  const markers = [
    "var ytInitialData =",
    "window[\"ytInitialData\"] =",
    "window['ytInitialData'] =",
    "ytInitialData ="
  ];

  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);

    if (markerIndex === -1) {
      continue;
    }

    const objectStart = html.indexOf("{", markerIndex + marker.length);

    if (objectStart === -1) {
      continue;
    }

    const json = readBalancedJsonObject(html, objectStart);

    if (!json) {
      continue;
    }

    try {
      return JSON.parse(json);
    } catch {
      continue;
    }
  }

  return null;
}

export function extractYouTubeVideoResults(
  initialData: unknown,
  importPolicyMode: ImportPolicyMode,
  limit: number = defaultSearchLimit
): ExternalDiscoveryResult[] {
  const normalizedLimit = normalizeSearchLimit(limit);
  const results: ExternalDiscoveryResult[] = [];
  const seenVideoIds = new Set<string>();
  const stack = [initialData];

  while (stack.length > 0 && results.length < normalizedLimit) {
    const current = stack.pop();

    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }

    const record = asRecord(current);

    if (!record) {
      continue;
    }

    const videoRenderer = asRecord(record.videoRenderer);
    const lockupViewModel = asRecord(record.lockupViewModel);
    const result =
      (videoRenderer && videoResultFromRenderer(videoRenderer, importPolicyMode)) ??
      (lockupViewModel && videoResultFromLockup(lockupViewModel, importPolicyMode)) ??
      null;

    if (result && !seenVideoIds.has(result.sourceId)) {
      seenVideoIds.add(result.sourceId);
      results.push(result);
    }

    const values = Object.values(record);

    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];

      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return results;
}

function normalizeText(value: string | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function normalizeSearchQuery(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function normalizeSearchLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultSearchLimit;
  }

  return Math.max(1, Math.min(maxSearchLimit, Math.floor(value)));
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

function readBalancedJsonObject(text: string, objectStart: number) {
  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

function videoResultFromRenderer(
  renderer: Record<string, unknown>,
  importPolicyMode: ImportPolicyMode
): ExternalDiscoveryResult | null {
  const videoId = normalizeText(typeof renderer.videoId === "string" ? renderer.videoId : undefined);

  if (!isYouTubeVideoId(videoId)) {
    return null;
  }

  return {
    provider: "youtube",
    sourceId: videoId,
    canonicalUrl: canonicalWatchUrl(videoId),
    title: firstText(renderer.title) ?? `YouTube video ${videoId}`,
    creator:
      firstText(renderer.ownerText, renderer.shortBylineText, renderer.longBylineText) ?? null,
    thumbnailUrl: thumbnailUrlFrom(renderer.thumbnail) ?? defaultThumbnailUrl(videoId),
    durationMs: durationMsFromText(firstText(renderer.lengthText)),
    description:
      firstText(renderer.descriptionSnippet, detailedMetadataSnippetText(renderer)) ?? null,
    importPolicyMode
  };
}

function videoResultFromLockup(
  lockup: Record<string, unknown>,
  importPolicyMode: ImportPolicyMode
): ExternalDiscoveryResult | null {
  const videoId =
    normalizeText(typeof lockup.contentId === "string" ? lockup.contentId : undefined) ??
    findNestedWatchVideoId(lockup);

  if (!isYouTubeVideoId(videoId)) {
    return null;
  }

  const metadata = asRecord(lockup.metadata);
  const lockupMetadata = asRecord(metadata?.lockupMetadataViewModel);
  const title = firstText(lockupMetadata?.title, lockup.title);
  const image = asRecord(lockup.contentImage);

  return {
    provider: "youtube",
    sourceId: videoId,
    canonicalUrl: canonicalWatchUrl(videoId),
    title: title ?? `YouTube video ${videoId}`,
    creator: firstText(lockupMetadata?.metadata, lockupMetadata?.subtitle) ?? null,
    thumbnailUrl: thumbnailUrlFrom(image?.collectionThumbnailViewModel) ?? defaultThumbnailUrl(videoId),
    durationMs: durationMsFromText(firstText(lockupMetadata?.duration, lockup.duration)),
    description: firstText(lockupMetadata?.description) ?? null,
    importPolicyMode
  };
}

function detailedMetadataSnippetText(renderer: Record<string, unknown>) {
  const snippets = Array.isArray(renderer.detailedMetadataSnippets)
    ? renderer.detailedMetadataSnippets
    : [];

  for (const snippet of snippets) {
    const record = asRecord(snippet);
    const text = firstText(record?.snippetText);

    if (text) {
      return text;
    }
  }

  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = textFromYouTubeText(value);

    if (text) {
      return text;
    }
  }

  return null;
}

function textFromYouTubeText(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeText(value);
  }

  const record = asRecord(value);

  if (!record) {
    return null;
  }

  if (typeof record.simpleText === "string") {
    return normalizeText(record.simpleText);
  }

  if (typeof record.content === "string") {
    return normalizeText(record.content);
  }

  if (Array.isArray(record.runs)) {
    return normalizeText(
      record.runs
        .map((run) => {
          const runRecord = asRecord(run);
          return typeof runRecord?.text === "string" ? runRecord.text : "";
        })
        .join("")
    );
  }

  return null;
}

function thumbnailUrlFrom(value: unknown) {
  const thumbnails = collectThumbnails(value);

  if (thumbnails.length === 0) {
    return null;
  }

  thumbnails.sort((a, b) => b.score - a.score);

  return thumbnails[0].url;
}

function collectThumbnails(value: unknown) {
  const record = asRecord(value);

  if (!record) {
    return [];
  }

  const candidates = Array.isArray(record.thumbnails) ? record.thumbnails : [];
  const nested = [
    asRecord(record.primaryThumbnail)?.thumbnail,
    asRecord(record.thumbnail)?.thumbnails,
    asRecord(record.sources)
  ];

  return [...candidates, ...nested.flatMap((item) => (Array.isArray(item) ? item : [item]))]
    .map((item) => {
      const thumbnail = asRecord(item);
      const url = normalizeText(typeof thumbnail?.url === "string" ? thumbnail.url : undefined);

      if (!url) {
        return null;
      }

      const width = typeof thumbnail?.width === "number" ? thumbnail.width : 0;
      const height = typeof thumbnail?.height === "number" ? thumbnail.height : 0;

      return {
        score: width * height,
        url
      };
    })
    .filter((item): item is { score: number; url: string } => Boolean(item));
}

function durationMsFromText(value: string | null) {
  if (!value) {
    return null;
  }

  const parts = value
    .trim()
    .split(":")
    .map((part) => Number.parseInt(part, 10));

  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);

  return seconds * 1000;
}

function findNestedWatchVideoId(value: unknown, maxDepth = 8): string | null {
  if (maxDepth < 0) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const videoId = findNestedWatchVideoId(item, maxDepth - 1);

      if (videoId) {
        return videoId;
      }
    }
    return null;
  }

  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const watchEndpoint = asRecord(record.watchEndpoint);
  const videoId = normalizeText(
    typeof watchEndpoint?.videoId === "string" ? watchEndpoint.videoId : undefined
  );

  if (isYouTubeVideoId(videoId)) {
    return videoId;
  }

  for (const child of Object.values(record)) {
    const nestedVideoId = findNestedWatchVideoId(child, maxDepth - 1);

    if (nestedVideoId) {
      return nestedVideoId;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
