import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { PlaylistShortcut } from "../components/PlaylistShortcut";
import { songSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const library = useLibrarySummary();
  const summary = library.summary;

  return (
    <AppShell activeRoute="home">
      <AppHeader />
      <View style={StyleSheet.flatten([styles.hero, isWide ? styles.desktopHero : null])}>
        <Text style={StyleSheet.flatten([styles.greeting, isWide ? styles.desktopGreeting : null])}>Good afternoon</Text>
        <Text style={StyleSheet.flatten([styles.subtitle, isWide ? styles.desktopSubtitle : null])}>Your music, anywhere you go.</Text>
      </View>
      <View style={StyleSheet.flatten([styles.shortcuts, isWide ? styles.desktopShortcuts : null])}>
        <PlaylistShortcut variant="import" />
        <Link href="/library" asChild>
          <Pressable style={styles.libraryShortcut}>
            <Text style={styles.libraryShortcutTitle}>Imported Songs</Text>
            <Text style={styles.libraryShortcutMeta}>
              {library.status === "authenticated"
                ? `${summary.counts.songs} songs on this server`
                : library.status === "loading"
                  ? "Loading server library"
                  : "Sign in to sync"}
            </Text>
          </Pressable>
        </Link>
        <Link href="/playlist/liked-songs" asChild>
          <Pressable style={styles.libraryShortcut}>
            <Text style={styles.libraryShortcutTitle}>Liked Songs</Text>
            <Text style={styles.libraryShortcutMeta}>
              {summary.counts.likedSongs} {summary.counts.likedSongs === 1 ? "song" : "songs"}
            </Text>
          </Pressable>
        </Link>
        {summary.playlists.slice(0, 4).map((playlist) => (
          <PlaylistShortcut key={playlist.id} playlist={playlist} />
        ))}
      </View>
      <Text style={StyleSheet.flatten([styles.sectionTitle, isWide ? styles.desktopSectionTitle : null])}>Recent imports</Text>
      <View style={StyleSheet.flatten([styles.cards, isWide ? styles.desktopCards : null])}>
        {library.status === "loading" ? (
          <Text style={styles.emptyText}>Loading your server library...</Text>
        ) : library.status === "anonymous" ? (
          <Text style={styles.emptyText}>Log in to see imported songs from your Tunely server.</Text>
        ) : library.status === "error" ? (
          <Text style={styles.emptyText}>Could not reach the Tunely server.</Text>
        ) : summary.recentSongs.length ? (
          summary.recentSongs.slice(0, 8).map((song) => (
            <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
              <Pressable style={styles.songCard}>
                <View style={styles.songArt}>
                  <Text style={styles.songArtText}>♪</Text>
                </View>
                <Text numberOfLines={1} style={styles.songTitle}>
                  {song.title}
                </Text>
                <Text numberOfLines={1} style={styles.songSubtitle}>
                  {songSubtitle(song)}
                </Text>
              </Pressable>
            </Link>
          ))
        ) : (
          <Text style={styles.emptyText}>No imports yet. Add a song to make this page yours.</Text>
        )}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg
  },
  emptyText: {
    color: colors.muted,
    fontSize: 17
  },
  greeting: {
    color: colors.text,
    fontSize: 44,
    fontWeight: "900",
    lineHeight: 50
  },
  desktopCards: {
    gap: spacing.md
  },
  desktopGreeting: {
    fontSize: 32,
    lineHeight: 38
  },
  desktopHero: {
    marginTop: spacing.lg
  },
  desktopSectionTitle: {
    fontSize: 24,
    marginBottom: spacing.md,
    marginTop: spacing.xl
  },
  desktopShortcuts: {
    gap: spacing.sm,
    marginTop: spacing.xl
  },
  desktopSubtitle: {
    fontSize: 16,
    marginTop: spacing.xs
  },
  hero: {
    marginTop: spacing.xl
  },
  libraryShortcut: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    flexBasis: 220,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 88,
    padding: spacing.md
  },
  libraryShortcutMeta: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs
  },
  libraryShortcutTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900"
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: spacing.lg,
    marginTop: spacing.xxl
  },
  songArt: {
    alignItems: "center",
    backgroundColor: colors.greenDark,
    borderRadius: radius.md,
    height: 132,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: "100%"
  },
  songArtText: {
    color: colors.green,
    fontSize: 54,
    fontWeight: "900"
  },
  songCard: {
    flexBasis: 168,
    flexGrow: 1,
    maxWidth: 220,
    minWidth: 148
  },
  songSubtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs
  },
  songTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800"
  },
  shortcuts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xl
  },
  subtitle: {
    color: colors.muted,
    fontSize: 22,
    marginTop: spacing.md
  }
});
