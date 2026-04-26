import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { startGoogleSignIn } from "../auth/session";
import { importAudioFromDevice } from "../import/audioImport";
import { colors, radius, spacing } from "../theme/tokens";

type ImportButtonProps = {
  compact?: boolean;
  tone?: "light" | "green";
  onImported?: (songCount: number) => void;
};

export function ImportButton({ compact = false, tone = "green", onImported }: ImportButtonProps) {
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
      style={({ pressed }) =>
        StyleSheet.flatten([
          styles.button,
          compact ? styles.compact : styles.full,
          tone === "light" ? styles.light : styles.green,
          isImporting ? styles.disabled : null,
          pressed ? styles.pressed : null
        ])
      }
    >
      <Text style={StyleSheet.flatten([styles.icon, compact ? styles.compactIcon : null])}>↥</Text>
      {!compact ? (
        <Text
          style={StyleSheet.flatten([
            styles.label,
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
    height: 44,
    width: 44
  },
  compactIcon: {
    fontSize: 22,
    lineHeight: 24
  },
  darkLabel: {
    color: colors.ink
  },
  disabled: {
    opacity: 0.7
  },
  full: {
    minHeight: 44,
    paddingHorizontal: spacing.lg
  },
  green: {
    backgroundColor: colors.green
  },
  icon: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 22
  },
  label: {
    fontSize: 14,
    fontWeight: "800"
  },
  light: {
    backgroundColor: colors.text
  },
  lightLabel: {
    color: colors.ink
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }]
  }
});
