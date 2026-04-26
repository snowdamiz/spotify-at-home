import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@tunely/shared";
import { createMockPlayerStore } from "@tunely/app/player/playerStore";
import { filterCatalog } from "@tunely/app/search/filterCatalog";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

async function readAppFile(path: string) {
  return readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("Phase 1 UI shell", () => {
  it("wires Home to the header, greeting, import action, and playlist shortcuts", async () => {
    const routeSource = await readAppFile("app/index.tsx");
    const homeScreenSource = await readAppFile("src/screens/HomeScreen.tsx");

    expect(routeSource).toContain("HomeScreen");
    expect(homeScreenSource).toContain("AppHeader");
    expect(homeScreenSource).toContain("Good afternoon");
    expect(homeScreenSource).toContain('variant="import"');
    expect(homeScreenSource).toContain("PlaylistShortcut");
    expect(homeScreenSource).toContain("mockPlaylists");
    expect(APP_NAME).toBe("Tunely");
    expect(appRoot).toContain("apps/app/");
  });

  it("provides bottom tabs for narrow screens and a sidebar for wide screens", async () => {
    const shellSource = await readAppFile("src/components/AppShell.tsx");
    const tokensSource = await readAppFile("src/theme/tokens.ts");

    expect(shellSource).toContain("useWindowDimensions");
    expect(shellSource).toContain("BottomTabs");
    expect(shellSource).toContain("Sidebar");
    expect(shellSource).toContain("WEB_SIDEBAR_BREAKPOINT");
    expect(tokensSource).toContain("WEB_SIDEBAR_BREAKPOINT");
  });

  it("wires Library to the empty state and import action", async () => {
    const routeSource = await readAppFile("app/library.tsx");
    const librarySource = await readAppFile("src/screens/LibraryScreen.tsx");
    const emptyPanelSource = await readAppFile("src/components/EmptyLibraryPanel.tsx");

    expect(routeSource).toContain("LibraryScreen");
    expect(emptyPanelSource).toContain("No songs yet");
    expect(librarySource).toContain("EmptyLibraryPanel");
    expect(librarySource).toContain("ImportButton");
    expect(librarySource).toContain("mockLibrarySongs.length === 0");
  });

  it("filters songs and playlists by local query text", () => {
    expect(filterCatalog("deep")).toEqual([
      { id: "playlist-deep-focus", kind: "playlist", title: "Deep Focus", subtitle: "Keep calm and concentrate" }
    ]);

    expect(filterCatalog("moon")).toEqual([
      { id: "song-moonlit", kind: "song", title: "Moonlit Arcade", subtitle: "Nova Vale" }
    ]);

    expect(filterCatalog("")).toEqual([]);
  });

  it("models an empty and selected mini-player state", () => {
    const player = createMockPlayerStore();

    expect(player.getCurrentTrack()).toBeNull();
    expect(player.getMiniPlayerLabel()).toBeNull();

    player.selectTrack("song-moonlit");

    expect(player.getCurrentTrack()?.title).toBe("Moonlit Arcade");
    expect(player.getMiniPlayerLabel()).toBe("Moonlit Arcade - Nova Vale");
  });
});
