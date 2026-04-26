import { mockSongs, type Song } from "../data/mockCatalog";

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string | null;
  streamUrl: string;
}

export type PlaybackStatus = "idle" | "loading" | "ready" | "playing" | "paused";

export interface PlayerState {
  currentTrack: PlayerTrack | null;
  currentUri: string | null;
  status: PlaybackStatus;
}

export interface AudioAdapter {
  load(uri: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
}

export interface PlaybackSourceResolver {
  resolve(track: PlayerTrack): Promise<string>;
}

export type PlaybackStore = {
  getState: () => PlayerState;
  loadTrack: (track: PlayerTrack) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
};

export type PlayerStore = {
  getCurrentTrack: () => Song | null;
  getMiniPlayerLabel: () => string | null;
  selectTrack: (trackId: string) => void;
};

export function createPlaybackStore(input: {
  audioAdapter: AudioAdapter;
  sourceResolver: PlaybackSourceResolver;
}): PlaybackStore {
  let state: PlayerState = {
    currentTrack: null,
    currentUri: null,
    status: "idle"
  };

  return {
    getState: () => state,
    loadTrack: async (track) => {
      state = {
        ...state,
        currentTrack: track,
        currentUri: null,
        status: "loading"
      };

      const uri = await input.sourceResolver.resolve(track);
      await input.audioAdapter.load(uri);
      state = {
        currentTrack: track,
        currentUri: uri,
        status: "ready"
      };
    },
    togglePlayPause: async () => {
      if (state.status === "playing") {
        await input.audioAdapter.pause();
        state = {
          ...state,
          status: "paused"
        };
        return;
      }

      if (state.currentTrack) {
        await input.audioAdapter.play();
        state = {
          ...state,
          status: "playing"
        };
      }
    },
    play: async () => {
      if (!state.currentTrack) {
        return;
      }

      await input.audioAdapter.play();
      state = {
        ...state,
        status: "playing"
      };
    },
    pause: async () => {
      if (!state.currentTrack) {
        return;
      }

      await input.audioAdapter.pause();
      state = {
        ...state,
        status: "paused"
      };
    }
  };
}

export function createMockPlayerStore(initialTrackId?: string): PlayerStore {
  let currentTrack = initialTrackId ? findTrack(initialTrackId) : null;

  return {
    getCurrentTrack: () => currentTrack,
    getMiniPlayerLabel: () => {
      if (!currentTrack) {
        return null;
      }

      return `${currentTrack.title} - ${currentTrack.artist}`;
    },
    selectTrack: (trackId: string) => {
      currentTrack = findTrack(trackId);
    }
  };
}

function findTrack(trackId: string) {
  return mockSongs.find((song) => song.id === trackId) ?? null;
}
