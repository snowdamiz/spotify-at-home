import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { EmptyLibraryPanel } from "../components/EmptyLibraryPanel";
import { ImportButton } from "../components/ImportButton";
import { PlaylistCard } from "../components/PlaylistCard";
import { songSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function LibraryScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const library = useLibrarySummary();
  const summary = library.summary;

  return (
    <AppShell activeRoute="library">
      <AppHeader />
      <View style={StyleSheet.flatten([styles.titleRow, isWide ? styles.desktopTitleRow : null])}>
        <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>Your Library</Text>
        <ImportButton compact />
      </View>
      {library.status === "loading" ? (
        <Text style={styles.statusText}>Loading your server library...</Text>
      ) : library.status === "anonymous" ? (
        <Text style={styles.statusText}>Log in to view imported songs stored on your Tunely server.</Text>
      ) : library.status === "error" ? (
        <Text style={styles.statusText}>Could not reach the Tunely server.</Text>
      ) : summary.isEmpty ? (
        <EmptyLibraryPanel />
      ) : (
        <View>
          <Text style={styles.sectionTitle}>Playlists</Text>
          <View style={styles.playlists}>
            <Link href="/playlist/liked-songs" asChild>
              <Pressable style={styles.systemPlaylist}>
                <Text style={styles.systemPlaylistTitle}>Liked Songs</Text>
                <Text style={styles.systemPlaylistMeta}>
                  {summary.counts.likedSongs} {summary.counts.likedSongs === 1 ? "song" : "songs"}
                </Text>
              </Pressable>
            </Link>
            {summary.playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </View>
          {summary.likedSongs.length ? (
            <>
              <Text style={styles.sectionTitle}>Liked Songs</Text>
              {summary.likedSongs.map((song) => (
                <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
                  <Pressable style={styles.songRow}>
                    <Text numberOfLines={1} style={styles.song}>
                      {song.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.songMeta}>
                      {songSubtitle(song)}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </>
          ) : null}
          <Text style={styles.sectionTitle}>Imported Songs</Text>
          <Text style={styles.countText}>
            {summary.counts.songs} {summary.counts.songs === 1 ? "song" : "songs"} in your private library
          </Text>
          {summary.recentSongs.map((song) => (
            <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
              <Pressable style={styles.songRow}>
                <Text numberOfLines={1} style={styles.song}>
                  {song.title}
                </Text>
                <Text numberOfLines={1} style={styles.songMeta}>
                  {songSubtitle(song)}
                </Text>
              </Pressable>
            </Link>
          ))}
        </View>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  song: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  songMeta: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs
  },
  songRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.md
  },
  countText: {
    color: colors.muted,
    fontSize: 14,
    marginBottom: spacing.sm
  },
  playlists: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.xl
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: spacing.md,
    marginTop: spacing.xl
  },
  statusText: {
    color: colors.muted,
    fontSize: 18,
    marginTop: spacing.xl
  },
  systemPlaylist: {
    backgroundColor: colors.greenDark,
    borderRadius: radius.md,
    flexBasis: 168,
    flexGrow: 1,
    justifyContent: "flex-end",
    maxWidth: 280,
    minHeight: 180,
    minWidth: 150,
    padding: spacing.md
  },
  systemPlaylistMeta: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs
  },
  systemPlaylistTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
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
