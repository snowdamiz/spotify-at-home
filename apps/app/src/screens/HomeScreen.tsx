import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { ViewStyle } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { ImportButton } from "../components/ImportButton";
import { PlaylistArtwork } from "../components/PlaylistArtwork";
import { PlaylistCard } from "../components/PlaylistCard";
import { PlaylistShortcut } from "../components/PlaylistShortcut";
import { mockPlaylists } from "../data/mockCatalog";
import { songSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const library = useLibrarySummary();
  const summary = library.summary;
  const greeting = greetingForHour(new Date().getHours());
  const sidebarWidth = isWide ? 390 : 0;
  const shellChromeWidth = isWide ? spacing.sm * 3 : spacing.lg * 2;
  const estimatedContentWidth = Math.max(320, Math.min(width - sidebarWidth - shellChromeWidth, 1360));
  const quickColumnCount = isWide ? (estimatedContentWidth >= 760 ? 3 : 2) : 1;
  const recommendationColumnCount = estimatedContentWidth >= 1040 ? 4 : estimatedContentWidth >= 620 ? 2 : 1;
  const quickCardWidth: ViewStyle["width"] = isWide
    ? Math.floor((estimatedContentWidth - spacing.sm * (quickColumnCount - 1)) / quickColumnCount)
    : "100%";
  const recommendationCardWidth: ViewStyle["width"] = Math.floor(
    (estimatedContentWidth - spacing.lg * (recommendationColumnCount - 1)) / recommendationColumnCount
  );

  const quickCardStyle = { width: quickCardWidth } as ViewStyle;
  const recommendationCardStyle = { width: recommendationCardWidth } as ViewStyle;

  return (
    <AppShell activeRoute="home">
      <AppHeader />
      <View style={styles.hero}>
        <Text style={StyleSheet.flatten([styles.greeting, isWide ? styles.desktopGreeting : null])}>{greeting}</Text>
        <Text style={styles.subtitle}>Your music, anywhere you go.</Text>
      </View>
      <View style={StyleSheet.flatten([styles.featuredRow, isWide ? styles.featuredRowWide : null])}>
        <PlaylistShortcut style={quickCardStyle} variant="import" />
        {mockPlaylists.slice(0, 5).map((playlist) => (
          <PlaylistShortcut key={playlist.id} playlist={playlist} style={quickCardStyle} />
        ))}
      </View>
      <Text style={styles.sectionTitle}>Made for you</Text>
      <View style={styles.recommendationGrid}>
        {mockPlaylists.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} style={recommendationCardStyle} />
        ))}
      </View>
      {summary.recentSongs.length ? (
        <>
          <Text style={styles.sectionTitle}>Recent imports</Text>
          <View style={styles.cards}>
            {summary.recentSongs.slice(0, 8).map((song) => (
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
            ))}
          </View>
        </>
      ) : library.status === "loading" ? (
        <StatusPanel tone="loading" text="Loading your server library…" />
      ) : library.status === "error" ? (
        <StatusPanel tone="error" text="Could not reach the Tunely server." />
      ) : (
        <View style={styles.emptyLibraryPanel}>
          <Text style={styles.emptyTitle}>Your library is empty</Text>
          <Text style={styles.emptyText}>Import audio files from your device to start listening.</Text>
          <ImportButton compact={false} />
        </View>
      )}
    </AppShell>
  );
}

function StatusPanel({ text, tone }: { text: string; tone: "error" | "loading" | "locked" }) {
  return (
    <View style={styles.statusPanel}>
      <View style={StyleSheet.flatten([styles.statusDot, tone === "error" ? styles.statusDotError : null])} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
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
    fontSize: 46,
    lineHeight: 52
  },
  emptyText: {
    color: colors.muted,
    fontSize: 21,
    lineHeight: 30,
    marginBottom: spacing.lg,
    maxWidth: 560,
    textAlign: "center"
  },
  emptyLibraryPanel: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    width: "100%"
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
    marginBottom: spacing.md,
    textAlign: "center"
  },
  featuredRow: {
    flexDirection: "column",
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  featuredRowWide: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    width: "100%"
  },
  greeting: {
    color: colors.text,
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 44
  },
  hero: {
    marginTop: spacing.xl
  },
  recommendationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 0,
    marginBottom: spacing.lg,
    marginTop: spacing.xxl
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
  },
  statusDot: {
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 8,
    width: 8
  },
  statusDotError: {
    backgroundColor: "#f15d5d"
  },
  statusPanel: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    width: "100%"
  }
});
