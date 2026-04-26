import { Text, StyleSheet, View } from "react-native";
import { APP_NAME } from "@tunely/shared";
import { AppScreen } from "../components/AppScreen";

export function HomeScreen() {
  return (
    <AppScreen>
      <View style={styles.mark} testID="tunely-mark" />
      <Text style={styles.title}>{APP_NAME}</Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  mark: {
    backgroundColor: "#1ed760",
    borderRadius: 28,
    height: 56,
    marginBottom: 16,
    width: 56
  },
  title: {
    color: "#f8fafc",
    fontSize: 36,
    fontWeight: "700"
  }
});
