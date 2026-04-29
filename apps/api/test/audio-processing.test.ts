import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegLoudnessNormalizer } from "../src/songs/audio-processing";

describe("FfmpegLoudnessNormalizer", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    while (tempRoots.length > 0) {
      await rm(tempRoots.pop()!, { force: true, recursive: true });
    }
  });

  it("can normalize with a single ffmpeg pass", async () => {
    const { ffmpegPath, logPath, tempRoot } = await createFakeFfmpeg();
    const normalizer = new FfmpegLoudnessNormalizer({
      ffmpegPath,
      normalizationMode: "single-pass",
      tempRoot
    });

    const result = await normalizer.process({
      content: Buffer.from("raw audio"),
      fileName: "track.wav",
      mimeType: "audio/wav"
    });
    const calls = await readFfmpegCalls(logPath);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("-codec:a");
    expect(calls[0]).not.toContain("-f");
    expect(result.content.toString()).toBe("ID3 normalized audio");
    expect(result.provenance).toMatchObject({
      audioNormalization: {
        algorithm: "ffmpeg_loudnorm_ebu_r128_single_pass",
        mode: "single-pass"
      }
    });
  });

  it("keeps two-pass loudnorm as the default mode", async () => {
    const { ffmpegPath, logPath, tempRoot } = await createFakeFfmpeg();
    const normalizer = new FfmpegLoudnessNormalizer({
      ffmpegPath,
      tempRoot
    });

    const result = await normalizer.process({
      content: Buffer.from("raw audio"),
      fileName: "track.wav",
      mimeType: "audio/wav"
    });
    const calls = await readFfmpegCalls(logPath);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["-f", "null", "-"]));
    expect(calls[1].join(" ")).toContain("measured_I=-20.00");
    expect(result.provenance).toMatchObject({
      audioNormalization: {
        algorithm: "ffmpeg_loudnorm_ebu_r128_two_pass",
        inputIntegratedLufs: -20,
        mode: "two-pass"
      }
    });
  });

  async function createFakeFfmpeg() {
    const tempRoot = await mkdtemp(join(tmpdir(), "broadside-ffmpeg-test-"));
    const ffmpegPath = join(tempRoot, "fake-ffmpeg.cjs");
    const logPath = join(tempRoot, "ffmpeg-calls.jsonl");

    tempRoots.push(tempRoot);
    await writeFile(
      ffmpegPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");

if (args.at(-1) === "-") {
  console.error(JSON.stringify({
    input_i: "-20.00",
    input_lra: "7.00",
    input_thresh: "-30.00",
    input_tp: "-1.00",
    target_offset: "1.50"
  }));
  process.exit(0);
}

fs.writeFileSync(args.at(-1), Buffer.from("ID3 normalized audio"));
`
    );
    await chmod(ffmpegPath, 0o755);

    return { ffmpegPath, logPath, tempRoot };
  }
});

async function readFfmpegCalls(logPath: string) {
  const content = await readFile(logPath, "utf8");

  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}
