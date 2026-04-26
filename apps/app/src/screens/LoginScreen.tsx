import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { APP_NAME } from "@tunely/shared";
import { startGoogleSignIn } from "../auth/session";
import { BrandMark } from "../components/BrandMark";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function LoginScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={StyleSheet.flatten([styles.card, isWide ? styles.cardWide : null])}>
          <BrandMark size={88} />
          <Text style={styles.eyebrow}>{APP_NAME}</Text>
          <Text style={styles.title}>Sign in to continue</Text>
          <Text style={styles.body}>
            Connect your Google account to sync your private music library across web, iOS, and Android.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={startGoogleSignIn}
            style={({ pressed }) =>
              StyleSheet.flatten([styles.googleButton, pressed ? styles.googleButtonPressed : null])
            }
          >
            <Text style={styles.googleText}>Continue with Google</Text>
          </Pressable>
          <Text style={styles.footer}>
            Your library stays on the Tunely server you host.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs,
    textAlign: "center"
  },
  card: {
    alignItems: "center",
    gap: spacing.md,
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    width: "100%"
  },
  cardWide: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl
  },
  eyebrow: {
    color: colors.green,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: spacing.md,
    textTransform: "uppercase"
  },
  footer: {
    color: colors.mutedStrong,
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: "center"
  },
  googleButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg
  },
  googleButtonPressed: {
    opacity: 0.85
  },
  googleText: {
    color: colors.greenInk,
    fontSize: 15,
    fontWeight: "800"
  },
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center"
  }
});
