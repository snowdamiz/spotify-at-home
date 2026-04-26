import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { mockSongs } from "../data/mockCatalog";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

const selectedTrack = mockSongs[0];

export function PlayerScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <AppShell miniPlayerTrackId={selectedTrack.id}>
      <AppHeader />
      <View style={StyleSheet.flatten([styles.player, isWide ? styles.desktopPlayer : null])}>
        <View style={StyleSheet.flatten([styles.art, isWide ? styles.desktopArt : null])}>
          <Text style={StyleSheet.flatten([styles.artText, isWide ? styles.desktopArtText : null])}>♪</Text>
        </View>
        <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>{selectedTrack.title}</Text>
        <Text style={styles.artist}>{selectedTrack.artist}</Text>
        <View style={styles.controls}>
          <Text style={styles.control}>‹</Text>
          <Text style={styles.play}>▶</Text>
          <Text style={styles.control}>›</Text>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  art: {
    alignItems: "center",
    backgroundColor: colors.greenDark,
    borderRadius: radius.lg,
    height: 280,
    justifyContent: "center",
    maxWidth: 420,
    width: "100%"
  },
  artist: {
    color: colors.muted,
    fontSize: 20
  },
  artText: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 120
  },
  desktopArt: {
    height: 220,
    maxWidth: 320
  },
  desktopArtText: {
    fontSize: 88
  },
  desktopPlayer: {
    marginTop: spacing.xl
  },
  desktopTitle: {
    fontSize: 26
  },
  control: {
    color: colors.text,
    fontSize: 54
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xl,
    justifyContent: "center",
    marginTop: spacing.xl
  },
  play: {
    color: colors.text,
    fontSize: 46
  },
  player: {
    alignItems: "center",
    marginTop: spacing.xxl
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginTop: spacing.xl,
    textAlign: "center"
  }
});
