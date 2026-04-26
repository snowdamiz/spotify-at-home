import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { APP_NAME } from "@tunely/shared";
import { BrandMark } from "./BrandMark";
import { ImportButton } from "./ImportButton";
import { colors, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

type AppHeaderProps = {
  compact?: boolean;
};

export function AppHeader({ compact = false }: AppHeaderProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <View style={StyleSheet.flatten([styles.header, isWide ? styles.desktopHeader : null])}>
      <View style={styles.brand}>
        <BrandMark size={isWide ? 40 : compact ? 56 : 64} />
        <Text style={StyleSheet.flatten([styles.name, isWide ? styles.desktopName : null])}>{APP_NAME}</Text>
      </View>
      <View style={styles.actions}>
        {!compact ? <ImportButton compact={false} /> : null}
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
