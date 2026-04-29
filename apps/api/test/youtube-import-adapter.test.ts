import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YtDlpYouTubeImportAdapter } from "../src/external-imports/youtubeAdapter";

describe("YtDlpYouTubeImportAdapter", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }

    vi.restoreAllMocks();
  });

  it("uses compact yt-dlp audio quality by default", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "broadside-ytdlp-adapter-"));
    dirs.push(tempRoot);
    const runner = vi.fn(async (_url: string, flags?: unknown) => {
      const output = (flags as { output?: string } | undefined)?.output;
      const filePath = join(dirname(String(output)), "abc123.mp3");
      await writeFile(filePath, Buffer.from("ID3 compact audio"));

      return filePath;
    });
    const adapter = new YtDlpYouTubeImportAdapter({
      runner,
      tempRoot
    });

    const result = await adapter.resolve({
      discovery: {
        canonicalUrl: "https://youtu.be/abc123",
        creator: "Ada",
        description: null,
        durationMs: 120_000,
        importPolicyMode: "open_test",
        provider: "youtube",
        sourceId: "abc123",
        thumbnailUrl: null,
        title: "Compact Audio"
      }
    });

    expect(runner).toHaveBeenCalledWith(
      "https://youtu.be/abc123",
      expect.objectContaining({
        audioFormat: "mp3",
        audioQuality: 5
      }),
      expect.any(Object)
    );
    expect(result.provenance).toMatchObject({
      audioQuality: 5,
      downloadedBytes: Buffer.byteLength("ID3 compact audio")
    });
  });
});
