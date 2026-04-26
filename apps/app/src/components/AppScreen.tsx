import type { PropsWithChildren } from "react";
import { SafeAreaView, StyleSheet } from "react-native";

export function AppScreen({ children }: PropsWithChildren) {
  return <SafeAreaView style={styles.screen}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#080b0f",
    flex: 1,
    justifyContent: "center",
    padding: 24
  }
});
