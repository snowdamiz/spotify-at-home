import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

export interface AudioStorageWriteInput {
  userId: string;
  songId: string;
  content: Buffer;
}

export interface SharedAudioStorageWriteInput {
  provider: string;
  sourceId: string;
  content: Buffer;
}

export interface AudioStorageReadRange {
  start: number;
  end: number;
}

export interface AudioStorage {
  resolveOriginalPath?(input: Omit<AudioStorageWriteInput, "content">): string;
  resolveSharedOriginalPath?(input: Omit<SharedAudioStorageWriteInput, "content">): string;
  writeOriginal(input: AudioStorageWriteInput): Promise<string>;
  writeSharedOriginal?(input: SharedAudioStorageWriteInput): Promise<string>;
  statOriginal?(storagePath: string): Promise<{ sizeBytes: number }>;
  readOriginal?(input: { storagePath: string; range?: AudioStorageReadRange }): Promise<Readable>;
  deleteOriginal(storagePath: string): Promise<void>;
}

export class LocalAudioStorage implements AudioStorage {
  constructor(private readonly root: string) {}

  resolveOriginalPath(input: Omit<AudioStorageWriteInput, "content">) {
    return join(this.root, input.userId, input.songId, "original");
  }

  resolveSharedOriginalPath(input: Omit<SharedAudioStorageWriteInput, "content">) {
    return join(
      this.root,
      "external",
      safePathSegment(input.provider),
      hashStorageKey(input.sourceId),
      "original"
    );
  }

  async writeOriginal(input: AudioStorageWriteInput) {
    const directory = join(this.root, input.userId, input.songId);
    const storagePath = this.resolveOriginalPath(input);

    await mkdir(directory, { recursive: true });
    await writeFileIfMissing(storagePath, input.content);

    return storagePath;
  }

  async writeSharedOriginal(input: SharedAudioStorageWriteInput) {
    const storagePath = this.resolveSharedOriginalPath(input);

    await mkdir(join(this.root, "external", safePathSegment(input.provider), hashStorageKey(input.sourceId)), {
      recursive: true
    });
    await writeFileIfMissing(storagePath, input.content);

    return storagePath;
  }

  async statOriginal(storagePath: string) {
    const { stat } = await import("node:fs/promises");
    const metadata = await stat(storagePath);

    return { sizeBytes: metadata.size };
  }

  async readOriginal(input: { storagePath: string; range?: AudioStorageReadRange }) {
    return createReadStream(input.storagePath, input.range);
  }

  async deleteOriginal(storagePath: string) {
    await rm(storagePath, { force: true });
  }
}

export interface R2AudioStorageOptions {
  accountId?: string;
  accessKeyId: string;
  bucket: string;
  endpoint?: string;
  keyPrefix?: string;
  region?: string;
  secretAccessKey: string;
  client?: S3Client;
}

export class R2AudioStorage implements AudioStorage {
  private readonly client: S3Client;
  private readonly endpoint: string;
  private readonly keyPrefix: string;

  constructor(private readonly options: R2AudioStorageOptions) {
    this.endpoint =
      options.endpoint ??
      (options.accountId ? `https://${options.accountId}.r2.cloudflarestorage.com` : "");
    this.keyPrefix = normalizeKeyPrefix(options.keyPrefix);

    if (!this.endpoint) {
      throw new Error("R2 audio storage requires R2_ENDPOINT or R2_ACCOUNT_ID.");
    }

    this.client =
      options.client ??
      new S3Client({
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey
        },
        endpoint: this.endpoint,
        region: options.region ?? "auto"
      });
  }

  resolveOriginalPath(input: Omit<AudioStorageWriteInput, "content">) {
    return this.storagePathForKey(
      this.keyForParts("users", safePathSegment(input.userId), safePathSegment(input.songId), "original")
    );
  }

  resolveSharedOriginalPath(input: Omit<SharedAudioStorageWriteInput, "content">) {
    return this.storagePathForKey(
      this.keyForParts("external", safePathSegment(input.provider), hashStorageKey(input.sourceId), "original")
    );
  }

  async writeOriginal(input: AudioStorageWriteInput) {
    const storagePath = this.resolveOriginalPath(input);

    await this.putIfMissing(storagePath, input.content);

    return storagePath;
  }

  async writeSharedOriginal(input: SharedAudioStorageWriteInput) {
    const storagePath = this.resolveSharedOriginalPath(input);

    await this.putIfMissing(storagePath, input.content);

    return storagePath;
  }

  async statOriginal(storagePath: string) {
    const response = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: this.keyFromStoragePath(storagePath)
      })
    );

    if (typeof response.ContentLength !== "number") {
      throw new Error("R2 object is missing content length.");
    }

    return { sizeBytes: response.ContentLength };
  }

  async readOriginal(input: { storagePath: string; range?: AudioStorageReadRange }) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: this.keyFromStoragePath(input.storagePath),
        Range: input.range ? `bytes=${input.range.start}-${input.range.end}` : undefined
      })
    );

    return readableFromBody(response.Body);
  }

  async deleteOriginal(storagePath: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: this.keyFromStoragePath(storagePath)
      })
    );
  }

  private async putIfMissing(storagePath: string, content: Buffer) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Body: content,
          Bucket: this.options.bucket,
          IfNoneMatch: "*",
          Key: this.keyFromStoragePath(storagePath)
        })
      );
    } catch (error) {
      if (isObjectAlreadyStored(error)) {
        return;
      }

      throw error;
    }
  }

  private keyForParts(...parts: string[]) {
    return posix.join(this.keyPrefix, ...parts);
  }

  private storagePathForKey(key: string) {
    return `r2://${this.options.bucket}/${key}`;
  }

  private keyFromStoragePath(storagePath: string) {
    const url = new URL(storagePath);

    if (url.protocol !== "r2:" || url.hostname !== this.options.bucket) {
      throw new Error("Storage path does not belong to the configured R2 bucket.");
    }

    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  }
}

export function createAudioStorageFromEnv(options: { storageRoot?: string } = {}) {
  const driver = process.env.BROADSIDE_AUDIO_STORAGE_DRIVER ?? (process.env.R2_BUCKET ? "r2" : "local");

  if (driver === "r2") {
    return new R2AudioStorage({
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      bucket: requiredEnv("R2_BUCKET"),
      endpoint: process.env.R2_ENDPOINT,
      keyPrefix: process.env.R2_KEY_PREFIX,
      region: process.env.R2_REGION,
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY")
    });
  }

  if (driver !== "local") {
    throw new Error(`Unsupported audio storage driver: ${driver}`);
  }

  return new LocalAudioStorage(
    options.storageRoot ?? process.env.BROADSIDE_AUDIO_STORAGE_PATH ?? join(process.cwd(), "data", "audio")
  );
}

async function writeFileIfMissing(storagePath: string, content: Buffer) {
  try {
    await writeFile(storagePath, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return;
    }

    throw error;
  }
}

function hashStorageKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeKeyPrefix(prefix: string | undefined) {
  return prefix ? prefix.replace(/^\/+|\/+$/g, "") : "";
}

function safePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for R2 audio storage.`);
  }

  return value;
}

function isObjectAlreadyStored(error: unknown) {
  const maybeError = error as { $metadata?: { httpStatusCode?: number }; name?: string };

  return maybeError.name === "PreconditionFailed" || maybeError.$metadata?.httpStatusCode === 412;
}

function readableFromBody(body: unknown) {
  if (body instanceof Readable) {
    return body;
  }

  if (isAsyncIterable(body)) {
    return Readable.from(body);
  }

  throw new Error("Unsupported R2 response body type.");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in value &&
      typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}
