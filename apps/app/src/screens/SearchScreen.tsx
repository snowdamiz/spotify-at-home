import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { browseCategories } from "../data/mockCatalog";
import { filterCatalog } from "../search/filterCatalog";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const results = useMemo(() => filterCatalog(query), [query]);

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
          {results.length ? (
            results.map((result) => (
              <View key={`${result.kind}-${result.id}`} style={styles.resultRow}>
                <View style={styles.resultArt}>
                  <Text style={styles.resultKind}>{result.kind === "playlist" ? "P" : "S"}</Text>
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle}>{result.title}</Text>
                  <Text style={styles.resultSubtitle}>{result.subtitle}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No local matches yet</Text>
          )}
        </View>
      ) : (
        <>
          <Text style={StyleSheet.flatten([styles.sectionTitle, isWide ? styles.desktopSectionTitle : null])}>Browse all</Text>
          <View style={StyleSheet.flatten([styles.categories, isWide ? styles.desktopCategories : null])}>
            {browseCategories.map((category) => (
              <View key={category.id} style={StyleSheet.flatten([styles.category, isWide ? styles.desktopCategory : null, { backgroundColor: category.colors[0] }])}>
                <Text style={StyleSheet.flatten([styles.categoryTitle, isWide ? styles.desktopCategoryTitle : null])}>{category.title}</Text>
                <View style={StyleSheet.flatten([styles.tiltedTile, { backgroundColor: category.colors[1] }])}>
                  <Text style={styles.categoryInitial}>{category.title.slice(0, 1)}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  categories: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg
  },
  category: {
    borderRadius: radius.md,
    flexBasis: 176,
    flexGrow: 1,
    height: 132,
    maxWidth: 340,
    minWidth: 150,
    overflow: "hidden",
    padding: spacing.lg
  },
  categoryInitial: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
  },
  categoryTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900"
  },
  desktopCategories: {
    gap: spacing.md
  },
  desktopCategory: {
    flexBasis: 156,
    height: 104,
    maxWidth: 240,
    padding: spacing.md
  },
  desktopCategoryTitle: {
    fontSize: 19
  },
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
  tiltedTile: {
    alignItems: "center",
    borderRadius: radius.md,
    bottom: -28,
    height: 82,
    justifyContent: "center",
    position: "absolute",
    right: -18,
    transform: [{ rotate: "18deg" }],
    width: 82
  },
  title: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
    marginTop: spacing.xxl
  }
});
