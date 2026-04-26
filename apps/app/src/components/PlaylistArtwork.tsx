import { StyleSheet, Text, View } from "react-native";
import type { Playlist } from "../data/mockCatalog";
import { radius } from "../theme/tokens";

type PlaylistArtworkProps = {
  playlist: Playlist;
  size?: number | `${number}%`;
};

export function PlaylistArtwork({ playlist, size = 112 }: PlaylistArtworkProps) {
  const isPixel = typeof size === "number";
  const sizeStyle = isPixel
    ? { height: size, width: size }
    : { aspectRatio: 1, width: size };

  const letterSize = isPixel ? Math.max(13, Math.round(size * 0.38)) : 32;
  const showNote = !isPixel || size >= 72;
  const noteSize = isPixel ? Math.max(12, Math.round(size * 0.3)) : 30;
  const noteOffset = isPixel ? Math.max(4, Math.round(size * 0.08)) : 10;

  return (
    <View style={StyleSheet.flatten([styles.artwork, { backgroundColor: playlist.colors[0] }, sizeStyle])}>
      <Text style={StyleSheet.flatten([styles.initials, { fontSize: letterSize, lineHeight: letterSize * 1.05 }])}>
        {playlist.initials}
      </Text>
      {showNote ? (
        <Text
          style={StyleSheet.flatten([
            styles.note,
            { bottom: noteOffset, fontSize: noteSize, lineHeight: noteSize, right: noteOffset }
          ])}
        >
          ♪
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  artwork: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
    overflow: "hidden"
  },
  initials: {
    color: "#f4f4f4",
    fontWeight: "800",
    letterSpacing: 0.5
  },
  note: {
    color: "rgba(255, 255, 255, 0.32)",
    position: "absolute"
  }
});
