import { StyleSheet, Text, View } from "react-native";
import { createMockPlayerStore } from "../player/playerStore";
import { colors, spacing } from "../theme/tokens";

type MiniPlayerProps = {
  trackId?: string;
};

export function MiniPlayer({ trackId }: MiniPlayerProps) {
  const player = createMockPlayerStore(trackId);
  const currentTrack = player.getCurrentTrack();

  if (!currentTrack) {
    return null;
  }

  return (
    <View style={styles.player}>
      <View style={styles.art} />
      <View style={styles.track}>
        <Text numberOfLines={1} style={styles.title}>
          {currentTrack.title}
        </Text>
        <Text numberOfLines={1} style={styles.artist}>
          {currentTrack.artist}
        </Text>
      </View>
      <Text accessibilityLabel="Previous track" style={styles.control}>
        ‹
      </Text>
      <Text accessibilityLabel="Play selected track" style={styles.play}>
        ▶
      </Text>
      <Text accessibilityLabel="Next track" style={styles.control}>
        ›
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    backgroundColor: colors.green,
    borderRadius: 6,
    height: 44,
    width: 44
  },
  artist: {
    color: colors.muted,
    fontSize: 14
  },
  control: {
    color: colors.text,
    fontSize: 26,
    width: 28
  },
  play: {
    color: colors.text,
    fontSize: 22,
    width: 32
  },
  player: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 76,
    paddingHorizontal: spacing.lg,
    width: "100%"
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  track: {
    flex: 1,
    minWidth: 0
  }
});
