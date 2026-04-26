import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({
  default: {},
  deleteAsync: vi.fn(),
  documentDirectory: "file:///documents/",
  getInfoAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  readDirectoryAsync: vi.fn()
}));

const audioMocks = vi.hoisted(() => ({
  createAudioPlayer: vi.fn((source: unknown) => ({
    pause: vi.fn(),
    play: vi.fn(),
    remove: vi.fn(),
    source
  }))
}));

vi.mock("expo-audio", () => ({
  createAudioPlayer: audioMocks.createAudioPlayer
}));

import {
  calculateCacheSizeBytes,
  clearCachedSongs,
  resolvePlaybackSource,
  type CachedSong,
  type SongCacheRepository
} from "@tunely/app/player/cache";
import { ExpoAudioAdapter } from "@tunely/app/player/expoAudioAdapter";
import { createPlaybackStore, type AudioAdapter } from "@tunely/app/player/playerStore";
import { songStreamUrl } from "@tunely/app/library/songsApi";

describe("Phase 5 client playback and cache behavior", () => {
  it("loads a song, toggles play and pause, and exposes current track state", async () => {
    const calls: string[] = [];
    const audioAdapter: AudioAdapter = {
      load: vi.fn(async (uri) => {
        calls.push(`load:${uri}`);
      }),
      play: vi.fn(async () => {
        calls.push("play");
      }),
      pause: vi.fn(async () => {
        calls.push("pause");
      })
    };
    const player = createPlaybackStore({
      audioAdapter,
      sourceResolver: {
        resolve: async () => "file:///cached/song-a.mp3"
      }
    });

    await player.loadTrack({
      id: "song-a",
      title: "Private Moon",
      artist: "Ada",
      streamUrl: "/api/songs/song-a/stream"
    });

    expect(player.getState()).toMatchObject({
      currentTrack: {
        id: "song-a",
        title: "Private Moon"
      },
      currentUri: "file:///cached/song-a.mp3",
      status: "ready"
    });

    await player.togglePlayPause();
    expect(player.getState().status).toBe("playing");

    await player.togglePlayPause();
    expect(player.getState().status).toBe("paused");
    expect(calls).toEqual(["load:file:///cached/song-a.mp3", "play", "pause"]);
  });

  it("uses a cached file before falling back to the stream URL", async () => {
    const cachedRepository = createMemoryCacheRepository([
      {
        songId: "song-a",
        uri: "file:///cached/song-a.mp3",
        sizeBytes: 120
      }
    ]);
    const uncachedRepository = createMemoryCacheRepository([]);

    await expect(
      resolvePlaybackSource(
        {
          songId: "song-a",
          streamUrl: "/api/songs/song-a/stream"
        },
        cachedRepository
      )
    ).resolves.toEqual({
      source: "cache",
      uri: "file:///cached/song-a.mp3"
    });

    await expect(
      resolvePlaybackSource(
        {
          songId: "song-b",
          streamUrl: "/api/songs/song-b/stream"
        },
        uncachedRepository
      )
    ).resolves.toEqual({
      source: "stream",
      uri: "/api/songs/song-b/stream"
    });
  });

  it("clears cached files and reports cache size without deleting cloud songs", async () => {
    const repository = createMemoryCacheRepository([
      {
        songId: "song-a",
        uri: "file:///cached/song-a.mp3",
        sizeBytes: 120
      },
      {
        songId: "song-b",
        uri: "file:///cached/song-b.mp3",
        sizeBytes: 80
      }
    ]);

    await expect(calculateCacheSizeBytes(repository)).resolves.toBe(200);
    await expect(clearCachedSongs(repository)).resolves.toEqual({
      removedCount: 2,
      sizeBytes: 200
    });
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("builds encoded stream URLs from the configured API origin", () => {
    const previousApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.tunely.test";

    expect(songStreamUrl("song with spaces")).toBe(
      "https://api.tunely.test/api/songs/song%20with%20spaces/stream"
    );

    process.env.EXPO_PUBLIC_API_BASE_URL = previousApiBaseUrl;
  });

  it("adapts the player store to expo-audio players", async () => {
    const adapter = new ExpoAudioAdapter();

    await adapter.load("https://api.tunely.test/api/songs/song-a/stream");
    await adapter.play();
    await adapter.pause();
    adapter.release();

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledWith({
      uri: "https://api.tunely.test/api/songs/song-a/stream"
    });
    const player = audioMocks.createAudioPlayer.mock.results[0]?.value as {
      pause: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(2);
    expect(player.remove).toHaveBeenCalledTimes(1);
  });
});

function createMemoryCacheRepository(initialSongs: CachedSong[]): SongCacheRepository {
  const songs = new Map(initialSongs.map((song) => [song.songId, song]));

  return {
    async get(songId) {
      return songs.get(songId) ?? null;
    },
    async list() {
      return [...songs.values()];
    },
    async delete(songId) {
      songs.delete(songId);
    }
  };
}
