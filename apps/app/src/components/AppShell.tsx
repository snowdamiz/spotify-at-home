import { useState, type PropsWithChildren } from "react";
import { Link, useRouter } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { mockPlaylists } from "../data/mockCatalog";
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

type SidebarPlaylistItem = {
  art: Parameters<typeof PlaylistArtwork>[0]["playlist"];
  href: string;
  subtitle: string;
  title: string;
};

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
      <View style={StyleSheet.flatten([styles.root, isWide ? styles.wideRoot : null])}>
        {isWide ? <Sidebar activeRoute={activeRoute} /> : null}
        <View style={StyleSheet.flatten([styles.main, isWide ? styles.mainPanel : null])}>
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
  const playlistItems: SidebarPlaylistItem[] = summary.playlists.length
    ? [
        {
          art: { color: colors.greenDark, initials: "LS", name: "Liked Songs" },
          href: "/playlist/liked-songs",
          subtitle: "Playlist",
          title: "Liked Songs"
        },
        ...summary.playlists.slice(0, 5).map((playlist) => ({
          art: playlist,
          href: `/playlist/${playlist.id}`,
          subtitle: playlistSubtitle(playlist),
          title: playlist.name
        }))
      ]
    : mockPlaylists.slice(0, 5).map((playlist) => ({
        art: playlist,
        href: `/playlist/${playlist.id}`,
        subtitle: "Playlist",
        title: playlist.title
      }));

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
        {playlistItems.map((playlist) => (
          <Link href={playlist.href} asChild key={playlist.href}>
            <Pressable style={({ pressed }) => StyleSheet.flatten([styles.sidebarPlaylist, pressed ? styles.sidebarPlaylistPressed : null])}>
              <View style={styles.sidebarPlaylistInner}>
                <PlaylistArtwork playlist={playlist.art} size={64} />
                <View style={styles.sidebarPlaylistText}>
                  <Text numberOfLines={1} style={styles.sidebarPlaylistTitle}>
                    {playlist.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.sidebarPlaylistType}>
                    {playlist.subtitle}
                  </Text>
                </View>
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
        <View style={styles.navLinkInner}>
          <Text style={StyleSheet.flatten([styles.navIcon, active ? styles.activeText : styles.inactiveText])}>
            {item.icon}
          </Text>
          <Text style={StyleSheet.flatten([styles.navLabel, active ? styles.activeText : styles.inactiveText])}>
            {item.label}
          </Text>
        </View>
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
    fontSize: 31,
    lineHeight: 34
  },
  bottomTabLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0
  },
  bottomTabs: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  content: {
    flexGrow: 1,
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl
  },
  main: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: "hidden"
  },
  mainPanel: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1
  },
  narrowContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  navIcon: {
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 30,
    width: 36
  },
  navLabel: {
    fontSize: 20,
    fontWeight: "800"
  },
  navLink: {
    borderRadius: radius.md,
    minHeight: 58,
    paddingHorizontal: spacing.md
  },
  navLinkInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    width: "100%"
  },
  navLinkPressed: {
    backgroundColor: colors.overlay
  },
  navPanel: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl
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
    width: 390
  },
  sidebarHeading: {
    color: colors.muted,
    fontSize: 20,
    fontWeight: "800"
  },
  sidebarPlaylist: {
    borderRadius: radius.md,
    minHeight: 82,
    paddingHorizontal: 0,
    paddingVertical: spacing.xs
  },
  sidebarPlaylistInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 72,
    width: "100%"
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
    fontSize: 18,
    fontWeight: "800"
  },
  sidebarPlaylistType: {
    color: colors.muted,
    fontSize: 15,
    marginTop: 6
  },
  sidebarSection: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: typography.letterSpacingWide,
    marginBottom: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xs,
    textTransform: "uppercase"
  },
  wideContent: {
    padding: spacing.xxl
  },
  wideRoot: {
    gap: spacing.sm,
    padding: spacing.sm
  }
});
