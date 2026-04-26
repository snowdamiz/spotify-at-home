import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import type { ServerPlaylist } from "../library/songsApi";
import { playlistSubtitle } from "../library/songsApi";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { PlaylistArtwork } from "./PlaylistArtwork";

type PlaylistCardProps = {
  playlist: ServerPlaylist;
};

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={playlist.name}
        style={({ pressed }) =>
          StyleSheet.flatten([
            styles.card,
            isWide ? styles.desktopCard : null,
            pressed ? styles.cardPressed : null
          ])
        }
      >
        <PlaylistArtwork playlist={playlist} size="100%" />
        <Text numberOfLines={1} style={styles.title}>
          {playlist.name}
        </Text>
        <Text numberOfLines={2} style={styles.subtitle}>
          {playlist.description ?? playlistSubtitle(playlist)}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    flexBasis: 168,
    flexGrow: 1,
    maxWidth: 280,
    minWidth: 150,
    padding: spacing.md
  },
  cardPressed: {
    backgroundColor: colors.cardHover
  },
  desktopCard: {
    flexBasis: 168,
    maxWidth: 220,
    minWidth: 148
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.md
  }
});
