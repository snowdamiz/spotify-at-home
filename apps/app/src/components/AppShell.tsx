import type { PropsWithChildren } from "react";
import { Link } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { playlistSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { MiniPlayer } from "./MiniPlayer";

type RouteKey = "home" | "search" | "library";

type AppShellProps = PropsWithChildren<{
  activeRoute?: RouteKey;
  miniPlayerTrackId?: string;
}>;

const navItems: Array<{ key: RouteKey; label: string; icon: string; href: "/" | "/search" | "/library" }> = [
  { key: "home", label: "Home", icon: "⌂", href: "/" },
  { key: "search", label: "Search", icon: "⌕", href: "/search" },
  { key: "library", label: "Library", icon: "▥", href: "/library" }
];

export function AppShell({ activeRoute = "home", children, miniPlayerTrackId }: AppShellProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        {isWide ? <Sidebar activeRoute={activeRoute} /> : null}
        <View style={styles.main}>
          <ScrollView contentContainerStyle={StyleSheet.flatten([styles.content, isWide ? styles.wideContent : styles.narrowContent])}>{children}</ScrollView>
          <MiniPlayer trackId={miniPlayerTrackId} />
          {!isWide ? <BottomTabs activeRoute={activeRoute} /> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function Sidebar({ activeRoute }: { activeRoute: RouteKey }) {
  const library = useLibrarySummary();
  const summary = library.summary;

  return (
    <View style={styles.sidebar}>
      <View style={styles.navPanel}>
        {navItems.slice(0, 2).map((item) => (
          <NavLink active={activeRoute === item.key} item={item} key={item.key} />
        ))}
      </View>
      <View style={styles.libraryPanel}>
        <View style={styles.libraryHeader}>
          <Text style={styles.sidebarHeading}>Your Library</Text>
          <Pressable accessibilityLabel="Create playlist" style={styles.plusButton}>
            <Text style={styles.plus}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.sidebarSection}>PLAYLISTS</Text>
        <Link href="/playlist/imported-songs" asChild>
          <Pressable style={styles.sidebarPlaylist}>
            <View style={styles.sidebarSongArt}>
              <Text style={styles.sidebarSongArtText}>♪</Text>
            </View>
            <View style={styles.sidebarPlaylistText}>
              <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                Imported Songs
              </Text>
              <Text style={styles.sidebarPlaylistType}>
                {library.status === "authenticated"
                  ? `${summary.counts.songs} songs`
                  : library.status === "loading"
                    ? "Loading"
                    : "Sign in required"}
              </Text>
            </View>
          </Pressable>
        </Link>
        <Link href="/playlist/liked-songs" asChild>
          <Pressable style={styles.sidebarPlaylist}>
            <View style={styles.sidebarSongArt}>
              <Text style={styles.sidebarSongArtText}>♥</Text>
            </View>
            <View style={styles.sidebarPlaylistText}>
              <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                Liked Songs
              </Text>
              <Text numberOfLines={1} style={styles.sidebarPlaylistType}>
                {summary.counts.likedSongs} songs
              </Text>
            </View>
          </Pressable>
        </Link>
        {summary.playlists.slice(0, 4).map((playlist) => (
          <Link href={`/playlist/${playlist.id}`} asChild key={playlist.id}>
            <Pressable style={styles.sidebarPlaylist}>
              <View style={StyleSheet.flatten([styles.sidebarSongArt, playlist.color ? { backgroundColor: playlist.color } : null])}>
                <Text style={styles.sidebarSongArtText}>{playlist.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.sidebarPlaylistText}>
                <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                  {playlist.name}
                </Text>
                <Text numberOfLines={1} style={styles.sidebarPlaylistType}>
                  {playlistSubtitle(playlist)}
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
        <NavLink active={activeRoute === item.key} item={item} key={item.key} />
      ))}
    </View>
  );
}

function NavLink({ active, item }: { active: boolean; item: (typeof navItems)[number] }) {
  return (
    <Link href={item.href} asChild>
      <Pressable style={styles.navLink}>
        <Text style={StyleSheet.flatten([styles.navIcon, active ? styles.activeText : styles.inactiveText])}>{item.icon}</Text>
        <Text style={StyleSheet.flatten([styles.navLabel, active ? styles.activeText : styles.inactiveText])}>{item.label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  activeText: {
    color: colors.text
  },
  bottomTabs: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    minHeight: 92,
    paddingHorizontal: spacing.md
  },
  content: {
    flexGrow: 1,
    maxWidth: 1280,
    width: "100%"
  },
  inactiveText: {
    color: colors.muted
  },
  libraryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg
  },
  libraryPanel: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    flex: 1,
    padding: spacing.md
  },
  main: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: "hidden"
  },
  narrowContent: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  navIcon: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 26,
    width: 26
  },
  navLabel: {
    fontSize: 15,
    fontWeight: "700"
  },
  navLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.xs
  },
  navPanel: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.md
  },
  plus: {
    color: colors.muted,
    fontSize: 24,
    lineHeight: 24
  },
  plusButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32
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
    color: colors.muted,
    fontSize: 18,
    fontWeight: "800"
  },
  sidebarPlaylist: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs
  },
  sidebarPlaylistText: {
    flex: 1,
    minWidth: 0
  },
  sidebarPlaylistTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  sidebarPlaylistType: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2
  },
  sidebarSection: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: spacing.md,
    textTransform: "uppercase"
  },
  sidebarSongArt: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  sidebarSongArtText: {
    color: colors.green,
    fontSize: 22,
    fontWeight: "900"
  },
  wideContent: {
    padding: spacing.lg
  }
});
