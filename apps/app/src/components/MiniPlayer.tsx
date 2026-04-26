import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fetchSong, songSubtitle, type ServerSong } from "../library/songsApi";
import { colors, spacing } from "../theme/tokens";

type MiniPlayerProps = {
  trackId?: string;
};

export function MiniPlayer({ trackId }: MiniPlayerProps) {
  const [currentTrack, setCurrentTrack] = useState<ServerSong | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!trackId) {
      setCurrentTrack(null);
      return;
    }

    fetchSong(trackId)
      .then((result) => {
        if (!mounted) {
          return;
        }

        setCurrentTrack(result.status === "authenticated" ? result.song : null);
      })
      .catch(() => {
        if (mounted) {
          setCurrentTrack(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [trackId]);

  if (!currentTrack) {
    return null;
  }

  return (
    <Link href={`/now-playing?id=${currentTrack.id}`} asChild>
      <Pressable style={styles.player}>
        <View style={styles.art} />
        <View style={styles.track}>
          <Text numberOfLines={1} style={styles.title}>
            {currentTrack.title}
          </Text>
          <Text numberOfLines={1} style={styles.artist}>
            {songSubtitle(currentTrack)}
          </Text>
        </View>
        <Text accessibilityLabel="Open selected track" style={styles.play}>
          ▶
        </Text>
      </Pressable>
    </Link>
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
