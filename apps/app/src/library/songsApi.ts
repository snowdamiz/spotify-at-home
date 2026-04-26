import { getImportPolicyModeCopy, type ImportPolicyMode } from "@tunely/shared";
import { apiBaseUrl, apiUrl } from "../api/config";

export interface ServerSong {
  id: string;
  userId?: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  mimeType: string;
  sizeBytes: number;
  importStatus: "ready";
  createdAt: string;
  updatedAt: string;
}

export interface ServerPlaylist {
  id: string;
  userId?: string;
  name: string;
  description: string | null;
  color: string | null;
  songCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServerPlaylistDetail extends ServerPlaylist {
  songs: Array<ServerSong & { addedAt: string; position: number }>;
}

export interface LibrarySummary {
  counts: {
    likedSongs: number;
    playlists: number;
    songs: number;
  };
  isEmpty: boolean;
  likedSongs: ServerSong[];
  playlists: ServerPlaylist[];
  recentSongs: ServerSong[];
}

export interface LibrarySearchResults {
  playlists: ServerPlaylist[];
  songs: ServerSong[];
}

export interface PlaybackState {
  userId: string;
  songId: string | null;
  positionMs: number;
  shuffleEnabled: boolean;
  repeatMode: "off" | "one" | "all";
  updatedAt: string | null;
}

export interface ServerImportPolicy {
  configuredMode: ImportPolicyMode;
  copy: ReturnType<typeof getImportPolicyModeCopy>;
  environment: string;
  mode: ImportPolicyMode;
  openTestAllowed: boolean;
}

export async function fetchImportPolicy() {
  const response = await fetch(`${apiBaseUrl()}/api/import-policy`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Import policy request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { importPolicy: ServerImportPolicy };

  return payload.importPolicy;
}

export async function fetchSongs() {
  const response = await fetch(`${apiBaseUrl()}/api/songs`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, songs: [] };
  }

  if (!response.ok) {
    throw new Error(`Songs request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { songs: ServerSong[] };

  return { status: "authenticated" as const, songs: payload.songs };
}

export async function fetchLibrarySummary() {
  const response = await fetch(`${apiBaseUrl()}/api/library/summary`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, summary: emptyLibrarySummary() };
  }

  if (!response.ok) {
    throw new Error(`Library summary request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { summary: LibrarySummary };

  return { status: "authenticated" as const, summary: payload.summary };
}

export async function searchLibrary(query: string, options: { cursor?: string | null; limit?: number } = {}) {
  const params = new URLSearchParams({
    query
  });

  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  if (options.limit) {
    params.set("limit", String(options.limit));
  }

  const response = await fetch(`${apiBaseUrl()}/api/search?${params.toString()}`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return {
      nextCursor: null,
      results: { playlists: [], songs: [] },
      status: "anonymous" as const
    };
  }

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    nextCursor: string | null;
    results: LibrarySearchResults;
  };

  return {
    nextCursor: payload.nextCursor,
    results: payload.results,
    status: "authenticated" as const
  };
}

export async function fetchPlaylist(playlistId: string) {
  const response = await fetch(`${apiBaseUrl()}/api/playlists/${encodeURIComponent(playlistId)}`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, playlist: null };
  }

  if (response.status === 404) {
    return { status: "not-found" as const, playlist: null };
  }

  if (!response.ok) {
    throw new Error(`Playlist request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { playlist: ServerPlaylistDetail };

  return { status: "authenticated" as const, playlist: payload.playlist };
}

export async function createPlaylist(input: {
  name: string;
  description?: string | null;
  color?: string | null;
}) {
  const response = await fetch(`${apiBaseUrl()}/api/playlists`, {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, playlist: null };
  }

  if (!response.ok) {
    throw new Error(`Create playlist request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { playlist: ServerPlaylistDetail };

  return { status: "authenticated" as const, playlist: payload.playlist };
}

export async function fetchSong(songId: string) {
  const response = await fetch(`${apiBaseUrl()}/api/songs/${encodeURIComponent(songId)}`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, song: null };
  }

  if (response.status === 404) {
    return { status: "not-found" as const, song: null };
  }

  if (!response.ok) {
    throw new Error(`Song request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { song: ServerSong };

  return { status: "authenticated" as const, song: payload.song };
}

export async function likeSong(songId: string) {
  const response = await fetch(`${apiBaseUrl()}/api/songs/${encodeURIComponent(songId)}/like`, {
    credentials: "include",
    method: "POST"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, liked: false };
  }

  if (response.status === 404) {
    return { status: "not-found" as const, liked: false };
  }

  if (!response.ok) {
    throw new Error(`Like song request failed with status ${response.status}`);
  }

  return { status: "authenticated" as const, liked: true };
}

export async function unlikeSong(songId: string) {
  const response = await fetch(`${apiBaseUrl()}/api/songs/${encodeURIComponent(songId)}/like`, {
    credentials: "include",
    method: "DELETE"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, liked: false };
  }

  if (response.status === 404) {
    return { status: "not-found" as const, liked: false };
  }

  if (!response.ok) {
    throw new Error(`Unlike song request failed with status ${response.status}`);
  }

  return { status: "authenticated" as const, liked: false };
}

export function songStreamUrl(songId: string) {
  return apiUrl(`/api/songs/${encodeURIComponent(songId)}/stream`);
}

export async function requestSongCacheIntent(songId: string) {
  const response = await fetch(`${apiBaseUrl()}/api/songs/${encodeURIComponent(songId)}/cache-intent`, {
    credentials: "include",
    method: "POST"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, cacheIntent: null };
  }

  if (response.status === 404) {
    return { status: "not-found" as const, cacheIntent: null };
  }

  if (!response.ok) {
    throw new Error(`Cache intent request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    cacheIntent: {
      songId: string;
      streamUrl: string;
    };
  };

  return {
    status: "accepted" as const,
    cacheIntent: {
      ...payload.cacheIntent,
      streamUrl: apiUrl(payload.cacheIntent.streamUrl)
    }
  };
}

export async function fetchPlaybackState() {
  const response = await fetch(`${apiBaseUrl()}/api/playback-state`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, playbackState: null };
  }

  if (!response.ok) {
    throw new Error(`Playback state request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { playbackState: PlaybackState };

  return { status: "authenticated" as const, playbackState: payload.playbackState };
}

export async function updatePlaybackState(input: {
  songId: string | null;
  positionMs: number;
  shuffleEnabled: boolean;
  repeatMode: PlaybackState["repeatMode"];
}) {
  const response = await fetch(`${apiBaseUrl()}/api/playback-state`, {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    method: "PUT"
  });

  if (response.status === 401) {
    return { status: "anonymous" as const, playbackState: null };
  }

  if (response.status === 404) {
    return { status: "not-found" as const, playbackState: null };
  }

  if (!response.ok) {
    throw new Error(`Playback state update failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { playbackState: PlaybackState };

  return { status: "authenticated" as const, playbackState: payload.playbackState };
}

export function filterSongs(songs: ServerSong[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return songs.filter((song) =>
    [song.title, song.artist, song.album]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  );
}

export function songSubtitle(song: ServerSong) {
  return song.artist ?? song.album ?? "Imported song";
}

export function playlistSubtitle(playlist: ServerPlaylist) {
  return `${playlist.songCount} ${playlist.songCount === 1 ? "song" : "songs"}`;
}

export function defaultImportPolicy(): ServerImportPolicy {
  return {
    configuredMode: "licensed_only",
    copy: getImportPolicyModeCopy("licensed_only"),
    environment: "production",
    mode: "licensed_only",
    openTestAllowed: false
  };
}

export function emptyLibrarySummary(): LibrarySummary {
  return {
    counts: {
      likedSongs: 0,
      playlists: 0,
      songs: 0
    },
    isEmpty: true,
    likedSongs: [],
    playlists: [],
    recentSongs: []
  };
}
