import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import { startGoogleSignIn } from "../auth/session";
import { importAudioFromDevice } from "../import/audioImport";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

type ImportButtonProps = {
  compact?: boolean;
  tone?: "light" | "green";
  onImported?: (songCount: number) => void;
};

export function ImportButton({ compact = false, tone = "green", onImported }: ImportButtonProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const [status, setStatus] = useState<"idle" | "importing" | "failed">("idle");
  const isImporting = status === "importing";

  async function handlePress() {
    setStatus("importing");

    try {
      const songs = await importAudioFromDevice();
      setStatus("idle");
      onImported?.(songs.length);
    } catch (error) {
      if (error instanceof Error && error.message.includes("status 401")) {
        await startGoogleSignIn();
        return;
      }

      setStatus("failed");
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Import songs"
      disabled={isImporting}
      onPress={handlePress}
      style={StyleSheet.flatten([
        styles.button,
        compact ? styles.compact : styles.full,
        isWide && !compact ? styles.desktopFull : null,
        tone === "light" ? styles.light : styles.green,
        isImporting ? styles.disabled : null
      ])}
    >
      <Text style={StyleSheet.flatten([styles.icon, isWide ? styles.desktopIcon : null])}>↥</Text>
      {!compact ? (
        <Text
          style={StyleSheet.flatten([
            styles.label,
            isWide ? styles.desktopLabel : null,
            tone === "light" ? styles.darkLabel : styles.lightLabel
          ])}
        >
          {isImporting ? "Importing" : status === "failed" ? "Import failed" : "Import songs"}
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
  disabled: {
    opacity: 0.7
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
