import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { logout, startGoogleSignIn } from "../auth/session";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { useImportPolicy } from "../library/useSongs";
import { colors, radius, spacing } from "../theme/tokens";

export function SettingsScreen() {
  const { user, setUser } = useAuth();
  const importPolicy = useImportPolicy();

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <AppShell>
      <AppHeader />
      <Text style={styles.title}>Settings</Text>
      {importPolicy.policy.mode === "open_test" ? (
        <View style={styles.testingBanner}>
          <Text style={styles.testingBadge}>{importPolicy.policy.copy.badge}</Text>
          <Text style={styles.testingCopy}>{importPolicy.policy.copy.description}</Text>
        </View>
      ) : null}
      <View style={styles.panel}>
        <Text style={styles.rowTitle}>Account</Text>
        <Text style={styles.rowBody}>
          {user ? `Signed in as ${user.displayName ?? user.email}` : "You are not signed in."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={user ? handleLogout : startGoogleSignIn}
          style={({ pressed }) =>
            StyleSheet.flatten([
              styles.accountButton,
              user ? styles.accountButtonSecondary : null,
              pressed ? styles.accountButtonPressed : null
            ])
          }
        >
          <Text style={StyleSheet.flatten([styles.accountButtonText, user ? styles.accountButtonTextSecondary : null])}>
            {user ? "Log out" : "Continue with Google"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.rowTitle}>Storage</Text>
        <Text style={styles.rowBody}>Imported music will sync through your self-hosted Tunely server.</Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.rowTitle}>Import policy</Text>
        <Text style={styles.rowBody}>{importPolicy.policy.copy.label}</Text>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  accountButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 40,
    paddingHorizontal: spacing.lg
  },
  accountButtonPressed: {
    opacity: 0.85
  },
  accountButtonSecondary: {
    backgroundColor: "transparent",
    borderColor: colors.border,
    borderWidth: 1
  },
  accountButtonText: {
    color: colors.greenInk,
    fontSize: 14,
    fontWeight: "800"
  },
  accountButtonTextSecondary: {
    color: colors.text
  },
  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.lg
  },
  rowBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  testingBadge: {
    color: colors.greenInk,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  testingBanner: {
    backgroundColor: colors.green,
    borderRadius: radius.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.md
  },
  testingCopy: {
    color: colors.greenInk,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
    marginTop: spacing.lg
  }
});
