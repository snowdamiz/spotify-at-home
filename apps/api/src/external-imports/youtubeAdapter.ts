import { createHash } from "node:crypto";
import type { ExternalDiscoveryResult } from "@tunely/shared";

export interface ResolvedExternalAudio {
  adapter: string;
  content: Buffer;
  durationMs: number;
  fileName: string;
  mimeType: string;
  provenance: Record<string, unknown>;
}

export interface YouTubeImportAdapter {
  resolve(input: { discovery: ExternalDiscoveryResult }): Promise<ResolvedExternalAudio>;
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
