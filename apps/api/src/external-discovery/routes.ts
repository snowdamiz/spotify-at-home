import type {
  ExternalAudioReuse,
  ExternalDiscoveryResponse,
  ImportPolicyMode
} from "@broadside/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readAccessToken } from "../auth/routes.js";
import { AuthError, type AuthService, type PublicUser } from "../auth/service.js";
import {
  evaluateExternalImportEligibility,
  readImportPolicyRuntimeConfig,
  resolveImportPolicyStatus,
  type ImportPolicyRuntimeConfig
} from "../import-policy/policy.js";
import type { SQLiteSongRepository } from "../db/repositories.js";
import { createAudioStorageFromEnv, type AudioStorage } from "../songs/storage.js";
import {
  YouTubeDiscoveryError,
  YouTubeDiscoveryProvider,
  type YouTubeDiscoveryClient,
  type YouTubeSearchOptions
} from "./youtube.js";

const defaultDiscoveryRateLimit = {
  maxRequests: 60,
  windowMs: 60_000
} as const;

export interface ExternalDiscoveryRoutesOptions {
  authService: AuthService;
  audioStorage?: AudioStorage;
  importPolicyConfig?: ImportPolicyRuntimeConfig;
  songRepository?: SQLiteSongRepository;
  storageRoot?: string;
  youtubeProvider?: YouTubeDiscoveryClient;
  rateLimit?: {
    maxRequests?: number;
    windowMs?: number;
  };
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function registerExternalDiscoveryRoutes(
  app: FastifyInstance,
  options: ExternalDiscoveryRoutesOptions
) {
  const importPolicyConfig = options.importPolicyConfig ?? readImportPolicyRuntimeConfig();
  const youtubeProvider = options.youtubeProvider ?? new YouTubeDiscoveryProvider();
  const audioStorage =
    options.audioStorage ??
    createAudioStorageFromEnv({ storageRoot: options.storageRoot });
  const rateLimiter = createDiscoveryRateLimiter(options.rateLimit);

  app.post("/api/external-discovery/youtube", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    if (!importPolicyConfig.externalDiscoveryEnabled) {
      return sendDiscoveryError(
        reply,
        "external_discovery_disabled",
        "External discovery is currently disabled.",
        503,
        { recoverable: true }
      );
    }

    if (!rateLimiter.consume(`user:${user.id}`) || !rateLimiter.consume(`ip:${request.ip}`)) {
      return sendDiscoveryError(
        reply,
        "external_discovery_rate_limited",
        "External discovery is temporarily rate limited.",
        429,
        {
          recoverable: true
        }
      );
    }

    const body = asRecord(request.body);
    const importPolicy = resolveImportPolicyStatus(user, importPolicyConfig);

    try {
      const discovery = await resolveYouTubeDiscovery({
        importPolicyMode: importPolicy.mode,
        provider: youtubeProvider,
        audioStorage,
        songRepository: options.songRepository,
        sourcePolicies: options.songRepository?.listEnabledSourcePolicies("youtube"),
        user,
        importPolicyConfig,
        limit: body.limit,
        query: body.query,
        url: body.url
      });

      return {
        discovery: {
          importPolicy,
          ...discovery
        }
      };
    } catch (error) {
      if (error instanceof YouTubeDiscoveryError) {
        return sendDiscoveryError(reply, error.code, error.message, error.statusCode, {
          recoverable: error.recoverable
        });
      }

      throw error;
    }
  });

  app.get("/api/external-discovery/youtube", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    if (!importPolicyConfig.externalDiscoveryEnabled) {
      return sendDiscoveryError(
        reply,
        "external_discovery_disabled",
        "External discovery is currently disabled.",
        503,
        { recoverable: true }
      );
    }

    if (!rateLimiter.consume(`user:${user.id}`) || !rateLimiter.consume(`ip:${request.ip}`)) {
      return sendDiscoveryError(
        reply,
        "external_discovery_rate_limited",
        "External discovery is temporarily rate limited.",
        429,
        {
          recoverable: true
        }
      );
    }

    const query = asRecord(request.query);
    const importPolicy = resolveImportPolicyStatus(user, importPolicyConfig);

    try {
      const discovery = await resolveYouTubeDiscovery({
        importPolicyMode: importPolicy.mode,
        provider: youtubeProvider,
        audioStorage,
        songRepository: options.songRepository,
        sourcePolicies: options.songRepository?.listEnabledSourcePolicies("youtube"),
        user,
        importPolicyConfig,
        limit: query.limit,
        query: query.query,
        url: query.url
      });

      return {
        discovery: {
          importPolicy,
          ...discovery
        }
      };
    } catch (error) {
      if (error instanceof YouTubeDiscoveryError) {
        return sendDiscoveryError(reply, error.code, error.message, error.statusCode, {
          recoverable: error.recoverable
        });
      }

      throw error;
    }
  });
}

async function resolveYouTubeDiscovery(input: {
  provider: YouTubeDiscoveryClient;
  audioStorage: AudioStorage;
  songRepository?: SQLiteSongRepository;
  query: unknown;
  url: unknown;
  limit: unknown;
  importPolicyMode: ImportPolicyMode;
  importPolicyConfig: ImportPolicyRuntimeConfig;
  sourcePolicies?: ReturnType<SQLiteSongRepository["listEnabledSourcePolicies"]>;
  user: PublicUser;
}): Promise<ExternalDiscoveryResponse> {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const limit = normalizeSearchLimit(input.limit);

  if (url) {
    const result = await input.provider.normalizeUrl(url, input.importPolicyMode);

    return {
      nextPageToken: null,
      results: [
        await withDiscoveryMetadata({
          audioStorage: input.audioStorage,
          discovery: result,
          importPolicyConfig: input.importPolicyConfig,
          songRepository: input.songRepository,
          sourcePolicies: input.sourcePolicies,
          user: input.user
        })
      ]
    };
  }

  if (query) {
    if (!input.provider.search) {
      throw new YouTubeDiscoveryError(
        "youtube_search_unavailable",
        "YouTube search is temporarily unavailable.",
        503,
        true
      );
    }

    const discovery = await input.provider.search(query, input.importPolicyMode, { limit });

    return {
      nextPageToken: discovery.nextPageToken,
      results: await Promise.all(
        discovery.results.map((result) =>
          withDiscoveryMetadata({
            audioStorage: input.audioStorage,
            discovery: result,
            importPolicyConfig: input.importPolicyConfig,
            songRepository: input.songRepository,
            sourcePolicies: input.sourcePolicies,
            user: input.user
          })
        )
      )
    };
  }

  throw new YouTubeDiscoveryError(
    "youtube_url_required",
    "A YouTube URL or search query is required.",
    400,
    false
  );
}

async function withDiscoveryMetadata(input: {
  audioStorage: AudioStorage;
  discovery: ExternalDiscoveryResponse["results"][number];
  importPolicyConfig: ImportPolicyRuntimeConfig;
  songRepository?: SQLiteSongRepository;
  sourcePolicies?: ReturnType<SQLiteSongRepository["listEnabledSourcePolicies"]>;
  user: PublicUser;
}) {
  const discovery = withPolicyMetadata({
    discovery: input.discovery,
    importPolicyConfig: input.importPolicyConfig,
    sourcePolicies: input.sourcePolicies,
    user: input.user
  });
  const reusableAudio = await findReusableAudio({
    audioStorage: input.audioStorage,
    discovery,
    songRepository: input.songRepository,
    user: input.user
  });

  return {
    ...discovery,
    reusableAudio
  };
}

async function findReusableAudio(input: {
  audioStorage: AudioStorage;
  discovery: ExternalDiscoveryResponse["results"][number];
  songRepository?: SQLiteSongRepository;
  user: PublicUser;
}): Promise<ExternalAudioReuse | null> {
  const currentUserMatch = input.songRepository?.findReadySongByExternalSourceForUser({
    provider: input.discovery.provider,
    sourceId: input.discovery.sourceId,
    userId: input.user.id
  });

  if (currentUserMatch) {
    return {
      state: "already_in_library" as const,
      storageLocation: storageLocationForPath(currentUserMatch.song.storagePath),
      songId: currentUserMatch.song.id,
      sizeBytes: currentUserMatch.song.sizeBytes
    };
  }

  const reusableLibraryMatch = input.songRepository?.findReadySongByExternalSource({
    provider: input.discovery.provider,
    sourceId: input.discovery.sourceId
  });

  if (reusableLibraryMatch) {
    const storedAudio = await statStoredAudioIfExists(
      input.audioStorage,
      reusableLibraryMatch.song.storagePath
    );

    if (storedAudio) {
      return {
        state: "stored_audio_available" as const,
        storageLocation: storageLocationForPath(reusableLibraryMatch.song.storagePath),
        songId: null,
        sizeBytes: storedAudio.sizeBytes
      };
    }
  }

  const expectedStoragePath = input.audioStorage.resolveSharedOriginalPath?.({
    provider: input.discovery.provider,
    sourceId: input.discovery.sourceId
  });

  if (!expectedStoragePath) {
    return null;
  }

  const storedAudio = await statStoredAudioIfExists(input.audioStorage, expectedStoragePath);

  if (!storedAudio) {
    return null;
  }

  return {
    state: "stored_audio_available" as const,
    storageLocation: storageLocationForPath(expectedStoragePath),
    songId: null,
    sizeBytes: storedAudio.sizeBytes
  };
}

async function statStoredAudioIfExists(audioStorage: AudioStorage, storagePath: string) {
  if (!storagePath) {
    return null;
  }

  try {
    if (audioStorage.statOriginal) {
      return await audioStorage.statOriginal(storagePath);
    }

    return null;
  } catch {
    return null;
  }
}

function storageLocationForPath(storagePath: string): "r2" | "local" {
  return storagePath.startsWith("r2://") ? "r2" : "local";
}

function withPolicyMetadata(input: {
  discovery: ExternalDiscoveryResponse["results"][number];
  importPolicyConfig: ImportPolicyRuntimeConfig;
  sourcePolicies?: ReturnType<SQLiteSongRepository["listEnabledSourcePolicies"]>;
  user: PublicUser;
}) {
  const matchingPolicy = input.sourcePolicies?.find(
    (policy) =>
      policy.provider === input.discovery.provider &&
      policy.action === "allow" &&
      ((policy.scopeType === "source" &&
        policy.scopeValue === input.discovery.sourceId.toLowerCase()) ||
        (policy.scopeType === "provider" && policy.scopeValue === input.discovery.provider) ||
        (policy.scopeType === "domain" &&
          policy.scopeValue === hostnameForUrl(input.discovery.canonicalUrl)))
  );

  return {
    ...input.discovery,
    attributionText: matchingPolicy?.attributionText ?? null,
    eligibility: evaluateExternalImportEligibility({
      config: input.importPolicyConfig,
      discovery: input.discovery,
      sourcePolicies: input.sourcePolicies,
      user: input.user
    }),
    licenseType: matchingPolicy?.licenseType ?? null,
    licenseUrl: matchingPolicy?.licenseUrl ?? null
  };
}

function normalizeSearchLimit(value: unknown): YouTubeSearchOptions["limit"] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function hostnameForUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function createDiscoveryRateLimiter(
  options: ExternalDiscoveryRoutesOptions["rateLimit"] | undefined
) {
  const maxRequests = options?.maxRequests ?? defaultDiscoveryRateLimit.maxRequests;
  const windowMs = options?.windowMs ?? defaultDiscoveryRateLimit.windowMs;
  const buckets = new Map<string, RateLimitBucket>();

  return {
    consume(key: string) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, {
          count: 1,
          resetAt: now + windowMs
        });
        return true;
      }

      if (bucket.count >= maxRequests) {
        return false;
      }

      bucket.count += 1;
      return true;
    }
  };
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService
): Promise<PublicUser | null> {
  try {
    return await authService.getUserForAccessToken(readAccessToken(request));
  } catch (error) {
    if (error instanceof AuthError) {
      sendDiscoveryError(reply, error.code, error.message, error.statusCode);
      return null;
    }

    throw error;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sendDiscoveryError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode: number,
  details: Record<string, unknown> = {}
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      details,
      requestId: reply.request.id
    }
  });
}
