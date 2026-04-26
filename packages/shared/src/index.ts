export const APP_NAME = "Tunely" as const;

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
