import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { APP_NAME } from "@tunely/shared";
import { useAuth } from "../auth/AuthProvider";
import { startGoogleSignIn } from "../auth/session";
import { BrandMark } from "./BrandMark";
import { ImportButton } from "./ImportButton";
import { colors, radius, spacing } from "../theme/tokens";

type AppHeaderProps = {
  compact?: boolean;
};

export function AppHeader({ compact = false }: AppHeaderProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  const { user } = useAuth();
  const showName = isWide;

  return (
    <View style={styles.header}>
      <View style={styles.brand}>
        <BrandMark size={36} />
        {showName ? (
          <Text numberOfLines={1} style={styles.name}>
            {APP_NAME}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {!compact && isWide ? <ImportButton compact={false} /> : null}
        {user ? (
          <View style={styles.accountPill}>
            <View style={styles.accountDot} />
            <Text numberOfLines={1} style={styles.accountText}>
              {user.displayName ?? user.email}
            </Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={startGoogleSignIn}
            style={({ pressed }) =>
              StyleSheet.flatten([styles.loginButton, pressed ? styles.loginButtonPressed : null])
            }
          >
            <Text style={styles.loginText}>Log in</Text>
          </Pressable>
        )}
        <Link href="/settings" asChild>
          <Pressable
            accessibilityLabel="Open settings"
            style={({ pressed }) =>
              StyleSheet.flatten([styles.iconButton, pressed ? styles.iconButtonPressed : null])
            }
          >
            <Text style={styles.iconText}>⚙</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  accountDot: {
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 8,
    width: 8
  },
  accountPill: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  accountText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700"
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs
  },
  brand: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.sm
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    width: "100%"
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  iconButtonPressed: {
    backgroundColor: colors.overlay
  },
  iconText: {
    color: colors.muted,
    fontSize: 22,
    lineHeight: 24
  },
  loginButton: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  loginButtonPressed: {
    backgroundColor: colors.overlay
  },
  loginText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  name: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "800"
  }
});
