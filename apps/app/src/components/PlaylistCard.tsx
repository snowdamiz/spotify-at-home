import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { Playlist } from "../data/mockCatalog";
import type { ServerPlaylist } from "../library/songsApi";
import { playlistSubtitle } from "../library/songsApi";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { PlaylistArtwork } from "./PlaylistArtwork";

type PlaylistCardProps = {
  playlist: Playlist | ServerPlaylist;
  style?: StyleProp<ViewStyle>;
};

export function PlaylistCard({ playlist, style }: PlaylistCardProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const title = playlistTitle(playlist);
  const subtitle = playlistDescription(playlist);

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title}
        style={({ pressed }) =>
          StyleSheet.flatten([
            styles.card,
            isWide ? styles.desktopCard : null,
            style,
            pressed ? styles.cardPressed : null
          ])
        }
      >
        <PlaylistArtwork playlist={playlist} size="100%" />
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <Text numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </Text>
      </Pressable>
    </Link>
  );
}

function playlistTitle(playlist: Playlist | ServerPlaylist) {
  return "title" in playlist ? playlist.title : playlist.name;
}

function playlistDescription(playlist: Playlist | ServerPlaylist) {
  return "subtitle" in playlist ? playlist.subtitle : playlist.description ?? playlistSubtitle(playlist);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexBasis: 168,
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.lg
  },
  cardPressed: {
    backgroundColor: colors.cardHover
  },
  desktopCard: {
    flexBasis: 240,
    flexGrow: 0,
    minWidth: 220
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 6
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: spacing.lg
  }
});
