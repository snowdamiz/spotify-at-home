import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function SettingsScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <AppShell>
      <AppHeader />
      <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>Settings</Text>
      <View style={styles.panel}>
        <Text style={styles.rowTitle}>Account</Text>
        <Text style={styles.rowBody}>Sign in with Google will arrive in Phase 2.</Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.rowTitle}>Storage</Text>
        <Text style={styles.rowBody}>Imported music will sync through your self-hosted Tunely server.</Text>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.lg
  },
  rowBody: {
    color: colors.muted,
    fontSize: 17,
    marginTop: spacing.xs
  },
  rowTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  title: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
    marginBottom: spacing.lg,
    marginTop: spacing.xxl
  },
  desktopTitle: {
    fontSize: 34,
    marginTop: spacing.xl
  }
});
