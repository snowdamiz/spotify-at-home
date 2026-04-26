import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { PlaylistArtwork } from "../components/PlaylistArtwork";
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
  const artworkColor = isLikedSongs ? "#3d2c69" : isImportedSongs ? colors.greenDark : serverPlaylist?.color ?? colors.greenDark;
  const artworkInitials = isLikedSongs ? "♥" : isImportedSongs ? "♪" : undefined;

  return (
    <AppShell>
      <AppHeader />
      <View style={StyleSheet.flatten([styles.hero, isWide ? styles.desktopHero : null])}>
        <PlaylistArtwork
          playlist={{
            color: artworkColor,
            initials: artworkInitials,
            name: title
          }}
          size={isWide ? 144 : 132}
        />
        <View style={styles.heroText}>
          <Text style={styles.eyebrow}>Playlist</Text>
          <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
          <Text style={styles.meta}>
            {tracks.length} {tracks.length === 1 ? "song" : "songs"}
          </Text>
        </View>
      </View>
      <View style={styles.trackList}>
        {status === "loading" ? (
          <Text style={styles.emptyText}>Loading songs from the server…</Text>
        ) : status === "anonymous" ? (
          <Text style={styles.emptyText}>Log in to view server-backed playlists.</Text>
        ) : status === "error" ? (
          <Text style={styles.emptyText}>Could not reach the Tunely server.</Text>
        ) : status === "not-found" ? (
          <Text style={styles.emptyText}>This playlist does not exist on the server.</Text>
        ) : tracks.length ? (
          tracks.map((song, index) => (
            <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Play ${song.title}`}
                style={({ pressed }) =>
                  StyleSheet.flatten([styles.trackRow, pressed ? styles.trackRowPressed : null])
                }
              >
                <Text style={styles.trackIndex}>{index + 1}</Text>
                <View style={styles.trackText}>
                  <Text numberOfLines={1} style={styles.trackTitle}>
                    {song.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.trackArtist}>
                    {songSubtitle(song)}
                  </Text>
                </View>
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
  desktopHero: {
    alignItems: "flex-end",
    marginTop: spacing.lg
  },
  desktopTitle: {
    fontSize: 44,
    lineHeight: 50
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xl
  },
  eyebrow: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  hero: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    marginTop: spacing.lg
  },
  heroText: {
    flex: 1,
    gap: 6,
    minWidth: 220
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 38
  },
  trackArtist: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2
  },
  trackIndex: {
    color: colors.muted,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    minWidth: 22,
    textAlign: "right"
  },
  trackList: {
    gap: 2,
    marginTop: spacing.xl
  },
  trackRow: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  trackRowPressed: {
    backgroundColor: colors.overlay
  },
  trackText: {
    flex: 1,
    minWidth: 0
  },
  trackTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  }
});
