import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/tokens";
import { ImportButton } from "./ImportButton";

export function EmptyLibraryPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>No songs yet</Text>
      <Text style={styles.body}>Tap below to import audio from your device. Files stay in this session and play right here in your browser.</Text>
      <ImportButton />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 30,
    marginBottom: spacing.lg,
    maxWidth: 640,
    textAlign: "center"
  },
  panel: {
    alignItems: "center",
    alignSelf: "stretch",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: spacing.sm,
    textAlign: "center"
  }
});
