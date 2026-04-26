import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

async function readAppFile(path: string) {
  return readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("Phase 6 library UI wiring", () => {
  it("fetches library summary, search, and playlist data from phase 6 API routes", async () => {
    const apiSource = await readAppFile("src/library/songsApi.ts");

    expect(apiSource).toContain("/api/library/summary");
    expect(apiSource).toContain("/api/search?");
    expect(apiSource).toContain("/api/playlists");
    expect(apiSource).toContain("/api/playlists/");
    expect(apiSource).toContain("/api/songs/${encodeURIComponent(songId)}/like");
    expect(apiSource).toContain("LibrarySummary");
    expect(apiSource).toContain("LibrarySearchResults");
  });

  it("renders Home, Search, Library, and Playlist screens from server-backed hooks", async () => {
    const homeSource = await readAppFile("src/screens/HomeScreen.tsx");
    const searchSource = await readAppFile("src/screens/SearchScreen.tsx");
    const librarySource = await readAppFile("src/screens/LibraryScreen.tsx");
    const playlistSource = await readAppFile("src/screens/PlaylistScreen.tsx");

    expect(homeSource).toContain("useLibrarySummary");
    expect(homeSource).toContain("summary.recentSongs");
    expect(searchSource).toContain("useLibrarySearch");
    expect(searchSource).toContain("search.results.playlists");
    expect(librarySource).toContain("summary.playlists");
    expect(librarySource).toContain("summary.likedSongs");
    expect(playlistSource).toContain("usePlaylist");
    expect(playlistSource).toContain("liked-songs");
  });

  it("connects visible playlist and liked-song actions to server calls", async () => {
    const shellSource = await readAppFile("src/components/AppShell.tsx");
    const playerSource = await readAppFile("src/screens/PlayerScreen.tsx");

    expect(shellSource).toContain("createPlaylist");
    expect(shellSource).toContain("router.push(`/playlist/${result.playlist.id}`)");
    expect(playerSource).toContain("likeSong");
    expect(playerSource).toContain("unlikeSong");
    expect(playerSource).toContain("requestSongCacheIntent");
    expect(playerSource).toContain("updatePlaybackState");
  });
});
