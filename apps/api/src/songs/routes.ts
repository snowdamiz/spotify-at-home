import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import {
  AUDIO_IMPORT_LIMITS,
  isImportPolicyMode,
  serializeExternalSource,
  validateAudioImportMetadata,
  type ImportPolicyMode,
  type AudioImportValidationError
} from "@broadside/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomToken } from "../auth/crypto.js";
import { AuthError, type AuthService, type PublicUser } from "../auth/service.js";
import { readAccessToken } from "../auth/routes.js";
import {
  createAudioImportProcessorFromEnv,
  type AudioImportProcessor,
  type ProcessedAudioImport
} from "./audio-processing.js";
import type {
  PlaybackState,
  RepeatMode,
  SQLiteSongRepository,
  Song,
  StorageObjectSummary
} from "../db/repositories.js";
import {
  assertImportPolicyAllowsRequestedMode,
  ImportPolicyError,
  readImportPolicyRuntimeConfig,
  type ImportPolicyRuntimeConfig
} from "../import-policy/policy.js";
import { parseRangeHeader } from "./range.js";
import { createAudioStorageFromEnv, type AudioStorage, type AudioStorageReadRange } from "./storage.js";
import type { LibraryEventSink } from "../library/events.js";

export interface SongRoutesOptions {
  authService: AuthService;
  songRepository: SQLiteSongRepository;
  audioStorage?: AudioStorage;
  storageRoot?: string;
  maxFileSizeBytes?: number;
  userQuotaBytes?: number;
  importPolicyConfig?: ImportPolicyRuntimeConfig;
  libraryEvents?: LibraryEventSink;
  audioProcessor?: AudioImportProcessor;
}

interface ImportPayload {
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  contentBase64?: unknown;
  importPolicyMode?: unknown;
}

interface WipeAccountTracksPayload {
  deleteFromR2?: unknown;
  deleteStoredAudio?: unknown;
}

interface NormalizedImportPayload {
  album?: unknown;
  artist?: unknown;
  content: Buffer | null;
  fileName?: unknown;
  importPolicyMode?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  title?: unknown;
}

const STORAGE_DELETE_CONCURRENCY = 6;

export function registerSongRoutes(app: FastifyInstance, options: SongRoutesOptions) {
  const audioStorage =
    options.audioStorage ??
    createAudioStorageFromEnv({ storageRoot: options.storageRoot });
  const maxFileSizeBytes = options.maxFileSizeBytes ?? AUDIO_IMPORT_LIMITS.maxFileSizeBytes;
  const userQuotaBytes = options.userQuotaBytes ?? AUDIO_IMPORT_LIMITS.defaultUserQuotaBytes;
  const importPolicyConfig = options.importPolicyConfig ?? readImportPolicyRuntimeConfig();
  const audioProcessor = options.audioProcessor ?? createAudioImportProcessorFromEnv();
  const audioImportBodyLimit = Math.ceil(maxFileSizeBytes * 4 / 3) + 16 * 1024;

  registerAudioContentTypeParser(app);

  app.post("/api/songs/import", { bodyLimit: audioImportBodyLimit }, async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = normalizeImportPayload(request);
    let importPolicyMode: ImportPolicyMode = "licensed_only";

    if (body.importPolicyMode !== undefined) {
      if (!isImportPolicyMode(body.importPolicyMode)) {
        return sendSongError(reply, "invalid_import_policy_mode", "Import policy mode is invalid.", 400);
      }

      importPolicyMode = body.importPolicyMode;

      try {
        assertImportPolicyAllowsRequestedMode({
          config: importPolicyConfig,
          requestedMode: importPolicyMode,
          user
        });
      } catch (error) {
        if (error instanceof ImportPolicyError) {
          return sendSongError(reply, error.code, error.message, error.statusCode);
        }

        throw error;
      }
    }

    const metadata = {
      fileName: typeof body.fileName === "string" ? body.fileName : undefined,
      mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
      sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : undefined
    };
    const validationError = validateAudioImportMetadata(metadata, { maxFileSizeBytes });

    if (validationError) {
      return sendSongError(
        reply,
        validationError,
        messageForValidationError(validationError),
        validationError === "audio_file_too_large" ? 413 : 400
      );
    }

    const validMetadata = metadata as { fileName: string; mimeType: string; sizeBytes: number };
    const content = body.content;

    if (!content) {
      return sendSongError(reply, "missing_audio_content", "Audio content is required.", 400);
    }

    if (content.byteLength !== validMetadata.sizeBytes) {
      return sendSongError(reply, "audio_size_mismatch", "Audio content does not match the declared size.", 400);
    }

    let processedAudio: ProcessedAudioImport;

    try {
      processedAudio = await audioProcessor.process({
        content,
        fileName: validMetadata.fileName,
        mimeType: validMetadata.mimeType
      });
    } catch {
      return sendSongError(reply, "audio_processing_failed", "Audio file could not be normalized.", 500);
    }

    const processedValidationError = validateAudioImportMetadata(
      {
        fileName: processedAudio.fileName,
        mimeType: processedAudio.mimeType,
        sizeBytes: processedAudio.content.byteLength
      },
      { maxFileSizeBytes }
    );

    if (processedValidationError) {
      return sendSongError(
        reply,
        processedValidationError,
        messageForValidationError(processedValidationError),
        processedValidationError === "audio_file_too_large" ? 413 : 400
      );
    }

    if (options.songRepository.sumReadySongBytesForUser(user.id) + processedAudio.content.byteLength > userQuotaBytes) {
      return sendSongError(reply, "storage_quota_exceeded", "Import would exceed the account storage quota.", 413);
    }

    const songId = randomToken(16);
    const expectedStoragePath =
      audioStorage.resolveOriginalPath?.({ userId: user.id, songId }) ?? "";
    const song = options.songRepository.createSong({
      id: songId,
      userId: user.id,
      title: titleFromPayload(body.title, validMetadata.fileName),
      artist: nullableText(body.artist),
      album: nullableText(body.album),
      durationMs: processedAudio.durationMs,
      mimeType: processedAudio.mimeType,
      sizeBytes: processedAudio.content.byteLength,
      checksum: "",
      storagePath: expectedStoragePath,
      importStatus: "pending"
    });
    options.songRepository.createImportJob({
      userId: user.id,
      songId: song.id,
      importPolicyMode,
      status: "pending"
    });

    let storedPath: string | null = null;

    try {
      storedPath = await audioStorage.writeOriginal({
        userId: user.id,
        songId: song.id,
        content: processedAudio.content
      });
      const checksum = `sha256:${createHash("sha256").update(processedAudio.content).digest("hex")}`;
      options.songRepository.markSongReady({
        userId: user.id,
        songId: song.id,
        checksum,
        durationMs: processedAudio.durationMs,
        mimeType: processedAudio.mimeType,
        sizeBytes: processedAudio.content.byteLength,
        storagePath: storedPath
      });
      const readySong = options.songRepository.findSongForUser(user.id, song.id);
      options.libraryEvents?.emitLibraryChanged(user.id, {
        reason: "audio_import_completed",
        songId: (readySong ?? song).id
      });

      return reply.code(201).send({ song: readySong ? serializeSong(readySong) : serializeSong(song) });
    } catch {
      if (storedPath) {
        await deleteStoredAudioIfUnreferenced(options.songRepository, audioStorage, storedPath, song.id);
      }
      options.songRepository.markSongImportFailed({
        userId: user.id,
        songId: song.id,
        errorCode: "audio_storage_write_failed"
      });

      return sendSongError(
        reply,
        "audio_storage_write_failed",
        "Audio file could not be stored.",
        500
      );
    }
  });

  app.get("/api/songs", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    return {
      songs: options.songRepository.listReadySongsForUser(user.id).map(serializeSong)
    };
  });

  app.get("/api/admin/storage-objects", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService, {
      requireEntryKeyAccess: false
    });

    if (!user) {
      return;
    }

    if (!user.isAdmin) {
      return sendSongError(reply, "admin_required", "Admin access is required.", 403);
    }

    const driver = audioStorageDriver();
    const objects = options.songRepository.listStorageObjectsForAdmin();
    const totalObjects = options.songRepository.countStorageObjectsForAdmin();
    const serializedObjects = await Promise.all(
      objects.map((object) => serializeStorageObject(audioStorage, object))
    );
    const totalBytes = serializedObjects.reduce((total, object) => total + object.sizeBytes, 0);

    return {
      storage: {
        driver,
        objects: serializedObjects,
        returnedObjects: objects.length,
        totalBytes,
        totalObjects
      }
    };
  });

  app.post("/api/account/tracks/wipe", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService, {
      requireEntryKeyAccess: false
    });

    if (!user) {
      return;
    }

    if (!user.isAdmin) {
      return sendSongError(reply, "admin_required", "Admin access is required.", 403);
    }

    const body = (request.body && typeof request.body === "object" ? request.body : {}) as WipeAccountTracksPayload;
    const deleteStoredAudio = body.deleteStoredAudio === true || body.deleteFromR2 === true;
    const storagePaths = deleteStoredAudio
      ? options.songRepository.listStoragePathsForUser(user.id)
      : [];
    const deletedTracks = options.songRepository.deleteAllSongsForUser(user.id);
    const storageDeletion = deleteStoredAudio
      ? await deleteStoredAudioForWipedAccount(
          options.songRepository,
          audioStorage,
          storagePaths
        )
      : {
          clearedStorageReferences: 0,
          deletedStoredObjects: 0,
          failedStoredObjects: 0,
          retainedStoredObjects: 0,
          storageCandidates: 0
        };

    if (deletedTracks > 0) {
      options.libraryEvents?.emitLibraryChanged(user.id, {
        reason: "account_tracks_wiped"
      });
    }

    return {
      deletion: {
        deletedTracks,
        storageDeleteRequested: deleteStoredAudio,
        ...storageDeletion
      }
    };
  });

  app.get("/api/songs/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const song = options.songRepository.findSongForUser(user.id, songIdFromParams(request.params));

    if (!song || song.importStatus !== "ready") {
      return sendSongError(reply, "song_not_found", "Song not found.", 404);
    }

    return { song: serializeSong(song) };
  });

  app.get("/api/songs/:id/stream", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const song = findReadySongForUser(
      options.songRepository,
      user.id,
      songIdFromParams(request.params)
    );

    if (!song) {
      return sendSongError(reply, "song_not_found", "Song not found.", 404);
    }

    let fileSize: number;

    try {
      fileSize = await sizeForStreaming(audioStorage, song);
    } catch {
      return sendSongError(reply, "audio_file_missing", "Audio file is not available.", 404);
    }

    const parsedRange = parseRangeHeader(headerValue(request.headers.range), fileSize);

    if (parsedRange === "invalid") {
      reply.header("accept-ranges", "bytes");
      reply.header("content-range", `bytes */${fileSize}`);
      return sendSongError(reply, "invalid_range", "Requested byte range is not satisfiable.", 416);
    }

    if (parsedRange) {
      const contentLength = parsedRange.end - parsedRange.start + 1;
      let stream;

      try {
        stream = await readStoredAudio(audioStorage, song.storagePath, parsedRange);
      } catch {
        return sendSongError(reply, "audio_file_missing", "Audio file is not available.", 404);
      }

      reply.header("accept-ranges", "bytes");
      reply.header("content-type", song.mimeType);
      reply.code(206);
      reply.header("content-length", String(contentLength));
      reply.header("content-range", `bytes ${parsedRange.start}-${parsedRange.end}/${fileSize}`);
      return reply.send(stream);
    }

    let stream;

    try {
      stream = await readStoredAudio(audioStorage, song.storagePath);
    } catch {
      return sendSongError(reply, "audio_file_missing", "Audio file is not available.", 404);
    }

    reply.header("accept-ranges", "bytes");
    reply.header("content-type", song.mimeType);
    reply.header("content-length", String(fileSize));
    return reply.send(stream);
  });

  app.post("/api/songs/:id/cache-intent", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const song = findReadySongForUser(
      options.songRepository,
      user.id,
      songIdFromParams(request.params)
    );

    if (!song) {
      return sendSongError(reply, "song_not_found", "Song not found.", 404);
    }

    return reply.code(202).send({
      cacheIntent: {
        checksum: song.checksum,
        mimeType: song.mimeType,
        sizeBytes: song.sizeBytes,
        songId: song.id,
        streamUrl: `/api/songs/${encodeURIComponent(song.id)}/stream`
      }
    });
  });

  app.put("/api/songs/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = (request.body && typeof request.body === "object" ? request.body : {}) as {
      title?: unknown;
      artist?: unknown;
      album?: unknown;
    };
    const song = options.songRepository.updateSongForUser({
      userId: user.id,
      songId: songIdFromParams(request.params),
      title: typeof body.title === "string" && body.title.trim() !== "" ? body.title.trim() : undefined,
      artist: nullableText(body.artist),
      album: nullableText(body.album)
    });

    if (!song) {
      return sendSongError(reply, "song_not_found", "Song not found.", 404);
    }

    return { song: serializeSong(song) };
  });

  app.delete("/api/songs/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const song = options.songRepository.findSongForUser(user.id, songIdFromParams(request.params));

    if (!song) {
      return sendSongError(reply, "song_not_found", "Song not found.", 404);
    }

    options.songRepository.deleteSongForUser(user.id, song.id);

    return reply.code(204).send();
  });

  app.get("/api/playback-state", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    return {
      playbackState: serializePlaybackState(options.songRepository.getPlaybackStateForUser(user.id))
    };
  });

  app.put("/api/playback-state", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = (request.body && typeof request.body === "object" ? request.body : {}) as {
      songId?: unknown;
      positionMs?: unknown;
      shuffleEnabled?: unknown;
      repeatMode?: unknown;
    };
    const songId = typeof body.songId === "string" && body.songId.trim() !== "" ? body.songId : null;
    const positionMs = normalizePositionMs(body.positionMs);
    const repeatMode = normalizeRepeatMode(body.repeatMode);

    if (positionMs === null || repeatMode === null || typeof body.shuffleEnabled !== "boolean") {
      return sendSongError(reply, "invalid_playback_state", "Playback state is invalid.", 400);
    }

    if (songId && !findReadySongForUser(options.songRepository, user.id, songId)) {
      return sendSongError(reply, "song_not_found", "Song not found.", 404);
    }

    options.songRepository.setPlaybackState({
      userId: user.id,
      songId,
      positionMs,
      shuffleEnabled: body.shuffleEnabled,
      repeatMode
    });

    return {
      playbackState: serializePlaybackState(options.songRepository.getPlaybackStateForUser(user.id))
    };
  });
}

function registerAudioContentTypeParser(app: FastifyInstance) {
  app.addContentTypeParser(/^audio\/.*/i, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
}

function normalizeImportPayload(request: FastifyRequest): NormalizedImportPayload {
  if (Buffer.isBuffer(request.body)) {
    const query = asRecord(request.query);
    const contentType = cleanMimeType(headerValue(request.headers["content-type"]));
    const sizeBytes = numberFromUnknown(query.sizeBytes) ?? request.body.byteLength;

    return {
      album: query.album,
      artist: query.artist,
      content: request.body,
      fileName: query.fileName,
      importPolicyMode: query.importPolicyMode,
      mimeType: query.mimeType ?? contentType,
      sizeBytes,
      title: query.title
    };
  }

  const body = (request.body && typeof request.body === "object" ? request.body : {}) as ImportPayload;

  return {
    album: body.album,
    artist: body.artist,
    content: decodeBase64Content(body.contentBase64),
    fileName: body.fileName,
    importPolicyMode: body.importPolicyMode,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    title: body.title
  };
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
  options: { requireEntryKeyAccess?: boolean } = {}
): Promise<PublicUser | null> {
  try {
    return await authService.getUserForAccessToken(readAccessToken(request), options);
  } catch (error) {
    if (error instanceof AuthError) {
      sendSongError(reply, error.code, error.message, error.statusCode);
      return null;
    }

    throw error;
  }
}

function decodeBase64Content(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return Buffer.from(value, "base64");
}

function titleFromPayload(title: unknown, fileName: string) {
  if (typeof title === "string" && title.trim() !== "") {
    return title.trim();
  }

  return fileName.replace(/\.[^.]+$/, "");
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function songIdFromParams(params: unknown) {
  return String((params as { id?: string }).id ?? "");
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function cleanMimeType(value: string | undefined) {
  return value?.split(";")[0]?.trim() || undefined;
}

function findReadySongForUser(
  songRepository: SQLiteSongRepository,
  userId: string,
  songId: string
) {
  const song = songRepository.findSongForUser(userId, songId);

  return song?.importStatus === "ready" ? song : null;
}

function normalizePositionMs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}

function normalizeRepeatMode(value: unknown): RepeatMode | null {
  return value === "off" || value === "one" || value === "all" ? value : null;
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function statStoredAudio(audioStorage: AudioStorage, storagePath: string) {
  if (audioStorage.statOriginal) {
    return audioStorage.statOriginal(storagePath);
  }

  return { sizeBytes: (await stat(storagePath)).size };
}

async function sizeForStreaming(audioStorage: AudioStorage, song: Song) {
  if (storageObjectLocation(song.storagePath) === "r2" && song.sizeBytes > 0) {
    return song.sizeBytes;
  }

  return (await statStoredAudio(audioStorage, song.storagePath)).sizeBytes;
}

async function readStoredAudio(
  audioStorage: AudioStorage,
  storagePath: string,
  range?: AudioStorageReadRange
) {
  if (audioStorage.readOriginal) {
    return audioStorage.readOriginal({ storagePath, range });
  }

  return createReadStream(storagePath, range);
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

async function deleteStoredAudioForWipedAccount(
  songRepository: SQLiteSongRepository,
  audioStorage: AudioStorage,
  storagePaths: string[]
) {
  const uniqueStoragePaths = [...new Set(storagePaths)];
  const summary: StorageDeletionSummary = {
    clearedStorageReferences: 0,
    deletedStoredObjects: 0,
    failedStoredObjects: 0,
    retainedStoredObjects: 0,
    storageCandidates: uniqueStoragePaths.length
  };

  const results = await runWithConcurrency(
    uniqueStoragePaths,
    STORAGE_DELETE_CONCURRENCY,
    async (storagePath): Promise<StorageDeletionSummary> => {
      if (songRepository.countActiveSongsByStoragePath({ storagePath }) > 0) {
        return {
          clearedStorageReferences: 0,
          deletedStoredObjects: 0,
          failedStoredObjects: 0,
          retainedStoredObjects: 1,
          storageCandidates: 0
        };
      }

      try {
        await deleteStoredAudioObject(audioStorage, storagePath);
        return {
          clearedStorageReferences: songRepository.clearDeletedSongStoragePath(storagePath),
          deletedStoredObjects: 1,
          failedStoredObjects: 0,
          retainedStoredObjects: 0,
          storageCandidates: 0
        };
      } catch {
        return {
          clearedStorageReferences: 0,
          deletedStoredObjects: 0,
          failedStoredObjects: 1,
          retainedStoredObjects: 0,
          storageCandidates: 0
        };
      }
    }
  );

  for (const result of results) {
    summary.clearedStorageReferences += result.clearedStorageReferences;
    summary.deletedStoredObjects += result.deletedStoredObjects;
    summary.failedStoredObjects += result.failedStoredObjects;
    summary.retainedStoredObjects += result.retainedStoredObjects;
  }

  return summary;
}

interface StorageDeletionSummary {
  clearedStorageReferences: number;
  deletedStoredObjects: number;
  failedStoredObjects: number;
  retainedStoredObjects: number;
  storageCandidates: number;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        results.push(await worker(item));
      }
    })
  );

  return results;
}

async function deleteStoredAudioObject(audioStorage: AudioStorage, storagePath: string) {
  if (storageObjectLocation(storagePath) === "r2") {
    if (audioStorageDriver() !== "r2") {
      throw new Error("R2 storage is not configured for this server.");
    }

    await audioStorage.deleteOriginal(storagePath);
    return;
  }

  await rm(storagePath, { force: true });
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

function audioStorageDriver(): "r2" | "local" {
  const driver = process.env.BROADSIDE_AUDIO_STORAGE_DRIVER ?? (process.env.R2_BUCKET ? "r2" : "local");

  return driver === "r2" ? "r2" : "local";
}

async function serializeStorageObject(audioStorage: AudioStorage, object: StorageObjectSummary) {
  const stat = await statStoredAudioObject(audioStorage, object.storagePath);

  return {
    storagePath: object.storagePath,
    location: storageObjectLocation(object.storagePath),
    songCount: object.songCount,
    activeSongCount: object.activeSongCount,
    sizeBytes: stat?.sizeBytes ?? 0,
    declaredSizeBytes: object.sizeBytes,
    exists: Boolean(stat),
    mimeType: object.mimeType,
    ownerEmails: object.ownerEmails,
    sampleTitle: object.sampleTitle,
    earliestCreatedAt: object.earliestCreatedAt.toISOString(),
    latestUpdatedAt: object.latestUpdatedAt.toISOString()
  };
}

async function statStoredAudioObject(audioStorage: AudioStorage, storagePath: string) {
  try {
    if (storageObjectLocation(storagePath) === "r2") {
      if (audioStorageDriver() !== "r2" || !audioStorage.statOriginal) {
        return null;
      }

      return audioStorage.statOriginal(storagePath);
    }

    return { sizeBytes: (await stat(storagePath)).size };
  } catch {
    return null;
  }
}

function storageObjectLocation(storagePath: string): "r2" | "local" {
  return storagePath.startsWith("r2://") ? "r2" : "local";
}

function serializePlaybackState(playbackState: PlaybackState) {
  return {
    userId: playbackState.userId,
    songId: playbackState.songId,
    positionMs: playbackState.positionMs,
    shuffleEnabled: playbackState.shuffleEnabled,
    repeatMode: playbackState.repeatMode,
    updatedAt: playbackState.updatedAt?.toISOString() ?? null
  };
}

function messageForValidationError(error: AudioImportValidationError) {
  switch (error) {
    case "audio_file_too_large":
      return "Audio file exceeds the configured maximum size.";
    case "missing_audio_metadata":
      return "Audio file metadata is required.";
    case "unsupported_audio_type":
      return "Audio file type is not supported.";
    case "missing_audio_content":
      return "Audio content is required.";
  }
}

function sendSongError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      details: {},
      requestId: reply.request.id
    }
  });
}
