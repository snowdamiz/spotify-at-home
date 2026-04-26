import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fetchSong, songSubtitle, type ServerSong } from "../library/songsApi";
import { colors, radius, spacing } from "../theme/tokens";

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
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open now playing for ${currentTrack.title}`}
        style={({ pressed }) =>
          StyleSheet.flatten([styles.player, pressed ? styles.playerPressed : null])
        }
      >
        <View style={styles.art}>
          <Text style={styles.artText}>♪</Text>
        </View>
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
    alignItems: "center",
    backgroundColor: colors.greenDark,
    borderRadius: radius.sm,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  artText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 22,
    fontWeight: "900"
  },
  artist: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  play: {
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.xs,
    width: 28
  },
  player: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: "100%"
  },
  playerPressed: {
    backgroundColor: colors.cardHover
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  track: {
    flex: 1,
    minWidth: 0
  }
});
