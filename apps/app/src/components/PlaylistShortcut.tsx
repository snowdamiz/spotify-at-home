import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { ServerPlaylist } from "../library/songsApi";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { ImportButton } from "./ImportButton";
import { PlaylistArtwork } from "./PlaylistArtwork";

type PlaylistShortcutProps = {
  playlist?: ServerPlaylist;
  variant?: "import" | "playlist";
};

export function PlaylistShortcut({ playlist, variant = "playlist" }: PlaylistShortcutProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const artworkSize = isWide ? 56 : 64;

  if (variant === "import") {
    return (
      <View style={StyleSheet.flatten([styles.shortcut, isWide ? styles.desktopShortcut : null])}>
        <View style={StyleSheet.flatten([styles.importPane, { height: artworkSize, width: artworkSize }])}>
          <ImportButton compact />
        </View>
        <Text numberOfLines={2} style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
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
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={playlist.name}
        style={({ pressed }) =>
          StyleSheet.flatten([
            styles.shortcut,
            isWide ? styles.desktopShortcut : null,
            pressed ? styles.shortcutPressed : null
          ])
        }
      >
        <PlaylistArtwork playlist={playlist} size={artworkSize} />
        <Text numberOfLines={2} style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
          {playlist.name}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  desktopShortcut: {
    width: "32%"
  },
  desktopTitle: {
    fontSize: 14
  },
  importPane: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.greenDark,
    justifyContent: "center"
  },
  shortcut: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 56,
    overflow: "hidden",
    paddingRight: spacing.md,
    width: "100%"
  },
  shortcutPressed: {
    backgroundColor: colors.cardHover
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "700",
    minWidth: 0
  }
});
