import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { EmptyLibraryPanel } from "../components/EmptyLibraryPanel";
import { ImportButton } from "../components/ImportButton";
import { PlaylistArtwork } from "../components/PlaylistArtwork";
import { PlaylistCard } from "../components/PlaylistCard";
import { songSubtitle } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { colors, radius, spacing } from "../theme/tokens";

export function LibraryScreen() {
  const library = useLibrarySummary();
  const summary = library.summary;

  return (
    <AppShell activeRoute="library">
      <AppHeader />
      <View style={styles.titleRow}>
        <Text style={styles.title}>Your Library</Text>
        <ImportButton compact />
      </View>
      {library.status === "loading" ? (
        <Text style={styles.statusText}>Loading your server library…</Text>
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
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open Liked Songs"
                style={({ pressed }) =>
                  StyleSheet.flatten([styles.systemPlaylist, pressed ? styles.systemPlaylistPressed : null])
                }
              >
                <View style={styles.systemArt}>
                  <Text style={styles.systemArtIcon}>♥</Text>
                </View>
                <Text numberOfLines={1} style={styles.systemPlaylistTitle}>
                  Liked Songs
                </Text>
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
              <View style={styles.songList}>
                {summary.likedSongs.map((song) => (
                  <SongRow key={song.id} song={song} />
                ))}
              </View>
            </>
          ) : null}
          <Text style={styles.sectionTitle}>Imported Songs</Text>
          <Text style={styles.countText}>
            {summary.counts.songs} {summary.counts.songs === 1 ? "song" : "songs"} in your private library
          </Text>
          <View style={styles.songList}>
            {summary.recentSongs.map((song) => (
              <SongRow key={song.id} song={song} />
            ))}
          </View>
        </View>
      )}
    </AppShell>
  );
}

function SongRow({ song }: { song: ReturnType<typeof useLibrarySummary>["summary"]["recentSongs"][number] }) {
  return (
    <Link href={`/now-playing?id=${song.id}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Play ${song.title}`}
        style={({ pressed }) =>
          StyleSheet.flatten([styles.songRow, pressed ? styles.songRowPressed : null])
        }
      >
        <PlaylistArtwork playlist={{ name: song.title, color: colors.cardRaised }} size={44} />
        <View style={styles.songText}>
          <Text numberOfLines={1} style={styles.song}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={styles.songMeta}>
            {songSubtitle(song)}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  countText: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: spacing.sm
  },
  playlists: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.lg
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.md,
    marginTop: spacing.lg
  },
  song: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  songList: {
    gap: 2
  },
  songMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2
  },
  songRow: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  songRowPressed: {
    backgroundColor: colors.overlay
  },
  songText: {
    flex: 1,
    minWidth: 0
  },
  statusText: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.lg
  },
  systemArt: {
    alignItems: "center",
    backgroundColor: "#3d2c69",
    borderRadius: radius.md,
    height: 92,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: "100%"
  },
  systemArtIcon: {
    color: "#dadcff",
    fontSize: 44,
    fontWeight: "900"
  },
  systemPlaylist: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    flexBasis: 168,
    flexGrow: 1,
    maxWidth: 220,
    minWidth: 148,
    padding: spacing.md
  },
  systemPlaylistMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4
  },
  systemPlaylistPressed: {
    backgroundColor: colors.cardHover
  },
  systemPlaylistTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.md
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg
  }
});
