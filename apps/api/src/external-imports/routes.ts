import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  serializeExternalImportJob,
  serializeExternalSource,
  validateAudioImportMetadata,
  type ExternalDiscoveryResult
} from "@broadside/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthService, type PublicUser } from "../auth/service.js";
import { readAccessToken } from "../auth/routes.js";
import { randomToken } from "../auth/crypto.js";
import {
  ExternalSourceAlreadyInLibraryError,
  type ImportJob,
  type SQLiteSongRepository,
  type Song
} from "../db/repositories.js";
import {
  assertExternalImportAllowed,
  ImportPolicyError,
  isAdminUser,
  readImportPolicyRuntimeConfig,
  resolveImportPolicyStatus,
  type ImportPolicyRuntimeConfig
} from "../import-policy/policy.js";
import { YouTubeDiscoveryError, YouTubeDiscoveryProvider, type YouTubeDiscoveryClient } from "../external-discovery/youtube.js";
import { createAudioStorageFromEnv, type AudioStorage } from "../songs/storage.js";
import {
  YouTubeImportAdapterError,
  YtDlpYouTubeImportAdapter,
  type ResolvedExternalAudio,
  type YouTubeImportAdapter
} from "./youtubeAdapter.js";

const defaultExternalImportRateLimit = {
  maxRequests: 20,
  windowMs: 60_000
} as const;

export interface ExternalImportRoutesOptions {
  authService: AuthService;
  songRepository: SQLiteSongRepository;
  audioStorage?: AudioStorage;
  storageRoot?: string;
  importPolicyConfig?: ImportPolicyRuntimeConfig;
  youtubeProvider?: YouTubeDiscoveryClient;
  youtubeImportAdapter?: YouTubeImportAdapter;
  rateLimit?: {
    maxRequests?: number;
    windowMs?: number;
  };
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function registerExternalImportRoutes(
  app: FastifyInstance,
  options: ExternalImportRoutesOptions
) {
  const importPolicyConfig = options.importPolicyConfig ?? readImportPolicyRuntimeConfig();
  const youtubeProvider = options.youtubeProvider ?? new YouTubeDiscoveryProvider();
  const youtubeImportAdapter = options.youtubeImportAdapter ?? new YtDlpYouTubeImportAdapter();
  const audioStorage =
    options.audioStorage ??
    createAudioStorageFromEnv({ storageRoot: options.storageRoot });
  const rateLimiter = createRateLimiter(options.rateLimit);

  app.post("/api/external-imports/youtube", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    if (!rateLimiter.consume(`user:${user.id}`) || !rateLimiter.consume(`ip:${request.ip}`)) {
      return sendExternalImportError(
        reply,
        "external_import_rate_limited",
        "External imports are temporarily rate limited.",
        429
      );
    }

    const body = asRecord(request.body);
    const importPolicy = resolveImportPolicyStatus(user, importPolicyConfig);
    let discovery: ExternalDiscoveryResult;

    try {
      discovery = await discoveryFromPayload({
        body,
        importPolicyMode: importPolicy.mode,
        youtubeProvider
      });
    } catch (error) {
      if (error instanceof YouTubeDiscoveryError) {
        return sendExternalImportError(reply, error.code, error.message, error.statusCode);
      }

      throw error;
    }

    const policies = options.songRepository.listEnabledSourcePolicies("youtube");

    try {
      assertExternalImportAllowed({
        config: importPolicyConfig,
        discovery,
        sourcePolicies: policies,
        user
      });
    } catch (error) {
      if (error instanceof ImportPolicyError) {
        return sendExternalImportError(reply, error.code, error.message, error.statusCode, {
          eligibility: {
            message: error.message,
            reasonCode: error.code,
            state: "blocked"
          }
        });
      }

      throw error;
    }

    const duplicate = options.songRepository.findReadySongByExternalSourceForUser({
      provider: "youtube",
      sourceId: discovery.sourceId,
      userId: user.id
    });

    if (duplicate) {
      return reply.code(200).send({
        alreadyInLibrary: true,
        job: null,
        song: serializeSong(duplicate.song)
      });
    }

    const reusable = options.songRepository.findReadySongByExternalSource({
      provider: "youtube",
      sourceId: discovery.sourceId
    });

    if (reusable) {
      const reused = await createSongFromReusableExternalAudio({
        audioStorage,
        discovery,
        importPolicyMode: importPolicy.mode,
        reusableSong: reusable.song,
        songRepository: options.songRepository,
        user
      });

      if (reused) {
        app.log.info({
          event: "external_import_reused",
          jobId: reused.job.id,
          policyMode: importPolicy.mode,
          provider: "youtube",
          sourceId: discovery.sourceId,
          userId: user.id
        });

        return reply.code(201).send({
          alreadyInLibrary: false,
          job: serializeExternalImportJob(reused.job),
          song: serializeSong(reused.song)
        });
      }
    }

    const songId = randomToken(16);
    const expectedStoragePath =
      audioStorage.resolveSharedOriginalPath?.({ provider: "youtube", sourceId: discovery.sourceId }) ??
      audioStorage.resolveOriginalPath?.({ userId: user.id, songId }) ??
      "";
    let resolved: ResolvedExternalAudio | null = null;
    let song: Song | null = null;
    let job: ImportJob | null = null;
    let storedPath: string | null = null;

    try {
      assertExternalImportAllowed({
        config: importPolicyConfig,
        discovery,
        sourcePolicies: policies,
          user
        });

      song = options.songRepository.createSong({
        id: songId,
        userId: user.id,
        title: discovery.title,
        artist: discovery.creator,
        durationMs: discovery.durationMs,
        mimeType: "audio/wav",
        sizeBytes: 0,
        checksum: "",
        storagePath: expectedStoragePath,
        importStatus: "pending"
      });
      const source = options.songRepository.createExternalSource({
        userId: user.id,
        songId: song.id,
        provider: "youtube",
        sourceId: discovery.sourceId,
        canonicalUrl: discovery.canonicalUrl,
        originalTitle: discovery.title,
        originalUploader: discovery.creator,
        thumbnailUrl: discovery.thumbnailUrl,
        importPolicyMode: importPolicy.mode,
        provenance: {
          attributionText: discovery.attributionText ?? null,
          canonicalUrl: discovery.canonicalUrl,
          importPolicyMode: importPolicy.mode,
          licenseType: discovery.licenseType ?? null,
          licenseUrl: discovery.licenseUrl ?? null,
          selectedImportPath: "pending_adapter_resolution",
          watchUrl: discovery.canonicalUrl,
        }
      });
      job = options.songRepository.createImportJob({
        userId: user.id,
        songId: song.id,
        sourceId: source.id,
        status: "pending",
        importPolicyMode: importPolicy.mode,
        provenance: {
          adapter: "pending_adapter_resolution",
          canonicalUrl: discovery.canonicalUrl,
          provider: "youtube",
          sourceId: discovery.sourceId
        }
      });

      resolved = await youtubeImportAdapter.resolve({ discovery });
      const validationError = validateAudioImportMetadata({
        fileName: resolved.fileName,
        mimeType: resolved.mimeType,
        sizeBytes: resolved.content.byteLength
      });

      if (validationError) {
        throw new ExternalImportWorkerError(validationError);
      }

      const provenance = {
        attributionText: discovery.attributionText ?? null,
        canonicalUrl: discovery.canonicalUrl,
        importPolicyMode: importPolicy.mode,
        licenseType: discovery.licenseType ?? null,
        licenseUrl: discovery.licenseUrl ?? null,
        selectedImportPath: resolved.adapter,
        watchUrl: discovery.canonicalUrl,
        ...resolved.provenance
      };

      options.songRepository.updateExternalSourceProvenance({
        userId: user.id,
        sourceId: source.id,
        provenance
      });
      options.songRepository.updateImportJobProvenance({
        userId: user.id,
        jobId: job.id,
        provenance: {
          adapter: resolved.adapter,
          canonicalUrl: discovery.canonicalUrl,
          provider: "youtube",
          sourceId: discovery.sourceId,
          ...resolved.provenance
        }
      });

      storedPath = audioStorage.writeSharedOriginal
        ? await audioStorage.writeSharedOriginal({
            provider: "youtube",
            sourceId: discovery.sourceId,
            content: resolved.content
          })
        : await audioStorage.writeOriginal({
            userId: user.id,
            songId: song.id,
            content: resolved.content
          });
      const checksum = `sha256:${createHash("sha256").update(resolved.content).digest("hex")}`;
      options.songRepository.markSongReady({
        userId: user.id,
        songId: song.id,
        checksum,
        durationMs: resolved.durationMs,
        mimeType: resolved.mimeType,
        sizeBytes: resolved.content.byteLength,
        storagePath: storedPath
      });

      const readySong = options.songRepository.findSongForUser(user.id, song.id) ?? song;
      const readyJob = options.songRepository.findImportJobForUser(user.id, job.id) ?? job;

      app.log.info({
        event: "external_import_ready",
        jobId: readyJob.id,
        policyMode: importPolicy.mode,
        provider: "youtube",
        sourceId: discovery.sourceId,
        userId: user.id
      });

      return reply.code(201).send({
        alreadyInLibrary: false,
        job: serializeExternalImportJob(readyJob),
        song: serializeSong(readySong)
      });
    } catch (error) {
      if (storedPath) {
        await deleteStoredAudioIfUnreferenced(
          options.songRepository,
          audioStorage,
          storedPath,
          song?.id
        );
      }

      const errorCode =
        error instanceof ExternalSourceAlreadyInLibraryError
          ? "external_source_already_in_library"
          : error instanceof YouTubeImportAdapterError
            ? error.code
          : error instanceof ExternalImportWorkerError
            ? error.code
            : "external_import_failed";

      if (song) {
        options.songRepository.markSongImportFailed({
          userId: user.id,
          songId: song.id,
          errorCode
        });
      }

      app.log.info({
        event: "external_import_failed",
        errorCode,
        jobId: job?.id ?? null,
        policyMode: importPolicy.mode,
        provider: "youtube",
        sourceId: discovery.sourceId,
        userId: user.id
      });

      return sendExternalImportError(reply, errorCode, messageForExternalImportError(errorCode), 500);
    }
  });

  app.get("/api/external-import-jobs/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const job = options.songRepository.findImportJobForUser(user.id, String((request.params as { id?: string }).id ?? ""));

    if (!job) {
      return sendExternalImportError(reply, "external_import_job_not_found", "Import job not found.", 404);
    }

    const song = options.songRepository.findSongForUser(user.id, job.songId);

    return {
      job: serializeExternalImportJob(job),
      song: song ? serializeSong(song) : null
    };
  });

  app.get("/api/admin/external-import-jobs/failed", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    if (!isAdminUser(user, importPolicyConfig)) {
      return sendExternalImportError(reply, "admin_required", "Admin access is required.", 403);
    }

    return {
      jobs: options.songRepository
        .listFailedImportJobs(50)
        .map((job) => serializeExternalImportJob(job))
    };
  });

  app.post("/api/admin/source-policies", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    if (!isAdminUser(user, importPolicyConfig)) {
      return sendExternalImportError(reply, "admin_required", "Admin access is required.", 403);
    }

    const body = asRecord(request.body);
    const scopeType = String(body.scopeType ?? "");
    const action = String(body.action ?? "");
    const scopeValue = String(body.scopeValue ?? "").trim();

    if (
      !["provider", "domain", "channel", "source"].includes(scopeType) ||
      !["allow", "block", "review"].includes(action) ||
      !scopeValue
    ) {
      return sendExternalImportError(reply, "invalid_source_policy", "Source policy is invalid.", 400);
    }

    const policy = options.songRepository.createSourcePolicy({
      action: action as "allow" | "block" | "review",
      attributionText: nullableText(body.attributionText),
      createdByUserId: user.id,
      enabled: body.enabled !== false,
      licenseType: nullableText(body.licenseType),
      licenseUrl: nullableText(body.licenseUrl),
      provider: "youtube",
      reason: nullableText(body.reason),
      scopeType: scopeType as "provider" | "domain" | "channel" | "source",
      scopeValue
    });

    return reply.code(201).send({ policy });
  });
}

async function discoveryFromPayload(input: {
  body: Record<string, unknown>;
  importPolicyMode: ExternalDiscoveryResult["importPolicyMode"];
  youtubeProvider: YouTubeDiscoveryClient;
}) {
  if (typeof input.body.url === "string" && input.body.url.trim() !== "") {
    return input.youtubeProvider.normalizeUrl(input.body.url.trim(), input.importPolicyMode);
  }

  const discovery = asRecord(input.body.discovery);

  if (
    discovery.provider === "youtube" &&
    typeof discovery.sourceId === "string" &&
    typeof discovery.canonicalUrl === "string" &&
    typeof discovery.title === "string"
  ) {
    return {
      provider: "youtube",
      sourceId: discovery.sourceId,
      canonicalUrl: discovery.canonicalUrl,
      title: discovery.title,
      creator: nullableText(discovery.creator),
      thumbnailUrl: nullableText(discovery.thumbnailUrl),
      durationMs: typeof discovery.durationMs === "number" ? discovery.durationMs : null,
      description: nullableText(discovery.description),
      importPolicyMode: input.importPolicyMode,
      attributionText: nullableText(discovery.attributionText),
      licenseType: nullableText(discovery.licenseType),
      licenseUrl: nullableText(discovery.licenseUrl)
    } satisfies ExternalDiscoveryResult;
  }

  throw new YouTubeDiscoveryError("youtube_url_required", "A YouTube URL is required.", 400, false);
}

async function createSongFromReusableExternalAudio(input: {
  audioStorage: AudioStorage;
  discovery: ExternalDiscoveryResult;
  importPolicyMode: ExternalDiscoveryResult["importPolicyMode"];
  reusableSong: Song;
  songRepository: SQLiteSongRepository;
  user: PublicUser;
}) {
  try {
    await statStoredAudio(input.audioStorage, input.reusableSong.storagePath);
  } catch {
    return null;
  }

  const song = input.songRepository.createSong({
    id: randomToken(16),
    userId: input.user.id,
    title: input.discovery.title,
    artist: input.discovery.creator ?? input.reusableSong.artist,
    durationMs: input.discovery.durationMs ?? input.reusableSong.durationMs,
    mimeType: input.reusableSong.mimeType,
    sizeBytes: input.reusableSong.sizeBytes,
    checksum: input.reusableSong.checksum,
    storagePath: input.reusableSong.storagePath,
    importStatus: "ready"
  });
  const source = input.songRepository.createExternalSource({
    userId: input.user.id,
    songId: song.id,
    provider: "youtube",
    sourceId: input.discovery.sourceId,
    canonicalUrl: input.discovery.canonicalUrl,
    originalTitle: input.discovery.title,
    originalUploader: input.discovery.creator,
    thumbnailUrl: input.discovery.thumbnailUrl,
    importPolicyMode: input.importPolicyMode,
    provenance: {
      attributionText: input.discovery.attributionText ?? null,
      canonicalUrl: input.discovery.canonicalUrl,
      importPolicyMode: input.importPolicyMode,
      licenseType: input.discovery.licenseType ?? null,
      licenseUrl: input.discovery.licenseUrl ?? null,
      selectedImportPath: "shared_artifact_reuse",
      watchUrl: input.discovery.canonicalUrl
    }
  });
  const job = input.songRepository.createImportJob({
    userId: input.user.id,
    songId: song.id,
    sourceId: source.id,
    status: "ready",
    importPolicyMode: input.importPolicyMode,
    provenance: {
      adapter: "shared_artifact_reuse",
      canonicalUrl: input.discovery.canonicalUrl,
      provider: "youtube",
      sourceId: input.discovery.sourceId
    }
  });

  return {
    job,
    song: input.songRepository.findSongForUser(input.user.id, song.id) ?? song
  };
}

async function statStoredAudio(audioStorage: AudioStorage, storagePath: string) {
  if (audioStorage.statOriginal) {
    return audioStorage.statOriginal(storagePath);
  }

  return { sizeBytes: (await stat(storagePath)).size };
}

async function deleteStoredAudioIfUnreferenced(
  songRepository: SQLiteSongRepository,
  audioStorage: AudioStorage,
  storagePath: string,
  exceptSongId?: string
) {
  if (songRepository.countSongsByStoragePath({ storagePath, exceptSongId }) === 0) {
    await audioStorage.deleteOriginal(storagePath);
  }
}

function createRateLimiter(options: ExternalImportRoutesOptions["rateLimit"] | undefined) {
  const maxRequests = options?.maxRequests ?? defaultExternalImportRateLimit.maxRequests;
  const windowMs = options?.windowMs ?? defaultExternalImportRateLimit.windowMs;
  const buckets = new Map<string, RateLimitBucket>();

  return {
    consume(key: string) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
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
      sendExternalImportError(reply, error.code, error.message, error.statusCode);
      return null;
    }

    throw error;
  }
}

class ExternalImportWorkerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function serializeSong(song: Song) {
  return {
    id: song.id,
    userId: song.userId,
    title: song.title,
    artist: song.artist,
    album: song.album,
    durationMs: song.durationMs,
    mimeType: song.mimeType,
    sizeBytes: song.sizeBytes,
    checksum: song.checksum,
    storagePath: song.storagePath,
    importStatus: song.importStatus,
    externalSource: song.externalSource ? serializeExternalSource(song.externalSource) : null,
    liked: song.liked,
    createdAt: song.createdAt.toISOString(),
    updatedAt: song.updatedAt.toISOString()
  };
}

function messageForExternalImportError(code: string) {
  switch (code) {
    case "external_source_already_in_library":
      return "This source is already in your library.";
    case "unsupported_audio_type":
      return "The resolved audio type is not supported.";
    case "audio_file_too_large":
      return "The resolved audio file is too large.";
    case "missing_audio_metadata":
      return "The resolved audio metadata is incomplete.";
    case "external_audio_download_empty":
      return "The downloaded audio file was empty.";
    case "external_audio_download_missing":
      return "The downloader did not produce an audio file.";
    case "external_audio_download_failed":
      return "Could not download audio from YouTube. Check that yt-dlp and ffmpeg are available in the API runtime.";
    default:
      return "External import failed.";
  }
}

function sendExternalImportError(
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
