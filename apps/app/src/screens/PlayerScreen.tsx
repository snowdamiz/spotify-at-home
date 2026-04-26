import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { fetchSong, likeSong, requestSongCacheIntent, songStreamUrl, songSubtitle, unlikeSong, updatePlaybackState, type ServerSong } from "../library/songsApi";
import { useLibrarySummary } from "../library/useSongs";
import { ExpoFileSystemSongCacheRepository, resolvePlaybackSource } from "../player/cache";
import { ExpoAudioAdapter } from "../player/expoAudioAdapter";
import { createPlaybackStore, type PlaybackStore } from "../player/playerStore";
import { colors, radius, spacing, WEB_SIDEBAR_BREAKPOINT } from "../theme/tokens";

export function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= WEB_SIDEBAR_BREAKPOINT;
  const library = useLibrarySummary();
  const [song, setSong] = useState<ServerSong | null>(null);
  const [status, setStatus] = useState<"loading" | "anonymous" | "not-found" | "ready" | "error">(
    id ? "loading" : "not-found"
  );
  const audioAdapterRef = useRef<ExpoAudioAdapter | null>(null);
  const playbackStoreRef = useRef<PlaybackStore | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [likedOverride, setLikedOverride] = useState<boolean | null>(null);
  const [likeStatus, setLikeStatus] = useState<"idle" | "saving" | "error">("idle");
  const cacheRepository = useMemo(() => new ExpoFileSystemSongCacheRepository(), []);
  const isLiked = song
    ? likedOverride ?? library.summary.likedSongs.some((likedSong) => likedSong.id === song.id)
    : false;

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

  useEffect(() => {
    setLikedOverride(null);
    setLikeStatus("idle");
    setPlaybackStatus("idle");
  }, [id]);

  useEffect(() => {
    return () => {
      audioAdapterRef.current?.release();
      audioAdapterRef.current = null;
      playbackStoreRef.current = null;
    };
  }, []);

  async function handlePlayPause() {
    if (!song) {
      return;
    }

    setPlaybackStatus((current) => (current === "playing" ? current : "loading"));

    try {
      const playbackStore = getPlaybackStore();
      const currentState = playbackStore.getState();

      if (currentState.currentTrack?.id !== song.id) {
        const cacheIntent = await requestSongCacheIntent(song.id);
        const streamUrl =
          cacheIntent.status === "accepted" && cacheIntent.cacheIntent
            ? cacheIntent.cacheIntent.streamUrl
            : songStreamUrl(song.id);

        await playbackStore.loadTrack({
          id: song.id,
          title: song.title,
          artist: song.artist,
          streamUrl
        });
      }

      await playbackStore.togglePlayPause();
      const nextState = playbackStore.getState();

      setPlaybackStatus(nextState.status === "playing" ? "playing" : "paused");

      if (nextState.status === "playing" || nextState.status === "paused") {
        await updatePlaybackState({
          songId: song.id,
          positionMs: 0,
          shuffleEnabled: false,
          repeatMode: "off"
        });
      }
    } catch {
      setPlaybackStatus("error");
    }
  }

  async function handleLikeToggle() {
    if (!song || likeStatus === "saving") {
      return;
    }

    setLikeStatus("saving");

    try {
      const result = isLiked ? await unlikeSong(song.id) : await likeSong(song.id);

      if (result.status === "authenticated") {
        setLikedOverride(result.liked);
        setLikeStatus("idle");
        return;
      }

      setLikeStatus("error");
    } catch {
      setLikeStatus("error");
    }
  }

  function getPlaybackStore() {
    if (!audioAdapterRef.current) {
      audioAdapterRef.current = new ExpoAudioAdapter();
    }

    if (!playbackStoreRef.current) {
      playbackStoreRef.current = createPlaybackStore({
        audioAdapter: audioAdapterRef.current,
        sourceResolver: {
          resolve: async (track) => {
            const source = await resolvePlaybackSource(
              {
                songId: track.id,
                streamUrl: track.streamUrl
              },
              cacheRepository
            );

            return source.uri;
          }
        }
      });
    }

    return playbackStoreRef.current;
  }

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
            <Pressable accessibilityLabel="Previous track" disabled style={StyleSheet.flatten([styles.controlButton, styles.disabledControl])}>
              <Text style={styles.control}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={playbackStatus === "playing" ? "Pause selected track" : "Play selected track"}
              disabled={playbackStatus === "loading"}
              onPress={handlePlayPause}
              style={StyleSheet.flatten([styles.playButton, playbackStatus === "loading" ? styles.disabledControl : null])}
            >
              <Text style={styles.play}>{playbackStatus === "playing" ? "❚❚" : "▶"}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Next track" disabled style={StyleSheet.flatten([styles.controlButton, styles.disabledControl])}>
              <Text style={styles.control}>›</Text>
            </Pressable>
          </View>
        ) : null}
        {song ? (
          <Pressable
            accessibilityLabel={isLiked ? "Remove from liked songs" : "Add to liked songs"}
            disabled={likeStatus === "saving"}
            onPress={handleLikeToggle}
            style={StyleSheet.flatten([styles.likeButton, isLiked ? styles.likedButton : null, likeStatus === "saving" ? styles.disabledControl : null])}
          >
            <Text style={StyleSheet.flatten([styles.likeText, isLiked ? styles.likedText : null])}>
              {isLiked ? "Liked" : "Like"}
            </Text>
          </Pressable>
        ) : null}
        {playbackStatus === "error" ? (
          <Text style={styles.playbackError}>Could not start playback from the server.</Text>
        ) : null}
        {likeStatus === "error" ? (
          <Text style={styles.playbackError}>Could not update liked songs on the server.</Text>
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
  controlButton: {
    alignItems: "center",
    height: 64,
    justifyContent: "center",
    width: 64
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xl,
    justifyContent: "center",
    marginTop: spacing.xl
  },
  disabledControl: {
    opacity: 0.4
  },
  likeButton: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm
  },
  likedButton: {
    backgroundColor: colors.text,
    borderColor: colors.text
  },
  likedText: {
    color: "#050505"
  },
  likeText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  play: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900"
  },
  playbackError: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.md,
    textAlign: "center"
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 40,
    height: 72,
    justifyContent: "center",
    width: 72
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
