import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { PlaylistCard } from "../components/PlaylistCard";
import { PlaylistShortcut } from "../components/PlaylistShortcut";
import { mockPlaylists } from "../data/mockCatalog";
import { colors, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <AppShell activeRoute="home">
      <AppHeader />
      <View style={StyleSheet.flatten([styles.hero, isWide ? styles.desktopHero : null])}>
        <Text style={StyleSheet.flatten([styles.greeting, isWide ? styles.desktopGreeting : null])}>Good afternoon</Text>
        <Text style={StyleSheet.flatten([styles.subtitle, isWide ? styles.desktopSubtitle : null])}>Your music, anywhere you go.</Text>
      </View>
      <View style={StyleSheet.flatten([styles.shortcuts, isWide ? styles.desktopShortcuts : null])}>
        <PlaylistShortcut variant="import" />
        {mockPlaylists.slice(0, 5).map((playlist) => (
          <PlaylistShortcut key={playlist.id} playlist={playlist} />
        ))}
      </View>
      <Text style={StyleSheet.flatten([styles.sectionTitle, isWide ? styles.desktopSectionTitle : null])}>Made for you</Text>
      <View style={StyleSheet.flatten([styles.cards, isWide ? styles.desktopCards : null])}>
        {mockPlaylists.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} />
        ))}
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
  sectionTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: spacing.lg,
    marginTop: spacing.xxl
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
