import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { PlaylistArtwork } from "../components/PlaylistArtwork";
import { PlaylistShortcut } from "../components/PlaylistShortcut";
import { songSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const library = useLibrarySummary();
  const summary = library.summary;
  const greeting = greetingForHour(new Date().getHours());

  return (
    <AppShell activeRoute="home">
      <AppHeader />
      <View style={styles.hero}>
        <Text style={StyleSheet.flatten([styles.greeting, isWide ? styles.desktopGreeting : null])}>{greeting}</Text>
        <Text style={styles.subtitle}>Your music, anywhere you go.</Text>
      </View>
      <View style={styles.shortcuts}>
        <PlaylistShortcut variant="import" />
        <Link href="/playlist/imported-songs" asChild>
          <Pressable
            accessibilityRole="link"
            style={({ pressed }) =>
              StyleSheet.flatten([
                styles.shortcutCard,
                isWide ? styles.desktopShortcutCard : styles.mobileShortcutCard,
                pressed ? styles.shortcutCardPressed : null
              ])
            }
          >
            <View style={StyleSheet.flatten([styles.shortcutArt, styles.importedArt])}>
              <Text style={styles.importedArtText}>♪</Text>
            </View>
            <View style={styles.shortcutTextWrap}>
              <Text numberOfLines={1} style={styles.shortcutTitle}>
                Imported Songs
              </Text>
              <Text numberOfLines={1} style={styles.shortcutMeta}>
                {library.status === "authenticated"
                  ? `${summary.counts.songs} ${summary.counts.songs === 1 ? "song" : "songs"}`
                  : library.status === "loading"
                    ? "Loading…"
                    : "Sign in to sync"}
              </Text>
            </View>
          </Pressable>
        </Link>
        <Link href="/playlist/liked-songs" asChild>
          <Pressable
            accessibilityRole="link"
            style={({ pressed }) =>
              StyleSheet.flatten([
                styles.shortcutCard,
                isWide ? styles.desktopShortcutCard : styles.mobileShortcutCard,
                pressed ? styles.shortcutCardPressed : null
              ])
            }
          >
            <View style={StyleSheet.flatten([styles.shortcutArt, styles.likedArt])}>
              <Text style={styles.likedArtText}>♥</Text>
            </View>
            <View style={styles.shortcutTextWrap}>
              <Text numberOfLines={1} style={styles.shortcutTitle}>
                Liked Songs
              </Text>
              <Text numberOfLines={1} style={styles.shortcutMeta}>
                {summary.counts.likedSongs} {summary.counts.likedSongs === 1 ? "song" : "songs"}
              </Text>
            </View>
          </Pressable>
        </Link>
        {summary.playlists.slice(0, 5).map((playlist) => (
          <PlaylistShortcut key={playlist.id} playlist={playlist} />
        ))}
      </View>
      <Text style={styles.sectionTitle}>Recent imports</Text>
      <View style={styles.cards}>
        {library.status === "loading" ? (
          <Text style={styles.emptyText}>Loading your server library…</Text>
        ) : library.status === "anonymous" ? (
          <Text style={styles.emptyText}>Log in to see imported songs from your Tunely server.</Text>
        ) : library.status === "error" ? (
          <Text style={styles.emptyText}>Could not reach the Tunely server.</Text>
        ) : summary.recentSongs.length ? (
          summary.recentSongs.slice(0, 8).map((song) => (
            <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Play ${song.title}`}
                style={({ pressed }) =>
                  StyleSheet.flatten([styles.songCard, pressed ? styles.songCardPressed : null])
                }
              >
                <PlaylistArtwork
                  playlist={{ name: song.title, color: colors.greenDark }}
                  size="100%"
                />
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

function greetingForHour(hour: number) {
  if (hour < 5) {
    return "Good evening";
  }

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

const styles = StyleSheet.create({
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  desktopGreeting: {
    fontSize: 32,
    lineHeight: 38
  },
  desktopShortcutCard: {
    width: "32%"
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15
  },
  greeting: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 34
  },
  hero: {
    marginTop: spacing.lg
  },
  importedArt: {
    backgroundColor: colors.greenDark
  },
  importedArtText: {
    color: colors.green,
    fontSize: 22,
    fontWeight: "900"
  },
  likedArt: {
    backgroundColor: "#3d2c69"
  },
  likedArtText: {
    color: "#dadcff",
    fontSize: 22,
    fontWeight: "900"
  },
  mobileShortcutCard: {
    width: "100%"
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: spacing.md,
    marginTop: spacing.xl
  },
  shortcutArt: {
    alignItems: "center",
    alignSelf: "stretch",
    height: 56,
    justifyContent: "center",
    width: 56
  },
  shortcutCard: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 56,
    overflow: "hidden",
    paddingRight: spacing.md
  },
  shortcutCardPressed: {
    backgroundColor: colors.cardHover
  },
  shortcutMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  shortcutTextWrap: {
    flexShrink: 1,
    minWidth: 0
  },
  shortcutTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  shortcuts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  songCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    flexBasis: 168,
    flexGrow: 1,
    maxWidth: 220,
    minWidth: 148,
    padding: spacing.md
  },
  songCardPressed: {
    backgroundColor: colors.cardHover
  },
  songSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4
  },
  songTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.md
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs
  }
});
