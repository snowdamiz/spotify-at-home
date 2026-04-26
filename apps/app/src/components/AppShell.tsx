import { useState, type PropsWithChildren } from "react";
import { Link, useRouter } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { createPlaylist, playlistSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing, typography, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { MiniPlayer } from "./MiniPlayer";
import { PlaylistArtwork } from "./PlaylistArtwork";

type RouteKey = "home" | "search" | "library";

type AppShellProps = PropsWithChildren<{
  activeRoute?: RouteKey;
  miniPlayerTrackId?: string;
}>;

const navItems: Array<{ key: RouteKey; label: string; icon: string; href: "/" | "/search" | "/library" }> = [
  { key: "home", label: "Home", icon: "⌂", href: "/" },
  { key: "search", label: "Search", icon: "⌕", href: "/search" },
  { key: "library", label: "Library", icon: "▤", href: "/library" }
];

export function AppShell({ activeRoute = "home", children, miniPlayerTrackId }: AppShellProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        {isWide ? <Sidebar activeRoute={activeRoute} /> : null}
        <View style={styles.main}>
          <ScrollView
            contentContainerStyle={StyleSheet.flatten([
              styles.content,
              isWide ? styles.wideContent : styles.narrowContent
            ])}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          <MiniPlayer trackId={miniPlayerTrackId} />
          {!isWide ? <BottomTabs activeRoute={activeRoute} /> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function Sidebar({ activeRoute }: { activeRoute: RouteKey }) {
  const router = useRouter();
  const library = useLibrarySummary();
  const summary = library.summary;
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  async function handleCreatePlaylist() {
    if (creatingPlaylist) {
      return;
    }

    setCreatingPlaylist(true);

    try {
      const result = await createPlaylist({
        name: "New Playlist"
      });

      if (result.status === "authenticated" && result.playlist) {
        router.push(`/playlist/${result.playlist.id}`);
      }
    } catch {
      // Keep the sidebar available if the server rejects creation.
    } finally {
      setCreatingPlaylist(false);
    }
  }

  return (
    <View style={styles.sidebar}>
      <View style={styles.navPanel}>
        {navItems.slice(0, 2).map((item) => (
          <SidebarNavLink active={activeRoute === item.key} item={item} key={item.key} />
        ))}
      </View>
      <View style={styles.libraryPanel}>
        <View style={styles.libraryHeader}>
          <Text style={styles.sidebarHeading}>Your Library</Text>
          <Pressable
            accessibilityLabel="Create playlist"
            accessibilityRole="button"
            disabled={creatingPlaylist}
            onPress={handleCreatePlaylist}
            style={({ pressed }) =>
              StyleSheet.flatten([
                styles.plusButton,
                pressed ? styles.plusButtonPressed : null,
                creatingPlaylist ? styles.disabledButton : null
              ])
            }
          >
            <Text style={styles.plus}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.sidebarSection}>PLAYLISTS</Text>
        <Link href="/playlist/imported-songs" asChild>
          <Pressable style={({ pressed }) => StyleSheet.flatten([styles.sidebarPlaylist, pressed ? styles.sidebarPlaylistPressed : null])}>
            <View style={styles.sidebarSongArt}>
              <Text style={styles.sidebarSongArtText}>♪</Text>
            </View>
            <View style={styles.sidebarPlaylistText}>
              <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                Imported Songs
              </Text>
              <Text style={styles.sidebarPlaylistType}>
                {library.status === "authenticated"
                  ? `Playlist · ${summary.counts.songs} ${summary.counts.songs === 1 ? "song" : "songs"}`
                  : library.status === "loading"
                    ? "Loading"
                    : "Sign in required"}
              </Text>
            </View>
          </Pressable>
        </Link>
        <Link href="/playlist/liked-songs" asChild>
          <Pressable style={({ pressed }) => StyleSheet.flatten([styles.sidebarPlaylist, pressed ? styles.sidebarPlaylistPressed : null])}>
            <View style={StyleSheet.flatten([styles.sidebarSongArt, styles.sidebarLikedArt])}>
              <Text style={styles.sidebarLikedText}>♥</Text>
            </View>
            <View style={styles.sidebarPlaylistText}>
              <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                Liked Songs
              </Text>
              <Text numberOfLines={1} style={styles.sidebarPlaylistType}>
                Playlist · {summary.counts.likedSongs} {summary.counts.likedSongs === 1 ? "song" : "songs"}
              </Text>
            </View>
          </Pressable>
        </Link>
        {summary.playlists.slice(0, 6).map((playlist) => (
          <Link href={`/playlist/${playlist.id}`} asChild key={playlist.id}>
            <Pressable style={({ pressed }) => StyleSheet.flatten([styles.sidebarPlaylist, pressed ? styles.sidebarPlaylistPressed : null])}>
              <PlaylistArtwork playlist={playlist} size={44} />
              <View style={styles.sidebarPlaylistText}>
                <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                  {playlist.name}
                </Text>
                <Text numberOfLines={1} style={styles.sidebarPlaylistType}>
                  Playlist · {playlistSubtitle(playlist)}
                </Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}

function BottomTabs({ activeRoute }: { activeRoute: RouteKey }) {
  return (
    <View style={styles.bottomTabs}>
      {navItems.map((item) => (
        <BottomTabLink active={activeRoute === item.key} item={item} key={item.key} />
      ))}
    </View>
  );
}

function SidebarNavLink({ active, item }: { active: boolean; item: (typeof navItems)[number] }) {
  return (
    <Link href={item.href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={item.label}
        style={({ pressed }) =>
          StyleSheet.flatten([styles.navLink, pressed ? styles.navLinkPressed : null])
        }
      >
        <Text style={StyleSheet.flatten([styles.navIcon, active ? styles.activeText : styles.inactiveText])}>
          {item.icon}
        </Text>
        <Text style={StyleSheet.flatten([styles.navLabel, active ? styles.activeText : styles.inactiveText])}>
          {item.label}
        </Text>
      </Pressable>
    </Link>
  );
}

function BottomTabLink({ active, item }: { active: boolean; item: (typeof navItems)[number] }) {
  return (
    <Link href={item.href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={item.label} style={styles.bottomTab}>
        <Text style={StyleSheet.flatten([styles.bottomTabIcon, active ? styles.activeText : styles.inactiveText])}>
          {item.icon}
        </Text>
        <Text style={StyleSheet.flatten([styles.bottomTabLabel, active ? styles.activeText : styles.inactiveText])}>
          {item.label}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  activeText: {
    color: colors.text
  },
  bottomTab: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    paddingVertical: spacing.sm
  },
  bottomTabIcon: {
    fontSize: 22,
    lineHeight: 24
  },
  bottomTabLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2
  },
  bottomTabs: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs
  },
  content: {
    flexGrow: 1,
    maxWidth: 1280,
    width: "100%"
  },
  disabledButton: {
    opacity: 0.5
  },
  inactiveText: {
    color: colors.muted
  },
  libraryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md
  },
  libraryPanel: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md
  },
  main: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: "hidden"
  },
  narrowContent: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md
  },
  navIcon: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24,
    width: 24
  },
  navLabel: {
    fontSize: 15,
    fontWeight: "700"
  },
  navLink: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.sm
  },
  navLinkPressed: {
    backgroundColor: colors.overlay
  },
  navPanel: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    gap: 4,
    padding: spacing.sm
  },
  plus: {
    color: colors.muted,
    fontSize: 22,
    lineHeight: 22
  },
  plusButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  plusButtonPressed: {
    backgroundColor: colors.overlay
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    flexDirection: "row"
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  sidebar: {
    backgroundColor: colors.background,
    gap: spacing.sm,
    padding: spacing.sm,
    width: 264
  },
  sidebarHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  sidebarLikedArt: {
    backgroundColor: "#3d2c69"
  },
  sidebarLikedText: {
    color: "#dadcff",
    fontSize: 22,
    fontWeight: "900"
  },
  sidebarPlaylist: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  sidebarPlaylistPressed: {
    backgroundColor: colors.overlay
  },
  sidebarPlaylistText: {
    flex: 1,
    minWidth: 0
  },
  sidebarPlaylistTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  sidebarPlaylistType: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  sidebarSection: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: typography.letterSpacingWide,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    textTransform: "uppercase"
  },
  sidebarSongArt: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  sidebarSongArtText: {
    color: colors.green,
    fontSize: 20,
    fontWeight: "900"
  },
  wideContent: {
    padding: spacing.lg
  }
});
