export const APP_NAME = "OnVibe" as const;

// Tailwind gradient classes used to color playlist covers. Kept in shared so
// both the client (CoverArt) and the API (CSV import / create endpoints) draw
// from the same palette and avoid hex/class drift.
export const PLAYLIST_COVER_PALETTE = [
  "from-emerald-500 to-emerald-900",
  "from-sky-600 to-indigo-900",
  "from-rose-500 to-fuchsia-900",
  "from-amber-500 to-rose-900",
  "from-teal-500 to-emerald-900",
  "from-fuchsia-600 to-indigo-900",
  "from-orange-500 to-red-900",
  "from-cyan-500 to-blue-900",
  "from-violet-600 to-purple-900",
  "from-lime-500 to-green-900"
] as const;

export function pickPlaylistColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return PLAYLIST_COVER_PALETTE[
    Math.abs(hash) % PLAYLIST_COVER_PALETTE.length
  ];
}

export const IMPORT_POLICY_MODES = [
  "open_test",
  "review_required",
  "licensed_only"
] as const;

export type ImportPolicyMode = (typeof IMPORT_POLICY_MODES)[number];

export const EXTERNAL_SOURCE_PROVIDERS = ["youtube"] as const;

export type ExternalSourceProvider = (typeof EXTERNAL_SOURCE_PROVIDERS)[number];

export const IMPORT_ELIGIBILITY_STATES = [
  "importable",
  "review_required",
  "preview_only",
  "blocked"
] as const;

export type ImportEligibilityState = (typeof IMPORT_ELIGIBILITY_STATES)[number];

export interface ImportPolicyModeCopy {
  badge: string;
  description: string;
  label: string;
}

export interface ImportEligibility {
  state: ImportEligibilityState;
  reasonCode: string;
  message: string;
}

export type ExternalAudioReuseState =
  | "already_in_library"
  | "stored_audio_available";

export type ExternalAudioStorageLocation = "local" | "r2";

export interface ExternalAudioReuse {
  state: ExternalAudioReuseState;
  storageLocation: ExternalAudioStorageLocation;
  songId: string | null;
  sizeBytes: number | null;
}

export const IMPORT_POLICY_MODE_COPY: Record<ImportPolicyMode, ImportPolicyModeCopy> = {
  licensed_only: {
    badge: "Licensed only",
    description: "External imports are limited to sources OnVibe has approved for licensed use.",
    label: "Licensed-only imports"
  },
  open_test: {
    badge: "Open test mode",
    description: "Allowlisted testers can import broad external results for private product validation.",
    label: "Open testing imports"
  },
  review_required: {
    badge: "Review required",
    description: "External imports must pass a stricter review or launch policy before they can continue.",
    label: "Reviewed imports"
  }
} as const;

export const AUDIO_IMPORT_LIMITS = {
  maxFileSizeBytes: 100 * 1024 * 1024,
  defaultUserQuotaBytes: 2 * 1024 * 1024 * 1024
} as const;

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav"
] as const;

export const SUPPORTED_AUDIO_EXTENSIONS = [
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".wav"
] as const;

export type AudioImportValidationError =
  | "missing_audio_content"
  | "missing_audio_metadata"
  | "unsupported_audio_type"
  | "audio_file_too_large";

export interface AudioImportMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SerializedExternalSource {
  id: string;
  provider: ExternalSourceProvider;
  sourceId: string;
  canonicalUrl: string;
  originalTitle: string;
  originalUploader: string | null;
  thumbnailUrl: string | null;
  importPolicyMode: ImportPolicyMode;
  provenance: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalDiscoveryResult {
  provider: ExternalSourceProvider;
  sourceId: string;
  canonicalUrl: string;
  title: string;
  creator: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  description: string | null;
  importPolicyMode: ImportPolicyMode;
  eligibility?: ImportEligibility;
  attributionText?: string | null;
  licenseType?: string | null;
  licenseUrl?: string | null;
  reusableAudio?: ExternalAudioReuse | null;
}

export interface ExternalDiscoveryResponse {
  results: ExternalDiscoveryResult[];
  nextPageToken: string | null;
}

export type SerializedImportStatus = "pending" | "ready" | "failed";

export interface SerializedExternalImportJob {
  id: string;
  userId: string;
  songId: string;
  sourceId: string | null;
  status: SerializedImportStatus;
  errorCode: string | null;
  importPolicyMode: ImportPolicyMode;
  retryCount: number;
  provenance: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedSongExternalSourceInput {
  id: string;
  provider: ExternalSourceProvider;
  sourceId: string;
  canonicalUrl: string;
  originalTitle: string;
  originalUploader: string | null;
  thumbnailUrl: string | null;
  importPolicyMode: ImportPolicyMode;
  provenance: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export function isImportPolicyMode(value: unknown): value is ImportPolicyMode {
  return (
    typeof value === "string" &&
    IMPORT_POLICY_MODES.includes(value as ImportPolicyMode)
  );
}

export function isExternalSourceProvider(value: unknown): value is ExternalSourceProvider {
  return (
    typeof value === "string" &&
    EXTERNAL_SOURCE_PROVIDERS.includes(value as ExternalSourceProvider)
  );
}

export function isImportEligibilityState(value: unknown): value is ImportEligibilityState {
  return (
    typeof value === "string" &&
    IMPORT_ELIGIBILITY_STATES.includes(value as ImportEligibilityState)
  );
}

export function parseImportPolicyMode(
  value: unknown,
  fallback: ImportPolicyMode = "licensed_only"
): ImportPolicyMode {
  return isImportPolicyMode(value) ? value : fallback;
}

export function getImportPolicyModeCopy(mode: ImportPolicyMode): ImportPolicyModeCopy {
  return IMPORT_POLICY_MODE_COPY[mode];
}

export function serializeExternalSource(
  source: SerializedSongExternalSourceInput
): SerializedExternalSource {
  return {
    id: source.id,
    provider: source.provider,
    sourceId: source.sourceId,
    canonicalUrl: source.canonicalUrl,
    originalTitle: source.originalTitle,
    originalUploader: source.originalUploader,
    thumbnailUrl: source.thumbnailUrl,
    importPolicyMode: source.importPolicyMode,
    provenance: source.provenance,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString()
  };
}

export function serializeExternalImportJob(input: {
  id: string;
  userId: string;
  songId: string;
  sourceId: string | null;
  status: SerializedImportStatus;
  errorCode: string | null;
  importPolicyMode: ImportPolicyMode;
  retryCount: number;
  provenance: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): SerializedExternalImportJob {
  return {
    id: input.id,
    userId: input.userId,
    songId: input.songId,
    sourceId: input.sourceId,
    status: input.status,
    errorCode: input.errorCode,
    importPolicyMode: input.importPolicyMode,
    retryCount: input.retryCount,
    provenance: input.provenance,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString()
  };
}

export function validateAudioImportMetadata(
  metadata: Partial<AudioImportMetadata>,
  options: { maxFileSizeBytes?: number } = {}
): AudioImportValidationError | null {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? AUDIO_IMPORT_LIMITS.maxFileSizeBytes;

  if (
    typeof metadata.fileName !== "string" ||
    metadata.fileName.trim() === "" ||
    typeof metadata.mimeType !== "string" ||
    metadata.mimeType.trim() === "" ||
    typeof metadata.sizeBytes !== "number" ||
    !Number.isFinite(metadata.sizeBytes) ||
    metadata.sizeBytes < 0
  ) {
    return "missing_audio_metadata";
  }

  if (metadata.sizeBytes > maxFileSizeBytes) {
    return "audio_file_too_large";
  }

  const normalizedMime = metadata.mimeType.toLowerCase();
  const normalizedName = metadata.fileName.toLowerCase();
  const extensionAllowed = SUPPORTED_AUDIO_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension)
  );
  const mimeAllowed = SUPPORTED_AUDIO_MIME_TYPES.includes(
    normalizedMime as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number]
  );

  return extensionAllowed && mimeAllowed ? null : "unsupported_audio_type";
}
