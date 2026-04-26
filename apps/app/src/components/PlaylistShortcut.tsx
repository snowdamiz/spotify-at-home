import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { Playlist } from "../data/mockCatalog";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { ImportButton } from "./ImportButton";
import { PlaylistArtwork } from "./PlaylistArtwork";

type PlaylistShortcutProps = {
  playlist?: Playlist;
  variant?: "import" | "playlist";
};

export function PlaylistShortcut({ playlist, variant = "playlist" }: PlaylistShortcutProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const artworkSize = isWide ? 56 : 72;

  if (variant === "import") {
    return (
      <View style={StyleSheet.flatten([styles.shortcut, isWide ? styles.desktopShortcut : null])}>
        <View style={StyleSheet.flatten([styles.importPane, { height: artworkSize, width: artworkSize }])}>
          <ImportButton compact />
        </View>
        <Text numberOfLines={1} style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
          Import songs
        </Text>
      </View>
    );
  }

  if (!playlist) {
    return null;
  }

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      <Pressable style={StyleSheet.flatten([styles.shortcut, isWide ? styles.desktopShortcut : null])}>
        <PlaylistArtwork playlist={playlist} size={artworkSize} />
        <Text numberOfLines={1} style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
          {playlist.title}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  importPane: {
    alignItems: "center",
    backgroundColor: colors.greenDark,
    borderBottomLeftRadius: radius.md,
    borderTopLeftRadius: radius.md,
    justifyContent: "center"
  },
  shortcut: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    flexBasis: "48%",
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.md,
    minHeight: 72,
    overflow: "hidden",
    paddingRight: spacing.lg
  },
  desktopShortcut: {
    flexBasis: "32%",
    minHeight: 56
  },
  desktopTitle: {
    fontSize: 16
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 20,
    fontWeight: "800"
  }
});
