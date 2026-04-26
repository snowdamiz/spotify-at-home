import * as FileSystem from "expo-file-system";

export interface CachedSong {
  songId: string;
  uri: string;
  sizeBytes: number;
}

export interface SongCacheRepository {
  get(songId: string): Promise<CachedSong | null>;
  list(): Promise<CachedSong[]>;
  delete(songId: string): Promise<void>;
}

export interface PlaybackSource {
  source: "cache" | "stream";
  uri: string;
}

export async function resolvePlaybackSource(
  input: { songId: string; streamUrl: string },
  cacheRepository: SongCacheRepository
): Promise<PlaybackSource> {
  const cached = await cacheRepository.get(input.songId);

  if (cached) {
    return {
      source: "cache",
      uri: cached.uri
    };
  }

  return {
    source: "stream",
    uri: input.streamUrl
  };
}

export async function calculateCacheSizeBytes(cacheRepository: SongCacheRepository) {
  const cachedSongs = await cacheRepository.list();

  return cachedSongs.reduce((total, song) => total + song.sizeBytes, 0);
}

export async function clearCachedSongs(cacheRepository: SongCacheRepository) {
  const cachedSongs = await cacheRepository.list();
  const sizeBytes = cachedSongs.reduce((total, song) => total + song.sizeBytes, 0);

  await Promise.all(cachedSongs.map((song) => cacheRepository.delete(song.songId)));

  return {
    removedCount: cachedSongs.length,
    sizeBytes
  };
}

export class ExpoFileSystemSongCacheRepository implements SongCacheRepository {
  constructor(private readonly rootUri = `${FileSystem.documentDirectory ?? ""}tunely-cache/audio`) {}

  async get(songId: string): Promise<CachedSong | null> {
    const uri = this.uriForSong(songId);
    const info = await FileSystem.getInfoAsync(uri);

    if (!info.exists) {
      return null;
    }

    return {
      songId,
      uri,
      sizeBytes: typeof info.size === "number" ? info.size : 0
    };
  }

  async list(): Promise<CachedSong[]> {
    await this.ensureRoot();

    const entries = await FileSystem.readDirectoryAsync(this.rootUri);
    const cachedSongs = await Promise.all(
      entries.map(async (entry) => {
        const songId = decodeURIComponent(entry);
        return this.get(songId);
      })
    );

    return cachedSongs.filter((song): song is CachedSong => Boolean(song));
  }

  async delete(songId: string) {
    await FileSystem.deleteAsync(this.uriForSong(songId), {
      idempotent: true
    });
  }

  private async ensureRoot() {
    await FileSystem.makeDirectoryAsync(this.rootUri, {
      intermediates: true
    });
  }

  private uriForSong(songId: string) {
    return `${this.rootUri}/${encodeURIComponent(songId)}`;
  }
}
