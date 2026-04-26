export const APP_NAME = "Tunely" as const;

export const IMPORT_POLICY_MODES = [
  "open_test",
  "review_required",
  "licensed_only"
] as const;

export type ImportPolicyMode = (typeof IMPORT_POLICY_MODES)[number];

export interface ImportPolicyModeCopy {
  badge: string;
  description: string;
  label: string;
}

export const IMPORT_POLICY_MODE_COPY: Record<ImportPolicyMode, ImportPolicyModeCopy> = {
  licensed_only: {
    badge: "Licensed only",
    description: "External imports are limited to sources Tunely has approved for licensed use.",
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

export function isImportPolicyMode(value: unknown): value is ImportPolicyMode {
  return (
    typeof value === "string" &&
    IMPORT_POLICY_MODES.includes(value as ImportPolicyMode)
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
