import type { ExternalDiscoveryResponse, ImportPolicyMode } from "@tunely/shared";
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
import {
  YouTubeDiscoveryError,
  YouTubeDiscoveryProvider,
  type YouTubeDiscoveryClient
} from "./youtube.js";

const defaultDiscoveryRateLimit = {
  maxRequests: 60,
  windowMs: 60_000
} as const;

export interface ExternalDiscoveryRoutesOptions {
  authService: AuthService;
  importPolicyConfig?: ImportPolicyRuntimeConfig;
  songRepository?: SQLiteSongRepository;
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
        sourcePolicies: options.songRepository?.listEnabledSourcePolicies("youtube"),
        user,
        importPolicyConfig,
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
        sourcePolicies: options.songRepository?.listEnabledSourcePolicies("youtube"),
        user,
        importPolicyConfig,
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
  url: unknown;
  importPolicyMode: ImportPolicyMode;
  importPolicyConfig: ImportPolicyRuntimeConfig;
  sourcePolicies?: ReturnType<SQLiteSongRepository["listEnabledSourcePolicies"]>;
  user: PublicUser;
}): Promise<ExternalDiscoveryResponse> {
  const url = typeof input.url === "string" ? input.url.trim() : "";

  if (url) {
    const result = await input.provider.normalizeUrl(url, input.importPolicyMode);
    const matchingPolicy = input.sourcePolicies?.find(
      (policy) =>
        policy.provider === result.provider &&
        policy.action === "allow" &&
        ((policy.scopeType === "source" && policy.scopeValue === result.sourceId.toLowerCase()) ||
          (policy.scopeType === "provider" && policy.scopeValue === result.provider) ||
          (policy.scopeType === "domain" &&
            policy.scopeValue === hostnameForUrl(result.canonicalUrl)))
    );

    return {
      nextPageToken: null,
      results: [
        {
          ...result,
          attributionText: matchingPolicy?.attributionText ?? null,
          eligibility: evaluateExternalImportEligibility({
            config: input.importPolicyConfig,
            discovery: result,
            sourcePolicies: input.sourcePolicies,
            user: input.user
          }),
          licenseType: matchingPolicy?.licenseType ?? null,
          licenseUrl: matchingPolicy?.licenseUrl ?? null
        }
      ]
    };
  }

  throw new YouTubeDiscoveryError(
    "youtube_url_required",
    "A YouTube URL is required.",
    400,
    false
  );
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
