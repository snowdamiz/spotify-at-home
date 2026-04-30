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

  it("downloads the best audio stream without preconverting to MP3", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "broadside-ytdlp-adapter-"));
    dirs.push(tempRoot);
    const runner = vi.fn(async (_url: string, flags?: unknown) => {
      const output = (flags as { output?: string } | undefined)?.output;
      const filePath = join(dirname(String(output)), "abc123.webm");
      await writeFile(filePath, Buffer.from("webm audio"));

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
      expect.not.objectContaining({
        audioFormat: expect.anything(),
        extractAudio: expect.anything()
      }),
      expect.any(Object)
    );
    expect(runner).toHaveBeenCalledWith(
      "https://youtu.be/abc123",
      expect.objectContaining({
        format: "bestaudio[ext=m4a]/bestaudio/best"
      }),
      expect.any(Object)
    );
    expect(result).toMatchObject({
      fileName: "abc123.webm",
      mimeType: "audio/webm"
    });
    expect(result.provenance).toMatchObject({
      downloadedBytes: Buffer.byteLength("webm audio"),
      requestedFormat: "bestaudio[ext=m4a]/bestaudio/best"
    });
  });
});
