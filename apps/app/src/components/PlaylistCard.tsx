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
      <Pressable style={StyleSheet.flatten([styles.card, isWide ? styles.desktopCard : null])}>
        <PlaylistArtwork playlist={playlist} size="100%" />
        <Text numberOfLines={1} style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
          {playlist.name}
        </Text>
        <Text numberOfLines={2} style={StyleSheet.flatten([styles.subtitle, isWide ? styles.desktopSubtitle : null])}>
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
  desktopCard: {
    flexBasis: 164,
    maxWidth: 220,
    minWidth: 148,
    padding: spacing.md
  },
  desktopSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xs
  },
  desktopTitle: {
    fontSize: 16,
    marginTop: spacing.md
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    marginTop: spacing.xs
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: spacing.md
  }
});
