import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { EmptyLibraryPanel } from "../components/EmptyLibraryPanel";
import { ImportButton } from "../components/ImportButton";
import { mockLibrarySongs } from "../data/mockCatalog";
import { colors, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function LibraryScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <AppShell activeRoute="library">
      <AppHeader />
      <View style={StyleSheet.flatten([styles.titleRow, isWide ? styles.desktopTitleRow : null])}>
        <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>Your Library</Text>
        <ImportButton compact />
      </View>
      {mockLibrarySongs.length === 0 ? (
        <EmptyLibraryPanel />
      ) : (
        <View>
          {mockLibrarySongs.map((song) => (
            <Text key={song.id} style={styles.song}>
              {song.title}
            </Text>
          ))}
        </View>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  song: {
    color: colors.text,
    fontSize: 18
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 42,
    fontWeight: "900"
  },
  desktopTitle: {
    fontSize: 34
  },
  desktopTitleRow: {
    marginTop: spacing.xl
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xxl
  }
});
