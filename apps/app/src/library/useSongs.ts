import { useEffect, useState } from "react";
import {
  emptyLibrarySummary,
  fetchLibrarySummary,
  fetchPlaylist,
  fetchSongs,
  searchLibrary,
  type LibrarySearchResults,
  type LibrarySummary,
  type ServerPlaylistDetail,
  type ServerSong
} from "./songsApi";

export type SongsState =
  | { status: "loading"; songs: ServerSong[] }
  | { status: "anonymous"; songs: ServerSong[] }
  | { status: "authenticated"; songs: ServerSong[] }
  | { status: "error"; songs: ServerSong[] };

export function useSongs(): SongsState {
  const [state, setState] = useState<SongsState>({ status: "loading", songs: [] });

  useEffect(() => {
    let mounted = true;

    fetchSongs()
      .then((result) => {
        if (mounted) {
          setState(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ status: "error", songs: [] });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

export type LibrarySummaryState =
  | { status: "loading"; summary: LibrarySummary }
  | { status: "anonymous"; summary: LibrarySummary }
  | { status: "authenticated"; summary: LibrarySummary }
  | { status: "error"; summary: LibrarySummary };

export function useLibrarySummary(): LibrarySummaryState {
  const [state, setState] = useState<LibrarySummaryState>({
    status: "loading",
    summary: emptyLibrarySummary()
  });

  useEffect(() => {
    let mounted = true;

    fetchLibrarySummary()
      .then((result) => {
        if (mounted) {
          setState(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ status: "error", summary: emptyLibrarySummary() });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

export type LibrarySearchState =
  | { status: "idle"; results: LibrarySearchResults }
  | { status: "loading"; results: LibrarySearchResults }
  | { status: "anonymous"; results: LibrarySearchResults }
  | { status: "authenticated"; results: LibrarySearchResults }
  | { status: "error"; results: LibrarySearchResults };

const emptySearchResults: LibrarySearchResults = {
  playlists: [],
  songs: []
};

export function useLibrarySearch(query: string): LibrarySearchState {
  const [state, setState] = useState<LibrarySearchState>({
    status: "idle",
    results: emptySearchResults
  });
  const trimmedQuery = query.trim();

  useEffect(() => {
    let mounted = true;

    if (!trimmedQuery) {
      setState({ status: "idle", results: emptySearchResults });
      return () => {
        mounted = false;
      };
    }

    setState({ status: "loading", results: emptySearchResults });
    searchLibrary(trimmedQuery)
      .then((result) => {
        if (mounted) {
          setState({ status: result.status, results: result.results });
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ status: "error", results: emptySearchResults });
        }
      });

    return () => {
      mounted = false;
    };
  }, [trimmedQuery]);

  return state;
}

export type PlaylistState =
  | { status: "loading"; playlist: ServerPlaylistDetail | null }
  | { status: "anonymous"; playlist: ServerPlaylistDetail | null }
  | { status: "authenticated"; playlist: ServerPlaylistDetail }
  | { status: "not-found"; playlist: ServerPlaylistDetail | null }
  | { status: "error"; playlist: ServerPlaylistDetail | null };

export function usePlaylist(playlistId?: string): PlaylistState {
  const [state, setState] = useState<PlaylistState>({ status: "loading", playlist: null });

  useEffect(() => {
    let mounted = true;

    if (!playlistId) {
      setState({ status: "not-found", playlist: null });
      return () => {
        mounted = false;
      };
    }

    fetchPlaylist(playlistId)
      .then((result) => {
        if (mounted) {
          setState(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ status: "error", playlist: null });
        }
      });

    return () => {
      mounted = false;
    };
  }, [playlistId]);

  return state;
}
