import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultTargetIntegratedLufs = -16;
const defaultTargetTruePeakDbtp = -1.5;
const defaultTargetLra = 11;
const defaultOutputBitrate = "192k";
const defaultTimeoutMs = 240_000;
const commandOutputLimitBytes = 10 * 1024 * 1024;

export interface AudioImportProcessingInput {
  content: Buffer;
  durationMs?: number | null;
  fileName: string;
  mimeType: string;
}

export interface ProcessedAudioImport {
  content: Buffer;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
  provenance: Record<string, unknown>;
}

export interface AudioImportProcessor {
  process(input: AudioImportProcessingInput): Promise<ProcessedAudioImport>;
}

export class AudioImportProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export class PassthroughAudioImportProcessor implements AudioImportProcessor {
  async process(input: AudioImportProcessingInput): Promise<ProcessedAudioImport> {
    return {
      content: input.content,
      durationMs: input.durationMs ?? null,
      fileName: input.fileName,
      mimeType: input.mimeType,
      provenance: {}
    };
  }
}

export interface FfmpegLoudnessNormalizerOptions {
  ffmpegPath?: string;
  outputBitrate?: string;
  targetIntegratedLufs?: number;
  targetLra?: number;
  targetTruePeakDbtp?: number;
  tempRoot?: string;
  timeoutMs?: number;
}

export class FfmpegLoudnessNormalizer implements AudioImportProcessor {
  private readonly ffmpegPath: string;
  private readonly outputBitrate: string;
  private readonly targetIntegratedLufs: number;
  private readonly targetLra: number;
  private readonly targetTruePeakDbtp: number;
  private readonly tempRoot: string;
  private readonly timeoutMs: number;

  constructor(options: FfmpegLoudnessNormalizerOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
    this.outputBitrate = options.outputBitrate ?? defaultOutputBitrate;
    this.targetIntegratedLufs = finiteOrDefault(
      options.targetIntegratedLufs,
      defaultTargetIntegratedLufs
    );
    this.targetLra = finiteOrDefault(options.targetLra, defaultTargetLra);
    this.targetTruePeakDbtp = finiteOrDefault(
      options.targetTruePeakDbtp,
      defaultTargetTruePeakDbtp
    );
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  async process(input: AudioImportProcessingInput): Promise<ProcessedAudioImport> {
    const tempDir = await mkdtemp(join(this.tempRoot, "broadside-audio-normalize-"));

    try {
      const inputPath = join(tempDir, `input${extensionForInput(input)}`);
      const outputPath = join(tempDir, "normalized.mp3");

      await writeFile(inputPath, input.content);

      const analysis = await this.runFfmpeg([
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-af",
        this.firstPassFilter(),
        "-f",
        "null",
        "-"
      ]);
      const stats = parseLoudnormStats(analysis.stderr);

      await this.runFfmpeg([
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-map_metadata",
        "0",
        "-id3v2_version",
        "3",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        this.outputBitrate,
        "-af",
        this.secondPassFilter(stats),
        outputPath
      ]);

      return {
        content: await readFile(outputPath),
        durationMs: input.durationMs ?? null,
        fileName: normalizedFileName(input.fileName),
        mimeType: "audio/mpeg",
        provenance: {
          audioNormalization: {
            algorithm: "ffmpeg_loudnorm_ebu_r128_two_pass",
            applied: true,
            inputIntegratedLufs: numberFromLoudnormValue(stats.input_i),
            inputLra: numberFromLoudnormValue(stats.input_lra),
            inputThreshold: numberFromLoudnormValue(stats.input_thresh),
            inputTruePeakDbtp: numberFromLoudnormValue(stats.input_tp),
            outputBitrate: this.outputBitrate,
            outputMimeType: "audio/mpeg",
            targetIntegratedLufs: this.targetIntegratedLufs,
            targetLra: this.targetLra,
            targetOffset: numberFromLoudnormValue(stats.target_offset),
            targetTruePeakDbtp: this.targetTruePeakDbtp
          }
        }
      };
    } catch (error) {
      if (error instanceof AudioImportProcessingError) {
        throw error;
      }

      throw new AudioImportProcessingError(
        "audio_processing_failed",
        "Audio file could not be normalized.",
        { cause: messageForError(error) }
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private firstPassFilter() {
    return loudnormFilter({
      targetIntegratedLufs: this.targetIntegratedLufs,
      targetLra: this.targetLra,
      targetTruePeakDbtp: this.targetTruePeakDbtp
    });
  }

  private secondPassFilter(stats: LoudnormStats) {
    return loudnormFilter({
      measuredIntegratedLufs: stats.input_i,
      measuredLra: stats.input_lra,
      measuredThreshold: stats.input_thresh,
      measuredTruePeakDbtp: stats.input_tp,
      offset: stats.target_offset,
      targetIntegratedLufs: this.targetIntegratedLufs,
      targetLra: this.targetLra,
      targetTruePeakDbtp: this.targetTruePeakDbtp
    });
  }

  private async runFfmpeg(args: string[]) {
    try {
      return await execFileAsync(this.ffmpegPath, args, {
        maxBuffer: commandOutputLimitBytes,
        timeout: this.timeoutMs
      });
    } catch (error) {
      throw new AudioImportProcessingError(
        "audio_processing_failed",
        "Audio file could not be normalized.",
        {
          args,
          cause: messageForError(error),
          stderr: stderrFromExecError(error)
        }
      );
    }
  }
}

export function createAudioImportProcessorFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!envFlag(env.BROADSIDE_AUDIO_NORMALIZATION_ENABLED, env.NODE_ENV !== "test")) {
    return new PassthroughAudioImportProcessor();
  }

  return new FfmpegLoudnessNormalizer({
    ffmpegPath: env.FFMPEG_PATH,
    outputBitrate: env.BROADSIDE_AUDIO_NORMALIZATION_BITRATE ?? defaultOutputBitrate,
    targetIntegratedLufs: numberFromEnv(
      env.BROADSIDE_AUDIO_NORMALIZATION_TARGET_LUFS,
      defaultTargetIntegratedLufs
    ),
    targetLra: numberFromEnv(env.BROADSIDE_AUDIO_NORMALIZATION_LRA, defaultTargetLra),
    targetTruePeakDbtp: numberFromEnv(
      env.BROADSIDE_AUDIO_NORMALIZATION_TRUE_PEAK,
      defaultTargetTruePeakDbtp
    )
  });
}

interface LoudnormStats {
  input_i: string;
  input_lra: string;
  input_thresh: string;
  input_tp: string;
  target_offset: string;
}

function loudnormFilter(input: {
  measuredIntegratedLufs?: string;
  measuredLra?: string;
  measuredThreshold?: string;
  measuredTruePeakDbtp?: string;
  offset?: string;
  targetIntegratedLufs: number;
  targetLra: number;
  targetTruePeakDbtp: number;
}) {
  const parts = [
    `I=${input.targetIntegratedLufs}`,
    `TP=${input.targetTruePeakDbtp}`,
    `LRA=${input.targetLra}`
  ];

  if (
    input.measuredIntegratedLufs &&
    input.measuredLra &&
    input.measuredThreshold &&
    input.measuredTruePeakDbtp &&
    input.offset
  ) {
    parts.push(
      `measured_I=${input.measuredIntegratedLufs}`,
      `measured_TP=${input.measuredTruePeakDbtp}`,
      `measured_LRA=${input.measuredLra}`,
      `measured_thresh=${input.measuredThreshold}`,
      `offset=${input.offset}`,
      "linear=true"
    );
  }

  parts.push("print_format=json");

  return `loudnorm=${parts.join(":")}`;
}

function parseLoudnormStats(output: string): LoudnormStats {
  const start = output.lastIndexOf("{");
  const end = output.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new AudioImportProcessingError(
      "audio_processing_failed",
      "Audio normalization did not return loudness measurements."
    );
  }

  const parsed = JSON.parse(output.slice(start, end + 1)) as Partial<LoudnormStats>;

  if (
    typeof parsed.input_i !== "string" ||
    typeof parsed.input_tp !== "string" ||
    typeof parsed.input_lra !== "string" ||
    typeof parsed.input_thresh !== "string" ||
    typeof parsed.target_offset !== "string"
  ) {
    throw new AudioImportProcessingError(
      "audio_processing_failed",
      "Audio normalization returned incomplete loudness measurements."
    );
  }

  return {
    input_i: parsed.input_i,
    input_lra: parsed.input_lra,
    input_thresh: parsed.input_thresh,
    input_tp: parsed.input_tp,
    target_offset: parsed.target_offset
  };
}

function normalizedFileName(fileName: string) {
  return `${basename(fileName, extname(fileName)) || "audio"}.normalized.mp3`;
}

function extensionForInput(input: AudioImportProcessingInput) {
  const extension = extname(input.fileName);

  if (extension) {
    return extension;
  }

  switch (input.mimeType.toLowerCase()) {
    case "audio/aac":
      return ".aac";
    case "audio/flac":
    case "audio/x-flac":
      return ".flac";
    case "audio/m4a":
    case "audio/mp4":
    case "audio/x-m4a":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    default:
      return ".mp3";
  }
}

function numberFromEnv(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return finiteOrDefault(Number(value), fallback);
}

function finiteOrDefault(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberFromLoudnormValue(value: string) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : value;
}

function envFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function stderrFromExecError(error: unknown) {
  const stderr = (error as { stderr?: unknown }).stderr;

  return typeof stderr === "string" ? stderr.slice(-4000) : undefined;
}

function messageForError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "unknown error";
}
