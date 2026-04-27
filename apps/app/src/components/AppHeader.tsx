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

  return (
    <View style={styles.header}>
      <View style={styles.brand}>
        <BrandMark size={isWide ? 52 : 48} />
        <Text numberOfLines={1} style={styles.name}>
          {APP_NAME}
        </Text>
      </View>
      <View style={styles.actions}>
        {!compact ? <ImportButton compact={!isWide} tone="light" /> : null}
        {!user ? (
          <Pressable
            accessibilityRole="button"
            onPress={startGoogleSignIn}
            style={({ pressed }) =>
              StyleSheet.flatten([styles.loginButton, pressed ? styles.loginButtonPressed : null])
            }
          >
            <Text style={styles.loginText}>Log in</Text>
          </Pressable>
        ) : null}
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
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
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
    minHeight: 64,
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
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.3
  }
});
