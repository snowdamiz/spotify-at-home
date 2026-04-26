import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/tokens";

type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 64 }: BrandMarkProps) {
  return (
    <View
      accessibilityLabel="Tunely"
      style={StyleSheet.flatten([
        styles.mark,
        {
          borderRadius: size / 2,
          height: size,
          width: size
        }
      ])}
      testID="tunely-mark"
    >
      <Text style={StyleSheet.flatten([styles.letter, { fontSize: Math.max(18, size * 0.42) }])}>T</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  letter: {
    color: "#071108",
    fontWeight: "800"
  },
  mark: {
    alignItems: "center",
    backgroundColor: colors.green,
    justifyContent: "center"
  }
});
