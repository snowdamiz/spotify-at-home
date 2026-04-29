import { createHash } from "node:crypto";
import {
  pickPlaylistColor,
  validateAudioImportMetadata,
  type ExternalDiscoveryResult,
  type ImportPolicyMode
} from "@broadside/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomToken } from "../auth/crypto.js";
import { readAccessToken } from "../auth/routes.js";
import { AuthError, type AuthService, type PublicUser } from "../auth/service.js";
import type { SQLitePlaylistRepository, SQLiteSongRepository, Song } from "../db/index.js";
import {
  assertExternalImportAllowed,
  ImportPolicyError,
  readImportPolicyRuntimeConfig,
  resolveImportPolicyStatus,
  type ImportPolicyRuntimeConfig
} from "../import-policy/policy.js";
import {
  YouTubeDiscoveryError,
  YouTubeDiscoveryProvider,
  type YouTubeDiscoveryClient
} from "../external-discovery/youtube.js";
import {
  createAudioImportProcessorFromEnv,
  type AudioImportProcessor,
  type ProcessedAudioImport
} from "../songs/audio-processing.js";
import { createAudioStorageFromEnv, type AudioStorage } from "../songs/storage.js";
import type { LibraryEventSink } from "../library/events.js";
import {
  YtDlpYouTubeImportAdapter,
  YouTubeImportAdapterError,
  type YouTubeImportAdapter
} from "../external-imports/youtubeAdapter.js";
import {
  CsvImportParseError,
  parseCsvImportFile,
  type CsvImportFileInput,
  type ParsedCsvPlaylist,
  type ParsedCsvTrack
} from "./parser.js";
import type {
  SQLiteCsvImportRepository,
  CsvImportBatch,
  CsvImportItem,
  CsvImportItemInput,
  CsvPlaylistTarget
} from "./repositories.js";
import {
  CsvYouTubeMatchError,
  findBestCsvYouTubeMatch
} from "./youtubeMatcher.js";

export interface CsvImportRoutesOptions {
  authService: AuthService;
  bodyLimitBytes?: number;
  csvImportRepository: SQLiteCsvImportRepository;
  playlistRepository: SQLitePlaylistRepository;
  songRepository: SQLiteSongRepository;
  audioStorage?: AudioStorage;
  audioProcessor?: AudioImportProcessor;
  csvImportConcurrency?: number;
  csvYouTubeSearchIntervalMs?: number;
  importPolicyConfig?: ImportPolicyRuntimeConfig;
  libraryEvents?: LibraryEventSink;
  processImportsInline?: boolean;
  recoverableFailurePauseThreshold?: number;
  recoverableSearchAttempts?: number;
  recoverableSearchRetryDelayMs?: number;
  storageRoot?: string;
  youtubeImportAdapter?: YouTubeImportAdapter;
  youtubeProvider?: YouTubeDiscoveryClient;
}

const DEFAULT_CSV_IMPORT_BODY_LIMIT_BYTES = 25 * 1024 * 1024;
const DEFAULT_CSV_IMPORT_CONCURRENCY = 3;
const DEFAULT_CSV_UPLOAD_CHUNK_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_CSV_YOUTUBE_SEARCH_INTERVAL_MS = 500;
const DEFAULT_RECOVERABLE_FAILURE_PAUSE_THRESHOLD = 3;
const DEFAULT_RECOVERABLE_SEARCH_ATTEMPTS = 2;
const DEFAULT_RECOVERABLE_SEARCH_RETRY_DELAY_MS = 1500;
const CSV_UPLOAD_SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const RECOVERABLE_SEARCH_ERROR_CODES = [
  "youtube_search_parse_failed",
  "youtube_search_unavailable"
] as const;
const AUTO_RETRYABLE_CSV_IMPORT_ERROR_CODES = [
  "audio_processing_failed",
  "csv_import_canceled",
  "csv_import_failed",
  "external_audio_download_failed",
  "youtube_match_low_confidence",
  "youtube_search_parse_failed",
  "youtube_search_unavailable"
] as const;
const USER_MATCH_CSV_IMPORT_ERROR_CODES = ["youtube_match_low_confidence"] as const;

export function registerCsvImportRoutes(app: FastifyInstance, options: CsvImportRoutesOptions) {
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_CSV_IMPORT_BODY_LIMIT_BYTES;
  const uploadChunkBodyLimit = Math.min(bodyLimit, DEFAULT_CSV_UPLOAD_CHUNK_BODY_LIMIT_BYTES);
  const uploadStore = new CsvUploadSessionStore();
  const youtubeProvider = options.youtubeProvider ?? new YouTubeDiscoveryProvider();
  const youtubeImportAdapter = options.youtubeImportAdapter ?? new YtDlpYouTubeImportAdapter();
  const audioStorage =
    options.audioStorage ??
    createAudioStorageFromEnv({ storageRoot: options.storageRoot });
  const audioProcessor = options.audioProcessor ?? createAudioImportProcessorFromEnv();
  const importPolicyConfig = options.importPolicyConfig ?? readImportPolicyRuntimeConfig();
  const worker = new CsvImportQueue({
    app,
    audioProcessor,
    audioStorage,
    csvImportRepository: options.csvImportRepository,
    csvImportConcurrency: normalizePositiveInteger(
      options.csvImportConcurrency,
      DEFAULT_CSV_IMPORT_CONCURRENCY
    ),
    csvYouTubeSearchIntervalMs: normalizeNonNegativeInteger(
      options.csvYouTubeSearchIntervalMs,
      DEFAULT_CSV_YOUTUBE_SEARCH_INTERVAL_MS
    ),
    importPolicyConfig,
    libraryEvents: options.libraryEvents,
    playlistRepository: options.playlistRepository,
    processInline: options.processImportsInline ?? false,
    recoverableFailurePauseThreshold: normalizePositiveInteger(
      options.recoverableFailurePauseThreshold,
      DEFAULT_RECOVERABLE_FAILURE_PAUSE_THRESHOLD
    ),
    recoverableSearchAttempts: normalizePositiveInteger(
      options.recoverableSearchAttempts,
      DEFAULT_RECOVERABLE_SEARCH_ATTEMPTS
    ),
    recoverableSearchRetryDelayMs: normalizeNonNegativeInteger(
      options.recoverableSearchRetryDelayMs,
      DEFAULT_RECOVERABLE_SEARCH_RETRY_DELAY_MS
    ),
    songRepository: options.songRepository,
    youtubeImportAdapter,
    youtubeProvider
  });
  const interruptedImports = options.csvImportRepository.pauseInterruptedRunningImports();

  if (interruptedImports.batchesPaused > 0 || interruptedImports.itemsReset > 0) {
    app.log.warn({
      event: "csv_import_interrupted_batches_paused",
      ...interruptedImports
    });
  }

  app.post("/api/csv-imports/uploads", { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    uploadStore.purgeExpired();

    try {
      const upload = uploadStore.create({
        fileName: csvUploadFileNameFromBody(request.body),
        userId: user.id
      });

      return { upload: serializeCsvUpload(upload) };
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        return sendCsvImportError(reply, error.code, error.message, 400);
      }

      throw error;
    }
  });

  app.post(
    "/api/csv-imports/uploads/:id/chunks",
    { bodyLimit: uploadChunkBodyLimit },
    async (request, reply) => {
      const user = await authenticate(request, reply, options.authService);

      if (!user) {
        return;
      }

      uploadStore.purgeExpired();

      try {
        const upload = uploadStore.appendChunk({
          chunk: csvUploadChunkFromBody(request.body),
          chunkIndex: csvUploadChunkIndexFromBody(request.body),
          uploadId: String((request.params as { id?: string }).id ?? ""),
          userId: user.id
        });

        return { upload: serializeCsvUpload(upload) };
      } catch (error) {
        if (error instanceof CsvImportParseError) {
          return sendCsvImportError(reply, error.code, error.message, 400);
        }

        throw error;
      }
    }
  );

  app.post("/api/csv-imports/preview", { bodyLimit }, async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    try {
      const playlists = csvFilesFromBody(request.body, uploadStore, user.id).map(parseCsvImportFile);

      return {
        csvImport: {
          files: playlists.map(serializeParsedPlaylist),
          totalTracks: playlists.reduce((total, playlist) => total + playlist.tracks.length, 0)
        }
      };
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        return sendCsvImportError(reply, error.code, error.message, 400);
      }

      throw error;
    }
  });

  app.post("/api/csv-imports/batches", { bodyLimit }, async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    let parsedPlaylists: ParsedCsvPlaylist[];

    try {
      parsedPlaylists = csvFilesFromBody(request.body, uploadStore, user.id).map(parseCsvImportFile);
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        return sendCsvImportError(reply, error.code, error.message, 400);
      }

      throw error;
    }

    const batchItems = createBatchItemsFromPlaylists({
      parsedPlaylists,
      playlistRepository: options.playlistRepository,
      userId: user.id
    });

    if (batchItems.length === 0) {
      return sendCsvImportError(
        reply,
        "csv_import_selection_empty",
        "No importable tracks were found in the uploaded CSV files.",
        400
      );
    }

    const importPolicy = resolveImportPolicyStatus(user, importPolicyConfig);
    const batch = options.csvImportRepository.createImportBatch({
      importPolicyMode: importPolicy.mode,
      items: batchItems,
      userId: user.id
    });

    uploadStore.deleteMany(user.id, csvUploadIdsFromBody(request.body));
    await worker.enqueue(user, batch.id);

    return reply.code(202).send({
      batch: serializeImportBatch(
        options.csvImportRepository.findImportBatchForUser({
          batchId: batch.id,
          userId: user.id
        }) ?? batch
      )
    });
  });

  app.get("/api/csv-imports/batches/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const batchId = String((request.params as { id?: string }).id ?? "");
    const batch = options.csvImportRepository.findImportBatchForUser({
      batchId,
      userId: user.id
    });

    if (!batch) {
      return sendCsvImportError(reply, "csv_import_batch_not_found", "Import batch not found.", 404);
    }

    return {
      batch: serializeImportBatch(batch),
      items: options.csvImportRepository
        .listImportItemsForBatch({ batchId, userId: user.id })
        .map(serializeImportItem)
    };
  });

  app.post("/api/csv-imports/batches/:id/cancel", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const batchId = String((request.params as { id?: string }).id ?? "");
    const batch = worker.cancel(user, batchId);

    if (!batch) {
      return sendCsvImportError(reply, "csv_import_batch_not_found", "Import batch not found.", 404);
    }

    return {
      batch: serializeImportBatch(batch),
      items: options.csvImportRepository
        .listImportItemsForBatch({ batchId, userId: user.id })
        .map(serializeImportItem)
    };
  });

  app.post("/api/csv-imports/batches/:id/retry", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const batchId = String((request.params as { id?: string }).id ?? "");
    const batch = options.csvImportRepository.findImportBatchForUser({
      batchId,
      userId: user.id
    });

    if (!batch) {
      return sendCsvImportError(reply, "csv_import_batch_not_found", "Import batch not found.", 404);
    }

    const retry = options.csvImportRepository.resetFailedItemsForRetry({
      batchId,
      errorCodes: [...AUTO_RETRYABLE_CSV_IMPORT_ERROR_CODES],
      userId: user.id
    });
    const interruptedRetry = worker.isActive(batchId)
      ? { batch: retry.batch, retriedItems: 0 }
      : options.csvImportRepository.resetInterruptedItemsForRetry({
          batchId,
          userId: user.id
        });
    const pendingItems = options.csvImportRepository.listPendingImportItems({
      batchId,
      userId: user.id
    });

    if (retry.retriedItems > 0 || interruptedRetry.retriedItems > 0 || pendingItems.length > 0) {
      await worker.enqueue(user, batchId);
    }

    return {
      batch: serializeImportBatch(
        options.csvImportRepository.findImportBatchForUser({ batchId, userId: user.id }) ??
          interruptedRetry.batch ??
          retry.batch ??
          batch
      ),
      items: options.csvImportRepository
        .listImportItemsForBatch({ batchId, userId: user.id })
        .map(serializeImportItem),
      retriedItems: retry.retriedItems + interruptedRetry.retriedItems
    };
  });

  app.post("/api/csv-imports/batches/:id/items/:itemId/import", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const params = request.params as { id?: string; itemId?: string };
    const batchId = String(params.id ?? "");
    const itemId = String(params.itemId ?? "");
    const batch = options.csvImportRepository.findImportBatchForUser({
      batchId,
      userId: user.id
    });

    if (!batch) {
      return sendCsvImportError(reply, "csv_import_batch_not_found", "Import batch not found.", 404);
    }

    const item = options.csvImportRepository.findImportItemForUser({
      batchId,
      itemId,
      userId: user.id
    });

    if (!item) {
      return sendCsvImportError(reply, "csv_import_item_not_found", "Import item not found.", 404);
    }

    if (item.status === "completed") {
      return {
        batch: serializeImportBatch(batch),
        item: serializeImportItem(item),
        items: options.csvImportRepository
          .listImportItemsForBatch({ batchId, userId: user.id })
          .map(serializeImportItem)
      };
    }

    if (item.status === "running") {
      return sendCsvImportError(
        reply,
        "csv_import_item_running",
        "This CSV item is already importing.",
        409
      );
    }

    let discovery: ExternalDiscoveryResult;

    try {
      discovery = discoveryFromCsvItemImportPayload(request.body, batch.importPolicyMode);
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        return sendCsvImportError(reply, error.code, error.message, 400);
      }

      throw error;
    }

    options.csvImportRepository.markItemRunning({ itemId: item.id, userId: user.id });

    try {
      const result = await importYouTubeDiscoveryForCsvItem({
        audioProcessor,
        audioStorage,
        discovery,
        importPolicyMode: batch.importPolicyMode,
        item,
        songRepository: options.songRepository,
        user,
        youtubeImportAdapter
      });

      if (item.likeAfterImport) {
        options.songRepository.likeSong({ songId: result.song.id, userId: user.id });
      }

      for (const target of item.playlistTargets) {
        options.playlistRepository.addSong({
          playlistId: target.playlistId,
          position: target.position,
          songId: result.song.id,
          userId: user.id
        });
      }

      options.csvImportRepository.markItemCompleted({
        itemId: item.id,
        songId: result.song.id,
        userId: user.id,
        youtubeSourceId: result.youtubeSourceId
      });

      const refreshedBatch = options.csvImportRepository.refreshBatchCounts({
        batchId,
        userId: user.id
      });
      options.libraryEvents?.emitLibraryChanged(user.id, {
        csvImportBatchId: batchId,
        csvImportItemId: item.id,
        reason: "csv_import_item_completed",
        songId: result.song.id
      });

      return {
        batch: serializeImportBatch(refreshedBatch ?? batch),
        item: serializeImportItem(
          options.csvImportRepository.findImportItemForUser({
            batchId,
            itemId: item.id,
            userId: user.id
          }) ?? item
        ),
        items: options.csvImportRepository
          .listImportItemsForBatch({ batchId, userId: user.id })
          .map(serializeImportItem)
      };
    } catch (error) {
      options.csvImportRepository.markItemFailed({
        errorCode: errorCodeForCsvImport(error),
        errorMessage: messageForError(error),
        itemId: item.id,
        userId: user.id
      });
      options.csvImportRepository.refreshBatchCounts({ batchId, userId: user.id });

      return sendCsvImportError(
        reply,
        errorCodeForCsvImport(error),
        messageForError(error),
        error instanceof ImportPolicyError ? error.statusCode : 500
      );
    }
  });
}

class CsvImportQueue {
  private readonly queuedBatches = new Map<string, PublicUser>();
  private readonly canceledBatches = new Set<string>();
  private activeBatchId: string | null = null;
  private csvYouTubeSearchGate: Promise<void> = Promise.resolve();
  private drainScheduled = false;
  private lastCsvYouTubeSearchStartedAt = 0;
  private releaseCsvYouTubeSearchGate: (() => void) | null = null;

  constructor(
    private readonly options: {
      app: FastifyInstance;
      audioProcessor: AudioImportProcessor;
      audioStorage: AudioStorage;
      csvImportConcurrency: number;
      csvImportRepository: SQLiteCsvImportRepository;
      csvYouTubeSearchIntervalMs: number;
      importPolicyConfig: ImportPolicyRuntimeConfig;
      libraryEvents?: LibraryEventSink;
      playlistRepository: SQLitePlaylistRepository;
      processInline: boolean;
      recoverableFailurePauseThreshold: number;
      recoverableSearchAttempts: number;
      recoverableSearchRetryDelayMs: number;
      songRepository: SQLiteSongRepository;
      youtubeImportAdapter: YouTubeImportAdapter;
      youtubeProvider: YouTubeDiscoveryClient;
    }
  ) {}

  async enqueue(user: PublicUser, batchId: string) {
    if (this.options.processInline) {
      await this.processBatch(user, batchId);
      return;
    }

    if (this.activeBatchId === batchId || this.queuedBatches.has(batchId)) {
      return;
    }

    this.queuedBatches.set(batchId, user);
    this.scheduleDrain();
  }

  isActive(batchId: string) {
    return this.activeBatchId === batchId;
  }

  cancel(user: PublicUser, batchId: string) {
    this.queuedBatches.delete(batchId);

    if (this.activeBatchId === batchId) {
      this.canceledBatches.add(batchId);
    }

    return this.options.csvImportRepository.cancelImportBatch({
      batchId,
      userId: user.id
    });
  }

  private scheduleDrain() {
    if (this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    setTimeout(() => {
      this.drainScheduled = false;
      this.drain().catch((error) => {
        this.options.app.log.error({
          error,
          event: "csv_import_queue_drain_failed"
        });
      });
    }, 0);
  }

  private async drain() {
    if (this.activeBatchId) {
      return;
    }

    while (this.queuedBatches.size > 0) {
      const next = this.queuedBatches.entries().next().value as
        | [string, PublicUser]
        | undefined;

      if (!next) {
        return;
      }

      const [batchId, user] = next;

      this.queuedBatches.delete(batchId);
      this.activeBatchId = batchId;

      try {
        await this.processBatch(user, batchId);
      } catch (error) {
        this.options.app.log.error({
          error,
          event: "csv_import_batch_worker_failed",
          csvImportBatchId: batchId,
          userId: user.id
        });
      } finally {
        this.canceledBatches.delete(batchId);
        this.activeBatchId = null;
      }
    }
  }

  private async processBatch(user: PublicUser, batchId: string) {
    const batch = this.options.csvImportRepository.findImportBatchForUser({
      batchId,
      userId: user.id
    });

    if (!batch) {
      return;
    }

    this.options.csvImportRepository.markBatchRunning({ batchId, userId: user.id });
    let consecutiveRecoverableSearchFailures = 0;
    let pausedAfterRecoverableSearchFailures = false;
    let pauseLogged = false;
    const pendingItems = this.options.csvImportRepository.listPendingImportItems({
      batchId,
      userId: user.id
    });

    for (
      let index = 0;
      index < pendingItems.length &&
      !this.canceledBatches.has(batchId) &&
      !pausedAfterRecoverableSearchFailures;
      index += this.options.csvImportConcurrency
    ) {
      const items = pendingItems.slice(index, index + this.options.csvImportConcurrency);

      await Promise.all(items.map(async (item) => {
        if (this.canceledBatches.has(batchId) || pausedAfterRecoverableSearchFailures) {
          return;
        }

        const freshItem = this.options.csvImportRepository.findImportItemForUser({
          batchId,
          itemId: item.id,
          userId: user.id
        });

        if (!freshItem || freshItem.status !== "pending") {
          return;
        }

        await this.processPendingItem({
          batch,
          batchId,
          item: freshItem,
          onRecoverableSearchFailure: () => {
            consecutiveRecoverableSearchFailures += 1;

            if (
              consecutiveRecoverableSearchFailures >=
              this.options.recoverableFailurePauseThreshold
            ) {
              pausedAfterRecoverableSearchFailures = true;

              if (!pauseLogged) {
                pauseLogged = true;
                this.options.app.log.warn({
                  csvImportBatchId: batchId,
                  event: "csv_import_paused_after_recoverable_search_failures",
                  failureThreshold: this.options.recoverableFailurePauseThreshold,
                  userId: user.id
                });
              }
            }
          },
          onSearchFailureReset: () => {
            consecutiveRecoverableSearchFailures = 0;
          },
          user
        });
      }));
    }

    if (pausedAfterRecoverableSearchFailures && !this.canceledBatches.has(batchId)) {
      this.options.csvImportRepository.markBatchFailedRetainingPending({
        batchId,
        userId: user.id
      });
      return;
    }

    this.options.csvImportRepository.refreshBatchCounts({ batchId, userId: user.id });
  }

  private async processPendingItem(input: {
    batch: CsvImportBatch;
    batchId: string;
    item: CsvImportItem;
    onRecoverableSearchFailure: () => void;
    onSearchFailureReset: () => void;
    user: PublicUser;
  }) {
    this.options.csvImportRepository.markItemRunning({
      itemId: input.item.id,
      userId: input.user.id
    });

    try {
      const result = await this.processItemWithRecoverableRetries(
        input.user,
        input.batch,
        input.item,
        () => !this.canceledBatches.has(input.batchId)
      );
      input.onSearchFailureReset();

      this.options.csvImportRepository.markItemCompleted({
        itemId: input.item.id,
        songId: result.song.id,
        userId: input.user.id,
        youtubeSourceId: result.youtubeSourceId
      });
      this.options.libraryEvents?.emitLibraryChanged(input.user.id, {
        csvImportBatchId: input.batchId,
        csvImportItemId: input.item.id,
        reason: "csv_import_item_completed",
        songId: result.song.id
      });
    } catch (error) {
      this.options.csvImportRepository.markItemFailed({
        errorCode: this.canceledBatches.has(input.batchId)
          ? "csv_import_canceled"
          : errorCodeForCsvImport(error),
        errorMessage: this.canceledBatches.has(input.batchId)
          ? "CSV import canceled."
          : messageForError(error),
        itemId: input.item.id,
        userId: input.user.id
      });

      const errorCode = this.canceledBatches.has(input.batchId)
        ? "csv_import_canceled"
        : errorCodeForCsvImport(error);

      if (isRecoverableSearchErrorCode(errorCode)) {
        input.onRecoverableSearchFailure();
        this.options.csvImportRepository.refreshBatchCounts({
          batchId: input.batchId,
          userId: input.user.id
        });
        return;
      }

      input.onSearchFailureReset();
    }

    this.options.csvImportRepository.refreshBatchCounts({
      batchId: input.batchId,
      userId: input.user.id
    });
  }

  private async processItemWithRecoverableRetries(
    user: PublicUser,
    batch: CsvImportBatch,
    item: CsvImportItem,
    shouldContinue: () => boolean
  ) {
    let attempt = 1;

    while (true) {
      try {
        return await this.processItem(user, batch, item, shouldContinue);
      } catch (error) {
        if (
          !shouldContinue() ||
          !isRecoverableSearchErrorCode(errorCodeForCsvImport(error)) ||
          attempt >= this.options.recoverableSearchAttempts
        ) {
          throw error;
        }

        await wait(this.options.recoverableSearchRetryDelayMs * attempt);
        attempt += 1;
      }
    }
  }

  private async processItem(
    user: PublicUser,
    batch: CsvImportBatch,
    item: CsvImportItem,
    shouldContinue: () => boolean = () => true
  ) {
    if (!this.options.youtubeProvider.search) {
      throw new CsvImportWorkerError("youtube_search_unavailable", "YouTube search is unavailable.");
    }

    const match = await findBestCsvYouTubeMatch({
      afterSearch: () => this.releaseCsvYouTubeSearchSlot(),
      beforeSearch: () => this.acquireCsvYouTubeSearchSlot(shouldContinue),
      importPolicyMode: batch.importPolicyMode,
      item,
      maxSearchQueries: 2,
      shouldContinue,
      youtubeProvider: this.options.youtubeProvider
    });
    const discovery = match.discovery;

    if (!shouldContinue()) {
      throw new CsvImportWorkerError("csv_import_canceled", "CSV import canceled.");
    }

    assertExternalImportAllowed({
      config: this.options.importPolicyConfig,
      discovery,
      sourcePolicies: this.options.songRepository.listEnabledSourcePolicies("youtube"),
      user
    });

    if (!shouldContinue()) {
      throw new CsvImportWorkerError("csv_import_canceled", "CSV import canceled.");
    }

    const imported = await importYouTubeDiscoveryForCsvItem({
      audioProcessor: this.options.audioProcessor,
      audioStorage: this.options.audioStorage,
      discovery,
      importPolicyMode: batch.importPolicyMode,
      item,
      songRepository: this.options.songRepository,
      user,
      youtubeImportAdapter: this.options.youtubeImportAdapter
    });

    if (item.likeAfterImport) {
      this.options.songRepository.likeSong({ songId: imported.song.id, userId: user.id });
    }

    for (const target of item.playlistTargets) {
      this.options.playlistRepository.addSong({
        playlistId: target.playlistId,
        position: target.position,
        songId: imported.song.id,
        userId: user.id
      });
    }

    return imported;
  }

  private async acquireCsvYouTubeSearchSlot(shouldContinue: () => boolean) {
    let releaseQueuedSearch!: () => void;
    const previousGate = this.csvYouTubeSearchGate;
    const nextGate = new Promise<void>((resolve) => {
      releaseQueuedSearch = resolve;
    });

    this.csvYouTubeSearchGate = previousGate.then(() => nextGate);
    await previousGate;

    try {
      if (!shouldContinue()) {
        throw new CsvImportWorkerError("csv_import_canceled", "CSV import canceled.");
      }

      const elapsedMs = Date.now() - this.lastCsvYouTubeSearchStartedAt;
      const waitMs =
        this.lastCsvYouTubeSearchStartedAt === 0
          ? 0
          : Math.max(0, this.options.csvYouTubeSearchIntervalMs - elapsedMs);

      if (waitMs > 0) {
        await wait(waitMs);
      }

      if (!shouldContinue()) {
        throw new CsvImportWorkerError("csv_import_canceled", "CSV import canceled.");
      }

      this.lastCsvYouTubeSearchStartedAt = Date.now();
      this.releaseCsvYouTubeSearchGate = releaseQueuedSearch;
    } catch (error) {
      releaseQueuedSearch();
      throw error;
    }
  }

  private releaseCsvYouTubeSearchSlot() {
    const release = this.releaseCsvYouTubeSearchGate;

    if (!release) {
      return;
    }

    this.releaseCsvYouTubeSearchGate = null;
    release();
  }
}

async function importYouTubeDiscoveryForCsvItem(input: {
  audioProcessor: AudioImportProcessor;
  audioStorage: AudioStorage;
  discovery: ExternalDiscoveryResult;
  importPolicyMode: ImportPolicyMode;
  item: CsvImportItem;
  songRepository: SQLiteSongRepository;
  user: PublicUser;
  youtubeImportAdapter: YouTubeImportAdapter;
}) {
  const duplicate = input.songRepository.findReadySongByExternalSourceForUser({
    provider: "youtube",
    sourceId: input.discovery.sourceId,
    userId: input.user.id
  });

  if (duplicate) {
    return {
      song: duplicate.song,
      youtubeSourceId: input.discovery.sourceId
    };
  }

  const reusable = input.songRepository.findReadySongByExternalSource({
    provider: "youtube",
    sourceId: input.discovery.sourceId
  });

  if (reusable) {
    const reused = await createCsvSongFromReusableExternalAudio({
      audioStorage: input.audioStorage,
      discovery: input.discovery,
      importPolicyMode: input.importPolicyMode,
      item: input.item,
      reusableSong: reusable.song,
      songRepository: input.songRepository,
      user: input.user
    });

    if (reused) {
      return {
        song: reused,
        youtubeSourceId: input.discovery.sourceId
      };
    }
  }

  const songId = randomToken(16);
  const expectedStoragePath =
    input.audioStorage.resolveSharedOriginalPath?.({
      provider: "youtube",
      sourceId: input.discovery.sourceId
    }) ??
    input.audioStorage.resolveOriginalPath?.({ songId, userId: input.user.id }) ??
    "";
  let song: Song | null = null;
  let storedPath: string | null = null;

  try {
    song = input.songRepository.createSong({
      album: input.item.album,
      artist: input.item.artist,
      checksum: "",
      durationMs: input.item.durationMs ?? input.discovery.durationMs,
      id: songId,
      importStatus: "pending",
      mimeType: "audio/mpeg",
      sizeBytes: 0,
      storagePath: expectedStoragePath,
      title: input.item.title,
      userId: input.user.id
    });
    const source = input.songRepository.createExternalSource({
      canonicalUrl: input.discovery.canonicalUrl,
      importPolicyMode: input.importPolicyMode,
      originalTitle: input.discovery.title,
      originalUploader: input.discovery.creator,
      provider: "youtube",
      provenance: csvProvenance(input.item, input.discovery, {
        selectedImportPath: "pending_adapter_resolution"
      }),
      songId: song.id,
      sourceId: input.discovery.sourceId,
      thumbnailUrl: input.item.artworkUrl ?? input.discovery.thumbnailUrl,
      userId: input.user.id
    });
    const job = input.songRepository.createImportJob({
      importPolicyMode: input.importPolicyMode,
      provenance: {
        csvFileName: input.item.fileName,
        provider: "youtube",
        searchSource: "csv_metadata",
        sourceId: input.discovery.sourceId,
        sourceKey: input.item.sourceKey
      },
      songId: song.id,
      sourceId: source.id,
      status: "pending",
      userId: input.user.id
    });
    const resolved = await input.youtubeImportAdapter.resolve({ discovery: input.discovery });
    const validationError = validateAudioImportMetadata({
      fileName: resolved.fileName,
      mimeType: resolved.mimeType,
      sizeBytes: resolved.content.byteLength
    });

    if (validationError) {
      throw new CsvImportWorkerError(validationError, validationError);
    }

    let processedAudio: ProcessedAudioImport;

    try {
      processedAudio = await input.audioProcessor.process({
        content: resolved.content,
        durationMs: resolved.durationMs,
        fileName: resolved.fileName,
        mimeType: resolved.mimeType
      });
    } catch {
      throw new CsvImportWorkerError(
        "audio_processing_failed",
        "Audio file could not be normalized."
      );
    }

    const processedValidationError = validateAudioImportMetadata({
      fileName: processedAudio.fileName,
      mimeType: processedAudio.mimeType,
      sizeBytes: processedAudio.content.byteLength
    });

    if (processedValidationError) {
      throw new CsvImportWorkerError(processedValidationError, processedValidationError);
    }

    input.songRepository.updateExternalSourceProvenance({
      provenance: csvProvenance(input.item, input.discovery, {
        ...resolved.provenance,
        ...processedAudio.provenance,
        selectedImportPath: resolved.adapter
      }),
      sourceId: source.id,
      userId: input.user.id
    });
    input.songRepository.updateImportJobProvenance({
      jobId: job.id,
      provenance: {
        adapter: resolved.adapter,
        csvFileName: input.item.fileName,
        provider: "youtube",
        searchSource: "csv_metadata",
        sourceId: input.discovery.sourceId,
        sourceKey: input.item.sourceKey,
        ...resolved.provenance,
        ...processedAudio.provenance
      },
      userId: input.user.id
    });

    storedPath = input.audioStorage.writeSharedOriginal
      ? await input.audioStorage.writeSharedOriginal({
          content: processedAudio.content,
          provider: "youtube",
          sourceId: input.discovery.sourceId
        })
      : await input.audioStorage.writeOriginal({
          content: processedAudio.content,
          songId: song.id,
          userId: input.user.id
        });

    input.songRepository.markSongReady({
      checksum: `sha256:${createHash("sha256").update(processedAudio.content).digest("hex")}`,
      durationMs: processedAudio.durationMs ?? input.item.durationMs,
      mimeType: processedAudio.mimeType,
      sizeBytes: processedAudio.content.byteLength,
      songId: song.id,
      storagePath: storedPath,
      userId: input.user.id
    });

    return {
      song: input.songRepository.findSongForUser(input.user.id, song.id) ?? song,
      youtubeSourceId: input.discovery.sourceId
    };
  } catch (error) {
    if (storedPath) {
      await deleteStoredAudioIfUnreferenced(input.songRepository, input.audioStorage, storedPath, song?.id);
    }

    if (song) {
      input.songRepository.markSongImportFailed({
        errorCode: errorCodeForCsvImport(error),
        songId: song.id,
        userId: input.user.id
      });
    }

    throw error;
  }
}

async function createCsvSongFromReusableExternalAudio(input: {
  audioStorage: AudioStorage;
  discovery: ExternalDiscoveryResult;
  importPolicyMode: ImportPolicyMode;
  item: CsvImportItem;
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
    album: input.item.album,
    artist: input.item.artist,
    checksum: input.reusableSong.checksum,
    durationMs: input.item.durationMs ?? input.discovery.durationMs ?? input.reusableSong.durationMs,
    id: randomToken(16),
    importStatus: "ready",
    mimeType: input.reusableSong.mimeType,
    sizeBytes: input.reusableSong.sizeBytes,
    storagePath: input.reusableSong.storagePath,
    title: input.item.title,
    userId: input.user.id
  });
  const source = input.songRepository.createExternalSource({
    canonicalUrl: input.discovery.canonicalUrl,
    importPolicyMode: input.importPolicyMode,
    originalTitle: input.discovery.title,
    originalUploader: input.discovery.creator,
    provider: "youtube",
    provenance: csvProvenance(input.item, input.discovery, {
      selectedImportPath: "shared_artifact_reuse"
    }),
    songId: song.id,
    sourceId: input.discovery.sourceId,
    thumbnailUrl: input.item.artworkUrl ?? input.discovery.thumbnailUrl,
    userId: input.user.id
  });

  input.songRepository.createImportJob({
    importPolicyMode: input.importPolicyMode,
    provenance: {
      adapter: "shared_artifact_reuse",
      csvFileName: input.item.fileName,
      provider: "youtube",
      searchSource: "csv_metadata",
      sourceId: input.discovery.sourceId,
      sourceKey: input.item.sourceKey
    },
    songId: song.id,
    sourceId: source.id,
    status: "ready",
    userId: input.user.id
  });

  return input.songRepository.findSongForUser(input.user.id, song.id) ?? song;
}

function createBatchItemsFromPlaylists(input: {
  parsedPlaylists: ParsedCsvPlaylist[];
  playlistRepository: SQLitePlaylistRepository;
  userId: string;
}) {
  const itemsBySourceKey = new Map<string, CsvImportItemInput>();

  for (const playlist of input.parsedPlaylists) {
    if (playlist.tracks.length === 0) {
      continue;
    }

    const createdPlaylist = input.playlistRepository.createPlaylist({
      color: pickPlaylistColor(playlist.playlistName),
      description: `Imported from ${playlist.fileName}`,
      name: playlist.playlistName,
      userId: input.userId
    });
    const likeAfterImport = isLikedPlaylistName(playlist.playlistName);

    playlist.tracks.forEach((track, index) => {
      const existing = itemsBySourceKey.get(track.sourceKey);
      const target: CsvPlaylistTarget = {
        playlistId: createdPlaylist.id,
        playlistName: createdPlaylist.name,
        position: index
      };

      if (existing) {
        existing.likeAfterImport = existing.likeAfterImport || likeAfterImport;
        existing.playlistTargets.push(target);
        return;
      }

      itemsBySourceKey.set(track.sourceKey, {
        album: track.album,
        artist: track.artist,
        artworkUrl: track.artworkUrl,
        durationMs: track.durationMs,
        fileName: playlist.fileName,
        isrc: track.isrc,
        likeAfterImport,
        playlistName: playlist.playlistName,
        playlistTargets: [target],
        searchQuery: searchQueryForCsvTrack(track),
        sourceKey: track.sourceKey,
        sourceUrl: track.sourceUrl,
        title: track.title
      });
    });
  }

  return [...itemsBySourceKey.values()];
}

function csvProvenance(
  item: CsvImportItem,
  discovery: ExternalDiscoveryResult,
  extra: Record<string, unknown>
) {
  return {
    csv: {
      album: item.album,
      artist: item.artist,
      durationMs: item.durationMs,
      fileName: item.fileName,
      isrc: item.isrc,
      playlistName: item.playlistName,
      sourceKey: item.sourceKey,
      sourceUrl: item.sourceUrl,
      title: item.title
    },
    searchSource: "csv_metadata",
    youtube: {
      canonicalUrl: discovery.canonicalUrl,
      creator: discovery.creator,
      sourceId: discovery.sourceId,
      title: discovery.title
    },
    ...extra
  };
}

async function deleteStoredAudioIfUnreferenced(
  songRepository: SQLiteSongRepository,
  audioStorage: AudioStorage,
  storagePath: string,
  exceptSongId?: string
) {
  if (songRepository.countSongsByStoragePath({ exceptSongId, storagePath }) === 0) {
    await audioStorage.deleteOriginal(storagePath);
  }
}

async function statStoredAudio(audioStorage: AudioStorage, storagePath: string) {
  if (audioStorage.statOriginal) {
    return audioStorage.statOriginal(storagePath);
  }

  const { stat } = await import("node:fs/promises");

  return { sizeBytes: (await stat(storagePath)).size };
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
      sendCsvImportError(reply, error.code, error.message, error.statusCode);
      return null;
    }

    throw error;
  }
}

class CsvImportWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

interface CsvUploadSession {
  chunks: Buffer[];
  createdAt: number;
  fileName: string;
  id: string;
  receivedBytes: number;
  updatedAt: number;
  userId: string;
}

class CsvUploadSessionStore {
  private readonly uploads = new Map<string, CsvUploadSession>();

  create(input: { fileName: string; userId: string }) {
    const now = Date.now();
    const upload: CsvUploadSession = {
      chunks: [],
      createdAt: now,
      fileName: input.fileName,
      id: randomToken(16),
      receivedBytes: 0,
      updatedAt: now,
      userId: input.userId
    };

    this.uploads.set(upload.id, upload);

    return upload;
  }

  appendChunk(input: {
    chunk: Buffer;
    chunkIndex: number;
    uploadId: string;
    userId: string;
  }) {
    const upload = this.findForUser(input.userId, input.uploadId);

    if (!upload) {
      throw new CsvImportParseError("csv_import_upload_not_found", "CSV upload not found.");
    }

    if (input.chunkIndex !== upload.chunks.length) {
      throw new CsvImportParseError(
        "csv_import_upload_chunk_out_of_order",
        "CSV upload chunks must arrive in order."
      );
    }

    if (input.chunk.byteLength === 0) {
      throw new CsvImportParseError("csv_import_upload_chunk_empty", "CSV upload chunk is empty.");
    }

    upload.chunks.push(input.chunk);
    upload.receivedBytes += input.chunk.byteLength;
    upload.updatedAt = Date.now();

    return upload;
  }

  readFile(input: { uploadId: string; userId: string }): CsvImportFileInput {
    const upload = this.findForUser(input.userId, input.uploadId);

    if (!upload) {
      throw new CsvImportParseError("csv_import_upload_not_found", "CSV upload not found.");
    }

    return {
      content: Buffer.concat(upload.chunks, upload.receivedBytes).toString("utf8"),
      fileName: upload.fileName
    };
  }

  deleteMany(userId: string, uploadIds: string[]) {
    for (const uploadId of uploadIds) {
      const upload = this.uploads.get(uploadId);

      if (upload?.userId === userId) {
        this.uploads.delete(uploadId);
      }
    }
  }

  purgeExpired(now = Date.now()) {
    for (const [uploadId, upload] of this.uploads) {
      if (now - upload.updatedAt > CSV_UPLOAD_SESSION_MAX_AGE_MS) {
        this.uploads.delete(uploadId);
      }
    }
  }

  private findForUser(userId: string, uploadId: string) {
    const upload = this.uploads.get(uploadId);

    return upload?.userId === userId ? upload : null;
  }
}

function csvFilesFromBody(
  body: unknown,
  uploadStore: CsvUploadSessionStore,
  userId: string
): CsvImportFileInput[] {
  const files = asRecord(body).files;
  const directFiles = Array.isArray(files)
    ? files.map((file) => {
        const record = asRecord(file);
        const fileName = typeof record.fileName === "string" ? record.fileName : "";

        if (!fileName.trim()) {
          throw new CsvImportParseError("csv_import_file_name_missing", "CSV file name is required.");
        }

        return {
          content: typeof record.content === "string" ? record.content : undefined,
          contentBase64: typeof record.contentBase64 === "string" ? record.contentBase64 : undefined,
          fileName
        };
      })
    : [];
  const uploadedFiles = csvUploadIdsFromBody(body).map((uploadId) =>
    uploadStore.readFile({ uploadId, userId })
  );

  if (directFiles.length === 0 && uploadedFiles.length === 0) {
    throw new CsvImportParseError("csv_import_files_missing", "At least one CSV file is required.");
  }

  return [...directFiles, ...uploadedFiles];
}

function serializeParsedPlaylist(playlist: ParsedCsvPlaylist) {
  return {
    fileName: playlist.fileName,
    playlistName: playlist.playlistName,
    trackCount: playlist.tracks.length,
    tracks: playlist.tracks.slice(0, 25),
    warnings: playlist.warnings
  };
}

function serializeImportBatch(batch: CsvImportBatch) {
  return {
    completedAt: batch.completedAt?.toISOString() ?? null,
    completedItems: batch.completedItems,
    createdAt: batch.createdAt.toISOString(),
    failedItems: batch.failedItems,
    id: batch.id,
    importPolicyMode: batch.importPolicyMode,
    startedAt: batch.startedAt?.toISOString() ?? null,
    status: batch.status,
    totalItems: batch.totalItems,
    userId: batch.userId
  };
}

function serializeImportItem(item: CsvImportItem) {
  return {
    album: item.album,
    artist: item.artist,
    autoRetryable: isAutoRetryableCsvImportItem(item),
    batchId: item.batchId,
    createdAt: item.createdAt.toISOString(),
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    fileName: item.fileName,
    id: item.id,
    likeAfterImport: item.likeAfterImport,
    playlistName: item.playlistName,
    playlistTargets: item.playlistTargets,
    searchQuery: normalizeCsvSearchQueryText(item.searchQuery),
    songId: item.songId,
    sourceKey: item.sourceKey,
    status: item.status,
    title: item.title,
    updatedAt: item.updatedAt.toISOString(),
    userId: item.userId,
    userMatchRequired: isUserMatchRequiredCsvImportItem(item),
    youtubeSourceId: item.youtubeSourceId
  };
}

function isAutoRetryableCsvImportItem(item: CsvImportItem) {
  return (
    item.status === "failed" &&
    AUTO_RETRYABLE_CSV_IMPORT_ERROR_CODES.includes(
      item.errorCode as (typeof AUTO_RETRYABLE_CSV_IMPORT_ERROR_CODES)[number]
    )
  );
}

function isUserMatchRequiredCsvImportItem(item: CsvImportItem) {
  return (
    item.status === "failed" &&
    USER_MATCH_CSV_IMPORT_ERROR_CODES.includes(
      item.errorCode as (typeof USER_MATCH_CSV_IMPORT_ERROR_CODES)[number]
    )
  );
}

function serializeCsvUpload(upload: CsvUploadSession) {
  return {
    fileName: upload.fileName,
    id: upload.id,
    receivedBytes: upload.receivedBytes
  };
}

function csvUploadFileNameFromBody(body: unknown) {
  const fileName = asRecord(body).fileName;

  if (typeof fileName !== "string" || !fileName.trim()) {
    throw new CsvImportParseError("csv_import_file_name_missing", "CSV file name is required.");
  }

  return fileName;
}

function csvUploadChunkIndexFromBody(body: unknown) {
  const chunkIndex = asRecord(body).chunkIndex;

  if (!Number.isInteger(chunkIndex) || Number(chunkIndex) < 0) {
    throw new CsvImportParseError(
      "csv_import_upload_chunk_index_invalid",
      "CSV upload chunk index is invalid."
    );
  }

  return Number(chunkIndex);
}

function csvUploadChunkFromBody(body: unknown) {
  const contentBase64 = asRecord(body).contentBase64;

  if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
    throw new CsvImportParseError(
      "csv_import_upload_chunk_missing",
      "CSV upload chunk content is missing."
    );
  }

  return Buffer.from(contentBase64, "base64");
}

function csvUploadIdsFromBody(body: unknown) {
  const uploads = asRecord(body).uploads;

  if (!Array.isArray(uploads)) {
    return [];
  }

  return uploads.map((upload) => {
    if (typeof upload === "string") {
      return upload;
    }

    const id = asRecord(upload).id;

    if (typeof id === "string" && id.trim()) {
      return id;
    }

    throw new CsvImportParseError("csv_import_upload_id_missing", "CSV upload id is required.");
  });
}

function discoveryFromCsvItemImportPayload(
  body: unknown,
  importPolicyMode: ImportPolicyMode
): ExternalDiscoveryResult {
  const discovery = asRecord(asRecord(body).discovery);

  if (
    discovery.provider !== "youtube" ||
    typeof discovery.sourceId !== "string" ||
    typeof discovery.canonicalUrl !== "string" ||
    typeof discovery.title !== "string"
  ) {
    throw new CsvImportParseError(
      "csv_import_manual_match_invalid",
      "Choose a valid YouTube result for this CSV item."
    );
  }

  return {
    canonicalUrl: discovery.canonicalUrl,
    creator: nullableText(discovery.creator),
    description: nullableText(discovery.description),
    durationMs: typeof discovery.durationMs === "number" ? discovery.durationMs : null,
    importPolicyMode,
    provider: "youtube",
    sourceId: discovery.sourceId,
    thumbnailUrl: nullableText(discovery.thumbnailUrl),
    title: discovery.title,
    attributionText: nullableText(discovery.attributionText),
    licenseType: nullableText(discovery.licenseType),
    licenseUrl: nullableText(discovery.licenseUrl)
  };
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorCodeForCsvImport(error: unknown) {
  if (error instanceof CsvImportWorkerError) {
    return error.code;
  }

  if (error instanceof YouTubeDiscoveryError) {
    return error.code;
  }

  if (error instanceof CsvYouTubeMatchError) {
    return error.code;
  }

  if (error instanceof YouTubeImportAdapterError) {
    return error.code;
  }

  if (error instanceof ImportPolicyError) {
    return error.code;
  }

  return "csv_import_failed";
}

function isRecoverableSearchErrorCode(code: string) {
  return RECOVERABLE_SEARCH_ERROR_CODES.includes(
    code as (typeof RECOVERABLE_SEARCH_ERROR_CODES)[number]
  );
}

function messageForError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "CSV import failed.";
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function searchQueryForCsvTrack(track: ParsedCsvTrack) {
  return normalizeCsvSearchQueryText(
    [track.artist, track.title, track.album].filter(Boolean).join(" ")
  );
}

function normalizeCsvSearchQueryText(query: string) {
  return query
    .replace(/\bofficial\s+audio\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikedPlaylistName(name: string) {
  return /(^|\s)(liked|favorites|favourites)(\s|$)/i.test(name);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sendCsvImportError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode: number,
  details: Record<string, unknown> = {}
) {
  return reply.code(statusCode).send({
    error: {
      code,
      details,
      message,
      requestId: reply.request.id
    }
  });
}
