import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { fetchSong, songSubtitle, type ServerSong } from "../library/songsApi";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const [song, setSong] = useState<ServerSong | null>(null);
  const [status, setStatus] = useState<"loading" | "anonymous" | "not-found" | "ready" | "error">(
    id ? "loading" : "not-found"
  );

  useEffect(() => {
    let mounted = true;

    if (!id) {
      setSong(null);
      setStatus("not-found");
      return;
    }

    setStatus("loading");
    fetchSong(id)
      .then((result) => {
        if (!mounted) {
          return;
        }

        if (result.status === "authenticated" && result.song) {
          setSong(result.song);
          setStatus("ready");
          return;
        }

        setSong(null);
        setStatus(result.status);
      })
      .catch(() => {
        if (mounted) {
          setSong(null);
          setStatus("error");
        }
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  return (
    <AppShell miniPlayerTrackId={song?.id}>
      <AppHeader />
      <View style={StyleSheet.flatten([styles.player, isWide ? styles.desktopPlayer : null])}>
        <View style={StyleSheet.flatten([styles.art, isWide ? styles.desktopArt : null])}>
          <Text style={StyleSheet.flatten([styles.artText, isWide ? styles.desktopArtText : null])}>♪</Text>
        </View>
        <Text style={StyleSheet.flatten([styles.title, isWide ? styles.desktopTitle : null])}>
          {song?.title ?? playerStatusTitle(status)}
        </Text>
        <Text style={styles.artist}>{song ? songSubtitle(song) : playerStatusBody(status)}</Text>
        {song ? (
          <View style={styles.controls}>
            <Text style={styles.control}>‹</Text>
            <Text style={styles.play}>▶</Text>
            <Text style={styles.control}>›</Text>
          </View>
        ) : null}
      </View>
    </AppShell>
  );
}

function playerStatusTitle(status: "loading" | "anonymous" | "not-found" | "ready" | "error") {
  switch (status) {
    case "loading":
      return "Loading song";
    case "anonymous":
      return "Log in required";
    case "error":
      return "Server unavailable";
    case "not-found":
    case "ready":
      return "No song selected";
  }
}

function playerStatusBody(status: "loading" | "anonymous" | "not-found" | "ready" | "error") {
  switch (status) {
    case "loading":
      return "Fetching metadata from your Tunely server.";
    case "anonymous":
      return "Log in to play imported songs from this device.";
    case "error":
      return "Could not reach the Tunely server.";
    case "not-found":
    case "ready":
      return "Choose a song from Home, Search, Library, or Imported Songs.";
  }
}

const styles = StyleSheet.create({
  art: {
    alignItems: "center",
    backgroundColor: colors.greenDark,
    borderRadius: radius.lg,
    height: 280,
    justifyContent: "center",
    maxWidth: 420,
    width: "100%"
  },
  artist: {
    color: colors.muted,
    fontSize: 20
  },
  artText: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 120
  },
  desktopArt: {
    height: 220,
    maxWidth: 320
  },
  desktopArtText: {
    fontSize: 88
  },
  desktopPlayer: {
    marginTop: spacing.xl
  },
  desktopTitle: {
    fontSize: 26
  },
  control: {
    color: colors.text,
    fontSize: 54
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xl,
    justifyContent: "center",
    marginTop: spacing.xl
  },
  play: {
    color: colors.text,
    fontSize: 46
  },
  player: {
    alignItems: "center",
    marginTop: spacing.xxl
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginTop: spacing.xl,
    textAlign: "center"
  }
});
