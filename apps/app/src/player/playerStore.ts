import { mockSongs, type Song } from "../data/mockCatalog";

export type PlayerStore = {
  getCurrentTrack: () => Song | null;
  getMiniPlayerLabel: () => string | null;
  selectTrack: (trackId: string) => void;
};

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
