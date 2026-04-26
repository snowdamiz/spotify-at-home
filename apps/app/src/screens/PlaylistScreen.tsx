import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { PlaylistArtwork } from "../components/PlaylistArtwork";
import { mockPlaylists, mockSongs } from "../data/mockCatalog";
import { colors, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const playlist = mockPlaylists.find((item) => item.id === id) ?? mockPlaylists[0];
  const songs = mockSongs.filter((song) => song.playlistId === playlist.id);

  return (
    <AppShell>
      <AppHeader />
      <View style={StyleSheet.flatten([styles.hero, isWide ? styles.desktopHero : null])}>
        <PlaylistArtwork playlist={playlist} size={isWide ? 132 : 180} />
        <View style={styles.heroText}>
          <Text style={styles.type}>Playlist</Text>
          <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>{playlist.title}</Text>
          <Text style={styles.subtitle}>{playlist.subtitle}</Text>
        </View>
      </View>
      <View style={styles.trackList}>
        {songs.length ? (
          songs.map((song) => (
            <Link href="/now-playing" asChild key={song.id}>
              <Pressable style={styles.trackRow}>
                <Text style={styles.trackTitle}>{song.title}</Text>
                <Text style={styles.trackArtist}>{song.artist}</Text>
              </Pressable>
            </Link>
          ))
        ) : (
          <Text style={styles.emptyText}>Import a song to fill this playlist.</Text>
        )}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    color: colors.muted,
    fontSize: 18,
    marginTop: spacing.xl
  },
  hero: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xl,
    marginTop: spacing.xxl
  },
  desktopHero: {
    marginTop: spacing.xl
  },
  desktopTitle: {
    fontSize: 36
  },
  heroText: {
    flex: 1,
    minWidth: 220
  },
  subtitle: {
    color: colors.muted,
    fontSize: 20
  },
  title: {
    color: colors.text,
    fontSize: 48,
    fontWeight: "900"
  },
  trackArtist: {
    color: colors.muted,
    fontSize: 16
  },
  trackList: {
    marginTop: spacing.xxl
  },
  trackRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.md
  },
  trackTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  type: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase"
  }
});
