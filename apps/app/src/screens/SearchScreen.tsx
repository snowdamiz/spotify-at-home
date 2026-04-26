import { useState } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { browseCategories } from "../data/mockCatalog";
import { playlistSubtitle, songSubtitle } from "../library/songsApi";
import { useLibrarySearch } from "../library/useSongs";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const search = useLibrarySearch(query);
  const resultCount = search.results.playlists.length + search.results.songs.length;
  const trimmedQuery = query.trim();

  return (
    <AppShell activeRoute="search">
      <AppHeader />
      <Text style={styles.title}>Search</Text>
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search Tunely"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="What do you want to listen to?"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.input}
          value={query}
        />
        {trimmedQuery ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            onPress={() => setQuery("")}
            style={({ pressed }) =>
              StyleSheet.flatten([styles.clearButton, pressed ? styles.clearButtonPressed : null])
            }
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {trimmedQuery ? (
        <View style={styles.results}>
          <Text style={styles.sectionTitle}>Results</Text>
          {search.status === "loading" ? (
            <Text style={styles.emptyText}>Searching your server library…</Text>
          ) : search.status === "anonymous" ? (
            <Text style={styles.emptyText}>Log in to search imported songs and playlists.</Text>
          ) : search.status === "error" ? (
            <Text style={styles.emptyText}>Could not reach the Tunely server.</Text>
          ) : resultCount ? (
            <>
              {search.results.playlists.map((playlist) => (
                <Link href={`/playlist/${playlist.id}`} asChild key={playlist.id}>
                  <Pressable
                    accessibilityRole="link"
                    style={({ pressed }) =>
                      StyleSheet.flatten([styles.resultRow, pressed ? styles.resultRowPressed : null])
                    }
                  >
                    <View
                      style={StyleSheet.flatten([
                        styles.resultArt,
                        playlist.color ? { backgroundColor: playlist.color } : null
                      ])}
                    >
                      <Text style={styles.resultKind}>P</Text>
                    </View>
                    <View style={styles.resultText}>
                      <Text numberOfLines={1} style={styles.resultTitle}>
                        {playlist.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.resultSubtitle}>
                        Playlist · {playlist.description ?? playlistSubtitle(playlist)}
                      </Text>
                    </View>
                  </Pressable>
                </Link>
              ))}
              {search.results.songs.map((song) => (
                <Link href={`/now-playing?id=${song.id}`} asChild key={song.id}>
                  <Pressable
                    accessibilityRole="link"
                    style={({ pressed }) =>
                      StyleSheet.flatten([styles.resultRow, pressed ? styles.resultRowPressed : null])
                    }
                  >
                    <View style={styles.resultArt}>
                      <Text style={styles.resultKind}>♪</Text>
                    </View>
                    <View style={styles.resultText}>
                      <Text numberOfLines={1} style={styles.resultTitle}>
                        {song.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.resultSubtitle}>
                        Song · {songSubtitle(song)}
                      </Text>
                    </View>
                  </Pressable>
                </Link>
              ))}
            </>
          ) : (
            <Text style={styles.emptyText}>No results for “{trimmedQuery}”.</Text>
          )}
        </View>
      ) : (
        <View style={styles.results}>
          <Text style={styles.sectionTitle}>Browse all</Text>
          <View style={styles.browseGrid}>
            {browseCategories.map((category) => (
              <View
                accessible
                accessibilityLabel={category.title}
                key={category.id}
                style={StyleSheet.flatten([
                  styles.browseCard,
                  isWide ? styles.desktopBrowseCard : null,
                  { backgroundColor: category.colors[0] }
                ])}
              >
                <Text style={styles.browseTitle}>{category.title}</Text>
                <Text style={styles.browseGlyph}>{category.title.slice(0, 1)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  browseCard: {
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 140,
    overflow: "hidden",
    padding: spacing.md
  },
  browseGlyph: {
    bottom: -8,
    color: "rgba(255,255,255,0.3)",
    fontSize: 80,
    fontWeight: "900",
    lineHeight: 80,
    position: "absolute",
    right: -4,
    transform: [{ rotate: "20deg" }]
  },
  browseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  browseTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  clearButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  clearButtonPressed: {
    backgroundColor: colors.overlay
  },
  clearText: {
    color: colors.muted,
    fontSize: 14
  },
  desktopBrowseCard: {
    flexBasis: "23%",
    minWidth: 160
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minWidth: 0
  },
  resultArt: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  resultKind: {
    color: colors.green,
    fontSize: 18,
    fontWeight: "900"
  },
  resultRow: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  resultRowPressed: {
    backgroundColor: colors.overlay
  },
  resultSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2
  },
  resultText: {
    flex: 1,
    minWidth: 0
  },
  resultTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  results: {
    marginTop: spacing.lg
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    minHeight: 44,
    paddingHorizontal: spacing.md
  },
  searchIcon: {
    color: colors.muted,
    fontSize: 18
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.md
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: spacing.lg
  }
});
