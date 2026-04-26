import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { logout, startGoogleSignIn } from "../auth/session";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function SettingsScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const { user, setUser } = useAuth();

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <AppShell>
      <AppHeader />
      <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>Settings</Text>
      <View style={styles.panel}>
        <Text style={styles.rowTitle}>Account</Text>
        <Text style={styles.rowBody}>
          {user ? `Signed in as ${user.displayName ?? user.email}` : "You are not signed in."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={user ? handleLogout : startGoogleSignIn}
          style={styles.accountButton}
        >
          <Text style={styles.accountButtonText}>{user ? "Log out" : "Continue with Google"}</Text>
        </Pressable>
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
  accountButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    marginTop: spacing.lg,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg
  },
  accountButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "800"
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
