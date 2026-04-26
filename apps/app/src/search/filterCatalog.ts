import { mockPlaylists, mockSongs } from "../data/mockCatalog";

export type CatalogSearchResult = {
  id: string;
  kind: "playlist" | "song";
  title: string;
  subtitle: string;
};

export function filterCatalog(query: string): CatalogSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const playlists = mockPlaylists
    .filter((playlist) => matches(normalizedQuery, playlist.title, playlist.subtitle))
    .map((playlist) => ({
      id: playlist.id,
      kind: "playlist" as const,
      title: playlist.title,
      subtitle: playlist.subtitle
    }));

  const songs = mockSongs
    .filter((song) => matches(normalizedQuery, song.title, song.artist))
    .map((song) => ({
      id: song.id,
      kind: "song" as const,
      title: song.title,
      subtitle: song.artist
    }));

  return [...playlists, ...songs];
}

function matches(query: string, ...values: string[]) {
  return values.some((value) => value.toLowerCase().includes(query));
}
