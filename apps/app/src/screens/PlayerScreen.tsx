import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { AppShell } from "../components/AppShell";
import { PlaylistArtwork } from "../components/PlaylistArtwork";
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

  const artworkSize = isWide ? 260 : 280;

  return (
    <AppShell miniPlayerTrackId={song?.id}>
      <AppHeader />
      <View style={styles.player}>
        {song ? (
          <PlaylistArtwork
            playlist={{ name: song.title, color: colors.greenDark }}
            size={artworkSize}
          />
        ) : (
          <View style={StyleSheet.flatten([styles.placeholderArt, { height: artworkSize, width: artworkSize }])}>
            <Text style={styles.placeholderArtIcon}>♪</Text>
          </View>
        )}
        <View style={styles.meta}>
          <View style={styles.metaText}>
            <Text style={styles.title} numberOfLines={2}>
              {song?.title ?? playerStatusTitle(status)}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {song ? songSubtitle(song) : playerStatusBody(status)}
            </Text>
          </View>
          {song ? (
            <Pressable
              accessibilityLabel={isLiked ? "Remove from liked songs" : "Add to liked songs"}
              accessibilityRole="button"
              disabled={likeStatus === "saving"}
              onPress={handleLikeToggle}
              style={({ pressed }) =>
                StyleSheet.flatten([
                  styles.likeButton,
                  pressed ? styles.likeButtonPressed : null,
                  likeStatus === "saving" ? styles.disabledControl : null
                ])
              }
            >
              <Text style={StyleSheet.flatten([styles.likeIcon, isLiked ? styles.likedIcon : null])}>
                {isLiked ? "♥" : "♡"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {song ? (
          <View style={styles.controls}>
            <Pressable
              accessibilityLabel="Previous track"
              disabled
              style={StyleSheet.flatten([styles.controlButton, styles.disabledControl])}
            >
              <Text style={styles.control}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={playbackStatus === "playing" ? "Pause selected track" : "Play selected track"}
              disabled={playbackStatus === "loading"}
              onPress={handlePlayPause}
              style={({ pressed }) =>
                StyleSheet.flatten([
                  styles.playButton,
                  playbackStatus === "loading" ? styles.disabledControl : null,
                  pressed ? styles.playButtonPressed : null
                ])
              }
            >
              <Text style={styles.play}>{playbackStatus === "playing" ? "❚❚" : "▶"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Next track"
              disabled
              style={StyleSheet.flatten([styles.controlButton, styles.disabledControl])}
            >
              <Text style={styles.control}>›</Text>
            </Pressable>
          </View>
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
  artist: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4
  },
  control: {
    color: colors.text,
    fontSize: 36
  },
  controlButton: {
    alignItems: "center",
    height: 56,
    justifyContent: "center",
    width: 56
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "center",
    marginTop: spacing.lg
  },
  disabledControl: {
    opacity: 0.4
  },
  likeButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  likeButtonPressed: {
    backgroundColor: colors.overlay
  },
  likedIcon: {
    color: colors.green
  },
  likeIcon: {
    color: colors.muted,
    fontSize: 24,
    lineHeight: 26
  },
  meta: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    maxWidth: 420,
    width: "100%"
  },
  metaText: {
    flex: 1,
    minWidth: 0
  },
  placeholderArt: {
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: radius.lg,
    justifyContent: "center"
  },
  placeholderArtIcon: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 72
  },
  play: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900"
  },
  playbackError: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.md,
    textAlign: "center"
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  playButtonPressed: {
    transform: [{ scale: 0.96 }]
  },
  player: {
    alignItems: "center",
    alignSelf: "center",
    marginTop: spacing.lg,
    maxWidth: 420,
    paddingBottom: spacing.lg,
    width: "100%"
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.3
  }
});
