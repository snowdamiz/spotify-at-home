import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { Playlist } from "../data/mockCatalog";
import type { ServerPlaylist } from "../library/songsApi";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { ImportButton } from "./ImportButton";
import { PlaylistArtwork } from "./PlaylistArtwork";

type PlaylistShortcutProps = {
  playlist?: Playlist | ServerPlaylist;
  style?: StyleProp<ViewStyle>;
  variant?: "import" | "playlist";
};

export function PlaylistShortcut({ playlist, style, variant = "playlist" }: PlaylistShortcutProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const artworkSize = isWide ? 80 : 96;

  if (variant === "import") {
    return (
      <View style={StyleSheet.flatten([styles.shortcut, isWide ? styles.desktopShortcut : null, style])}>
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

  const title = playlistTitle(playlist);

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title}
        style={({ pressed }) =>
          StyleSheet.flatten([
            styles.shortcut,
            isWide ? styles.desktopShortcut : null,
            style,
            pressed ? styles.shortcutPressed : null
          ])
        }
      >
        <PlaylistArtwork playlist={playlist} size={artworkSize} />
        <Text numberOfLines={2} style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
          {title}
        </Text>
      </Pressable>
    </Link>
  );
}

function playlistTitle(playlist: Playlist | ServerPlaylist) {
  return "title" in playlist ? playlist.title : playlist.name;
}

const styles = StyleSheet.create({
  desktopShortcut: {
    minWidth: 280
  },
  desktopTitle: {
    fontSize: 24
  },
  importPane: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.greenDark,
    justifyContent: "center"
  },
  shortcut: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing.lg,
    minHeight: 80,
    overflow: "hidden",
    paddingRight: spacing.xl,
    width: "100%"
  },
  shortcutPressed: {
    backgroundColor: colors.cardHover
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 21,
    fontWeight: "900",
    minWidth: 0
  }
});
