import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface AudioStorageWriteInput {
  userId: string;
  songId: string;
  content: Buffer;
}

export interface AudioStorage {
  resolveOriginalPath?(input: Omit<AudioStorageWriteInput, "content">): string;
  writeOriginal(input: AudioStorageWriteInput): Promise<string>;
  deleteOriginal(storagePath: string): Promise<void>;
}

export class LocalAudioStorage implements AudioStorage {
  constructor(private readonly root: string) {}

  resolveOriginalPath(input: Omit<AudioStorageWriteInput, "content">) {
    return join(this.root, input.userId, input.songId, "original");
  }

  async writeOriginal(input: AudioStorageWriteInput) {
    const directory = join(this.root, input.userId, input.songId);
    const storagePath = this.resolveOriginalPath(input);

    await mkdir(directory, { recursive: true });
    await writeFile(storagePath, input.content, { flag: "wx" });

    return storagePath;
  }

  async deleteOriginal(storagePath: string) {
    await rm(storagePath, { force: true });
  }
}
