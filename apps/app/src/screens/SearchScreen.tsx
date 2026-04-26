import { useState } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { playlistSubtitle, songSubtitle } from "../library/songsApi";
import { useLibrarySearch } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const search = useLibrarySearch(query);
  const resultCount = search.results.playlists.length + search.results.songs.length;

  return (
    <AppShell activeRoute="search">
      <AppHeader />
      <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>Search</Text>
      <View style={StyleSheet.flatten([styles.searchBox, isWide ? styles.desktopSearchBox : null])}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search Tunely"
          onChangeText={setQuery}
          placeholder="What do you want to listen to?"
          placeholderTextColor={colors.muted}
          style={StyleSheet.flatten([styles.input, isWide ? styles.desktopInput : null])}
          value={query}
        />
      </View>
      {query.trim() ? (
        <View style={styles.results}>
          <Text style={StyleSheet.flatten([styles.sectionTitle, isWide ? styles.desktopSectionTitle : null])}>Results</Text>
          {search.status === "loading" ? (
            <Text style={styles.emptyText}>Searching your server library...</Text>
          ) : search.status === "anonymous" ? (
            <Text style={styles.emptyText}>Log in to search imported songs and playlists.</Text>
          ) : search.status === "error" ? (
            <Text style={styles.emptyText}>Could not reach the Tunely server.</Text>
          ) : resultCount ? (
            <>
              {search.results.playlists.map((playlist) => (
                <Link href={`/playlist/${playlist.id}`} asChild key={playlist.id}>
                  <Pressable style={styles.resultRow}>
                    <View style={StyleSheet.flatten([styles.resultArt, playlist.color ? { backgroundColor: playlist.color } : null])}>
                      <Text style={styles.resultKind}>P</Text>
                    </View>
                    <View style={styles.resultText}>
                      <Text style={styles.resultTitle}>{playlist.name}</Text>
                      <Text style={styles.resultSubtitle}>{playlist.description ?? playlistSubtitle(playlist)}</Text>
                    </View>
                  </Pressable>
                </Link>
              ))}
              {search.results.songs.map((song) => (
                <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
                  <Pressable style={styles.resultRow}>
                    <View style={styles.resultArt}>
                      <Text style={styles.resultKind}>S</Text>
                    </View>
                    <View style={styles.resultText}>
                      <Text style={styles.resultTitle}>{song.title}</Text>
                      <Text style={styles.resultSubtitle}>{songSubtitle(song)}</Text>
                    </View>
                  </Pressable>
                </Link>
              ))}
            </>
          ) : (
            <Text style={styles.emptyText}>No server matches yet</Text>
          )}
        </View>
      ) : (
        <View style={styles.results}>
          <Text style={StyleSheet.flatten([styles.sectionTitle, isWide ? styles.desktopSectionTitle : null])}>Browse your library</Text>
          <Link href="/library" asChild>
            <Pressable style={styles.resultRow}>
              <View style={styles.resultArt}>
                <Text style={styles.resultKind}>♪</Text>
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultTitle}>Imported Songs</Text>
                <Text style={styles.resultSubtitle}>Search your private songs and playlists</Text>
              </View>
            </Pressable>
          </Link>
          <Link href="/playlist/liked-songs" asChild>
            <Pressable style={styles.resultRow}>
              <View style={styles.resultArt}>
                <Text style={styles.resultKind}>♥</Text>
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultTitle}>Liked Songs</Text>
                <Text style={styles.resultSubtitle}>Your saved favorites</Text>
              </View>
            </Pressable>
          </Link>
        </View>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  desktopInput: {
    fontSize: 17
  },
  desktopSearchBox: {
    minHeight: 52
  },
  desktopSectionTitle: {
    fontSize: 24,
    marginBottom: spacing.md,
    marginTop: spacing.xl
  },
  desktopTitle: {
    fontSize: 34,
    marginTop: spacing.xl
  },
  emptyText: {
    color: colors.muted,
    fontSize: 18
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 20,
    minWidth: 0
  },
  resultArt: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    height: 56,
    justifyContent: "center",
    width: 56
  },
  resultKind: {
    color: colors.green,
    fontSize: 20,
    fontWeight: "900"
  },
  resultRow: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md
  },
  resultSubtitle: {
    color: colors.muted,
    fontSize: 16
  },
  resultText: {
    flex: 1,
    minWidth: 0
  },
  resultTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800"
  },
  results: {
    marginTop: spacing.xl
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xl,
    minHeight: 64,
    paddingHorizontal: spacing.lg
  },
  searchIcon: {
    color: colors.muted,
    fontSize: 34
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
    marginBottom: spacing.lg,
    marginTop: spacing.xl
  },
  title: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
    marginTop: spacing.xxl
  }
});
