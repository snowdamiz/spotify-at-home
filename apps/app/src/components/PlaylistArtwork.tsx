import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme/tokens";

type PlaylistArtworkProps = {
  playlist: {
    color?: string | null;
    colors?: readonly string[];
    initials?: string;
    name?: string;
    title?: string;
  };
  size?: number | `${number}%`;
};

export function PlaylistArtwork({ playlist, size = 112 }: PlaylistArtworkProps) {
  const isPixel = typeof size === "number";
  const sizeStyle = isPixel
    ? { height: size, width: size }
    : { aspectRatio: 1, width: size };

  const letterSize = isPixel ? Math.max(13, Math.round(size * 0.38)) : 32;
  const showNote = !isPixel || size >= 44;
  const noteSize = isPixel ? Math.max(12, Math.round(size * 0.3)) : 30;
  const noteOffset = isPixel ? Math.max(4, Math.round(size * 0.08)) : 10;
  const title = playlist.name ?? playlist.title ?? "Playlist";
  const initials = playlist.initials ?? initialsForTitle(title);
  const backgroundColor = playlist.color ?? playlist.colors?.[0] ?? colors.greenDark;

  return (
    <View style={StyleSheet.flatten([styles.artwork, { backgroundColor }, sizeStyle])}>
      <Text style={StyleSheet.flatten([styles.initials, { fontSize: letterSize, lineHeight: letterSize * 1.05 }])}>
        {initials}
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

function initialsForTitle(title: string) {
  return title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
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
    letterSpacing: 0
  },
  note: {
    color: "rgba(255, 255, 255, 0.32)",
    position: "absolute"
  }
});
