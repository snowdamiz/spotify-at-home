import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function LoginScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <AppShell>
      <AppHeader />
      <View style={StyleSheet.flatten([styles.panel, isWide ? styles.desktopPanel : null])}>
        <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>Log in to Tunely</Text>
        <Text style={styles.body}>Google sign-in will connect your private library across web, iOS, and Android in the next phase.</Text>
        <View style={styles.googleButton}>
          <Text style={styles.googleText}>Continue with Google</Text>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 26,
    marginBottom: spacing.xl,
    textAlign: "center"
  },
  googleButton: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: spacing.xl
  },
  googleText: {
    color: colors.background,
    fontSize: 18,
    fontWeight: "800"
  },
  desktopPanel: {
    marginTop: spacing.xl,
    maxWidth: 440
  },
  desktopTitle: {
    fontSize: 28
  },
  panel: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginTop: spacing.xxl,
    maxWidth: 520,
    padding: spacing.xl,
    width: "100%"
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginBottom: spacing.md,
    textAlign: "center"
  }
});
