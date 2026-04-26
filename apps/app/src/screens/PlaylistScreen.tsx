import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { songSubtitle } from "../library/songsApi";
import { useLibrarySummary, usePlaylist } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const summaryState = useLibrarySummary();
  const playlistState = usePlaylist(id && id !== "imported-songs" && id !== "liked-songs" ? id : undefined);
  const isImportedSongs = id === "imported-songs";
  const isLikedSongs = id === "liked-songs";
  const serverPlaylist = playlistState.status === "authenticated" ? playlistState.playlist : null;
  const title = isImportedSongs
    ? "Imported Songs"
    : isLikedSongs
      ? "Liked Songs"
      : serverPlaylist?.name ?? "Playlist";
  const subtitle = isImportedSongs
    ? "Songs stored privately on your Tunely server"
    : isLikedSongs
      ? "Favorites backed by your private likes"
      : serverPlaylist?.description ?? "Songs arranged in your own order.";
  const tracks = isImportedSongs
    ? summaryState.summary.recentSongs
    : isLikedSongs
      ? summaryState.summary.likedSongs
      : serverPlaylist?.songs ?? [];
  const status = isImportedSongs || isLikedSongs ? summaryState.status : playlistState.status;

  return (
    <AppShell>
      <AppHeader />
      <View style={StyleSheet.flatten([styles.hero, isWide ? styles.desktopHero : null])}>
        <View style={StyleSheet.flatten([styles.artwork, isWide ? styles.desktopArtwork : null])}>
          <Text style={styles.artworkText}>♪</Text>
        </View>
        <View style={styles.heroText}>
          <Text style={styles.type}>Playlist</Text>
          <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.trackList}>
        {status === "loading" ? (
          <Text style={styles.emptyText}>Loading songs from the server...</Text>
        ) : status === "anonymous" ? (
          <Text style={styles.emptyText}>Log in to view server-backed playlists.</Text>
        ) : status === "error" ? (
          <Text style={styles.emptyText}>Could not reach the Tunely server.</Text>
        ) : status === "not-found" ? (
          <Text style={styles.emptyText}>This playlist does not exist on the server.</Text>
        ) : tracks.length ? (
          tracks.map((song) => (
            <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
              <Pressable style={styles.trackRow}>
                <Text style={styles.trackTitle}>{song.title}</Text>
                <Text style={styles.trackArtist}>{songSubtitle(song)}</Text>
              </Pressable>
            </Link>
          ))
        ) : (
          <Text style={styles.emptyText}>No songs here yet.</Text>
        )}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  artwork: {
    alignItems: "center",
    backgroundColor: colors.greenDark,
    borderRadius: radius.lg,
    height: 180,
    justifyContent: "center",
    width: 180
  },
  artworkText: {
    color: colors.green,
    fontSize: 72,
    fontWeight: "900"
  },
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
  desktopArtwork: {
    height: 132,
    width: 132
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
