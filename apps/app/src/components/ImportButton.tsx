import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

type ImportButtonProps = {
  compact?: boolean;
  tone?: "light" | "green";
};

export function ImportButton({ compact = false, tone = "green" }: ImportButtonProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Import songs"
      style={StyleSheet.flatten([
        styles.button,
        compact ? styles.compact : styles.full,
        isWide && !compact ? styles.desktopFull : null,
        tone === "light" ? styles.light : styles.green
      ])}
    >
      <Text style={StyleSheet.flatten([styles.icon, isWide ? styles.desktopIcon : null])}>↥</Text>
      {!compact ? (
        <Text style={StyleSheet.flatten([styles.label, isWide ? styles.desktopLabel : null, tone === "light" ? styles.darkLabel : styles.lightLabel])}>
          Import songs
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center"
  },
  compact: {
    height: 48,
    width: 48
  },
  darkLabel: {
    color: "#050505"
  },
  full: {
    minHeight: 56,
    paddingHorizontal: spacing.xl
  },
  desktopFull: {
    minHeight: 44,
    paddingHorizontal: spacing.lg
  },
  desktopIcon: {
    fontSize: 22,
    lineHeight: 24
  },
  desktopLabel: {
    fontSize: 16
  },
  green: {
    backgroundColor: colors.green
  },
  icon: {
    color: "#050505",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 30
  },
  label: {
    fontSize: 20,
    fontWeight: "800"
  },
  light: {
    backgroundColor: colors.text
  },
  lightLabel: {
    color: "#050505"
  }
});
