import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";
import { ImportButton } from "./ImportButton";

export function EmptyLibraryPanel() {
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;

  return (
    <View style={StyleSheet.flatten([styles.panel, isWide ? styles.desktopPanel : null])}>
      <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>No songs yet</Text>
      <Text style={StyleSheet.flatten([styles.body, isWide ? styles.desktopBody : null])}>
        Tap below to import audio from your device. Files stay in this session and play right here in your browser.
      </Text>
      <ImportButton />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 30,
    marginBottom: spacing.xl,
    maxWidth: 560,
    textAlign: "center"
  },
  desktopBody: {
    fontSize: 17,
    lineHeight: 25,
    maxWidth: 500
  },
  desktopPanel: {
    alignSelf: "flex-start",
    maxWidth: 760,
    paddingVertical: spacing.xl
  },
  desktopTitle: {
    fontSize: 26
  },
  panel: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    width: "100%"
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "center"
  }
});
