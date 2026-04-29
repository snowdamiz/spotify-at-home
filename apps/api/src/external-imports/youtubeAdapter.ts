import { createHash } from "node:crypto";
import type { SpawnOptions } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ExternalDiscoveryResult } from "@broadside/shared";
import youtubeDl, { type Flags } from "youtube-dl-exec";

export interface ResolvedExternalAudio {
  adapter: string;
  content: Buffer;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
  provenance: Record<string, unknown>;
}

export interface YouTubeImportAdapter {
  resolve(input: { discovery: ExternalDiscoveryResult }): Promise<ResolvedExternalAudio>;
}

type YtDlpRunner = (url: string, flags?: Flags, options?: SpawnOptions) => Promise<unknown>;
const defaultYtDlpRunner = youtubeDl as unknown as YtDlpRunner;
const defaultAudioQuality = 5;

export class YouTubeImportAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export interface YtDlpYouTubeImportAdapterOptions {
  audioQuality?: number | string;
  runner?: YtDlpRunner;
  tempRoot?: string;
  timeoutMs?: number;
}

export class YtDlpYouTubeImportAdapter implements YouTubeImportAdapter {
  private readonly audioQuality: number | string;
  private readonly runner: YtDlpRunner;
  private readonly tempRoot: string;
  private readonly timeoutMs: number;

  constructor(options: YtDlpYouTubeImportAdapterOptions = {}) {
    this.audioQuality =
      options.audioQuality ?? audioQualityFromEnv(process.env.BROADSIDE_YTDLP_AUDIO_QUALITY);
    this.runner = options.runner ?? defaultYtDlpRunner;
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async resolve(input: { discovery: ExternalDiscoveryResult }): Promise<ResolvedExternalAudio> {
    const tempDir = await mkdtemp(join(this.tempRoot, "broadside-youtube-"));

    try {
      const outputTemplate = join(tempDir, "%(id)s.%(ext)s");
      const flags = {
        audioFormat: "mp3",
        audioQuality: this.audioQuality,
        extractAudio: true,
        noPlaylist: true,
        noProgress: true,
        noWarnings: true,
        output: outputTemplate,
        print: "after_move:filepath",
        restrictFilenames: true
      } as unknown as Flags;
      const output = await this.runner(
        input.discovery.canonicalUrl,
        flags,
        {
          timeout: this.timeoutMs
        }
      );
      const filePath = await resolveDownloadedAudioPath(tempDir, output);
      const content = await readFile(filePath);
      const fileStats = await stat(filePath);

      if (fileStats.size === 0) {
        throw new YouTubeImportAdapterError(
          "external_audio_download_empty",
          "The downloader produced an empty audio file."
        );
      }

      return {
        adapter: "yt_dlp_audio",
        content,
        durationMs: input.discovery.durationMs,
        fileName: `${input.discovery.sourceId}${extname(filePath) || ".mp3"}`,
        mimeType: mimeTypeForDownloadedAudio(filePath),
        provenance: {
          adapter: "yt_dlp_audio",
          contentSha256: createHash("sha256").update(content).digest("hex"),
          downloader: "yt-dlp",
          audioQuality: this.audioQuality,
          downloadedBytes: fileStats.size
        }
      };
    } catch (error) {
      if (error instanceof YouTubeImportAdapterError) {
        throw error;
      }

      throw new YouTubeImportAdapterError(
        "external_audio_download_failed",
        "Could not download audio from YouTube.",
        {
          cause: messageForError(error)
        }
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}

function audioQualityFromEnv(value: string | undefined) {
  if (!value || value.trim() === "") {
    return defaultAudioQuality;
  }

  const trimmed = value.trim();
  const numericQuality = Number(trimmed);

  return Number.isFinite(numericQuality) ? numericQuality : trimmed;
}

export class SyntheticYouTubeOpenTestAdapter implements YouTubeImportAdapter {
  async resolve(input: { discovery: ExternalDiscoveryResult }): Promise<ResolvedExternalAudio> {
    const durationMs = 1200;
    const content = createSineWave({
      durationMs,
      frequencyHz: frequencyForSource(input.discovery.sourceId),
      sampleRate: 22050
    });

    return {
      adapter: "youtube_open_test_synthetic_wav",
      content,
      durationMs,
      fileName: `${input.discovery.sourceId}.wav`,
      mimeType: "audio/wav",
      provenance: {
        adapter: "youtube_open_test_synthetic_wav",
        contentSha256: createHash("sha256").update(content).digest("hex"),
        note: "Synthetic validation audio for open-test import pipeline."
      }
    };
  }
}

function frequencyForSource(sourceId: string) {
  let hash = 0;

  for (let index = 0; index < sourceId.length; index += 1) {
    hash = (hash << 5) - hash + sourceId.charCodeAt(index);
    hash |= 0;
  }

  return 220 + (Math.abs(hash) % 440);
}

function createSineWave(input: {
  durationMs: number;
  frequencyHz: number;
  sampleRate: number;
}) {
  const samples = Math.floor((input.durationMs / 1000) * input.sampleRate);
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = samples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(input.sampleRate, 24);
  buffer.writeUInt32LE(input.sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let sample = 0; sample < samples; sample += 1) {
    const fadeIn = Math.min(1, sample / 800);
    const fadeOut = Math.min(1, (samples - sample) / 800);
    const envelope = Math.min(fadeIn, fadeOut);
    const value = Math.sin((sample / input.sampleRate) * Math.PI * 2 * input.frequencyHz);
    buffer.writeInt16LE(Math.round(value * envelope * 0x3fff), 44 + sample * bytesPerSample);
  }

  return buffer;
}

async function resolveDownloadedAudioPath(tempDir: string, output: unknown) {
  const printedPath = lastPrintedPath(output);

  if (printedPath) {
    const candidatePath = resolve(tempDir, printedPath);

    if (candidatePath.startsWith(resolve(tempDir))) {
      try {
        const candidateStats = await stat(candidatePath);

        if (candidateStats.isFile()) {
          return candidatePath;
        }
      } catch {
        // Fall through to directory scan below.
      }
    }
  }

  const entries = await readdir(tempDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(tempDir, entry.name))
    .filter((filePath) => supportedDownloadedAudioExtensions.has(extname(filePath).toLowerCase()));

  if (files.length === 0) {
    throw new YouTubeImportAdapterError(
      "external_audio_download_missing",
      "The downloader did not produce an audio file."
    );
  }

  return files[0];
}

function lastPrintedPath(output: unknown) {
  if (typeof output !== "string") {
    return null;
  }

  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? null;
}

const supportedDownloadedAudioExtensions = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".wav"
]);

function mimeTypeForDownloadedAudio(filePath: string) {
  switch (extname(filePath).toLowerCase()) {
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".m4a":
      return "audio/m4a";
    case ".mp3":
      return "audio/mpeg";
    case ".oga":
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    default:
      return "audio/mpeg";
  }
}

function messageForError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "unknown error";
}
