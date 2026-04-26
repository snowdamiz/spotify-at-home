import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { APP_NAME } from "@tunely/shared";
import { useAuth } from "../auth/AuthProvider";
import { startGoogleSignIn } from "../auth/session";
import { BrandMark } from "./BrandMark";
import { ImportButton } from "./ImportButton";
import { colors, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

type AppHeaderProps = {
  compact?: boolean;
};

export function AppHeader({ compact = false }: AppHeaderProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const { user } = useAuth();

  return (
    <View style={StyleSheet.flatten([styles.header, isWide ? styles.desktopHeader : null])}>
      <View style={styles.brand}>
        <BrandMark size={isWide ? 40 : compact ? 56 : 64} />
        <Text style={StyleSheet.flatten([styles.name, isWide ? styles.desktopName : null])}>{APP_NAME}</Text>
      </View>
      <View style={styles.actions}>
        {!compact ? <ImportButton compact={false} /> : null}
        {user ? (
          <View style={styles.accountPill}>
            <Text numberOfLines={1} style={styles.accountText}>
              {user.displayName ?? user.email}
            </Text>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={startGoogleSignIn} style={styles.loginButton}>
            <Text style={styles.loginText}>Log in</Text>
          </Pressable>
        )}
        <Link href="/settings" asChild>
          <Pressable accessibilityLabel="Open settings" style={styles.iconButton}>
            <Text style={styles.iconText}>⚙</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  accountPill: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 180,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  accountText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  brand: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.md
  },
  desktopHeader: {
    minHeight: 56
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%"
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  iconText: {
    color: colors.muted,
    fontSize: 24,
    lineHeight: 28
  },
  loginButton: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  loginText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  desktopName: {
    fontSize: 22
  },
  name: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 28,
    fontWeight: "800"
  }
});
