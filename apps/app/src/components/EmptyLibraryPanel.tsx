import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/tokens";
import { ImportButton } from "./ImportButton";

export function EmptyLibraryPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>No songs yet</Text>
      <Text style={styles.body}>Import audio from your device to start listening — files sync to your private Tunely server.</Text>
      <ImportButton />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
    maxWidth: 480,
    textAlign: "center"
  },
  panel: {
    alignItems: "center",
    alignSelf: "stretch",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center"
  }
});
