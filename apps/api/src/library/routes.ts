import { serializeExternalSource } from "@tunely/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readAccessToken } from "../auth/routes.js";
import { AuthError, type AuthService, type PublicUser } from "../auth/service.js";
import type {
  Playlist,
  PlaylistSong,
  PlaylistSummary,
  SQLitePlaylistRepository,
  SQLiteSongRepository,
  Song
} from "../db/index.js";

export interface LibraryRoutesOptions {
  authService: AuthService;
  playlistRepository: SQLitePlaylistRepository;
  songRepository: SQLiteSongRepository;
}

export function registerLibraryRoutes(app: FastifyInstance, options: LibraryRoutesOptions) {
  app.get("/api/library/summary", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    return {
      summary: librarySummary(options, user.id)
    };
  });

  app.get("/api/search", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const query = searchQuery(request.query);
    const limit = numericQueryValue(request.query, "limit", 25);
    const offset = numericQueryValue(request.query, "cursor", 0);

    if (!query) {
      return {
        nextCursor: null,
        results: {
          playlists: [],
          songs: []
        }
      };
    }

    const songs = options.songRepository.searchReadySongsForUser({
      userId: user.id,
      query,
      limit,
      offset
    });
    const playlists = options.playlistRepository.searchPlaylistsForUser({
      userId: user.id,
      query,
      limit,
      offset
    });
    const hasMore = songs.length === limit || playlists.length === limit;

    return {
      nextCursor: hasMore ? String(offset + limit) : null,
      results: {
        playlists: playlists.map(serializePlaylistSummary),
        songs: songs.map(serializeSong)
      }
    };
  });

  app.get("/api/playlists", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    return {
      playlists: options.playlistRepository
        .listPlaylistsForUser(user.id)
        .map(serializePlaylistSummary)
    };
  });

  app.post("/api/playlists", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = objectBody(request.body);
    const name = requiredText(body.name);

    if (!name) {
      return sendLibraryError(reply, "invalid_playlist_name", "Playlist name is required.", 400);
    }

    const playlist = options.playlistRepository.createPlaylist({
      userId: user.id,
      name,
      description: nullableText(body.description),
      color: nullableText(body.color)
    });

    return reply.code(201).send({
      playlist: {
        ...serializePlaylist(playlist),
        songCount: 0,
        songs: []
      }
    });
  });

  app.get("/api/playlists/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    return sendPlaylistDetail(reply, options, user.id, playlistIdFromParams(request.params));
  });

  app.put("/api/playlists/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = objectBody(request.body);
    const playlist = options.playlistRepository.updatePlaylistForUser({
      userId: user.id,
      playlistId: playlistIdFromParams(request.params),
      name: body.name === undefined ? undefined : requiredText(body.name) ?? undefined,
      description: body.description === undefined ? undefined : nullableText(body.description),
      color: body.color === undefined ? undefined : nullableText(body.color)
    });

    if (!playlist) {
      return sendLibraryError(reply, "playlist_not_found", "Playlist not found.", 404);
    }

    return {
      playlist: serializePlaylistDetail(
        playlist,
        options.playlistRepository.listSongs({ userId: user.id, playlistId: playlist.id })
      )
    };
  });

  app.delete("/api/playlists/:id", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    options.playlistRepository.deletePlaylistForUser(user.id, playlistIdFromParams(request.params));

    return reply.code(204).send();
  });

  app.post("/api/playlists/:id/songs", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = objectBody(request.body);
    const songId = requiredText(body.songId ?? body.id);

    if (!songId) {
      return sendLibraryError(reply, "invalid_playlist_song", "Song id is required.", 400);
    }

    try {
      options.playlistRepository.addSong({
        userId: user.id,
        playlistId: playlistIdFromParams(request.params),
        songId,
        position: typeof body.position === "number" && Number.isFinite(body.position)
          ? Math.max(0, Math.floor(body.position))
          : undefined
      });
    } catch {
      return sendLibraryError(reply, "playlist_or_song_not_found", "Playlist or song not found.", 404);
    }

    return sendPlaylistDetail(reply, options, user.id, playlistIdFromParams(request.params));
  });

  app.delete("/api/playlists/:id/songs/:songId", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const removed = options.playlistRepository.removeSong({
      userId: user.id,
      playlistId: playlistIdFromParams(request.params),
      songId: songIdFromParams(request.params)
    });

    if (!removed) {
      return sendLibraryError(reply, "playlist_not_found", "Playlist not found.", 404);
    }

    return reply.code(204).send();
  });

  app.put("/api/playlists/:id/order", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const body = objectBody(request.body);
    const songIds = Array.isArray(body.songIds)
      ? body.songIds.filter((songId): songId is string => typeof songId === "string")
      : null;

    if (!songIds) {
      return sendLibraryError(reply, "invalid_playlist_order", "Playlist order is invalid.", 400);
    }

    const playlist = options.playlistRepository.findPlaylistForUser(
      user.id,
      playlistIdFromParams(request.params)
    );

    if (!playlist) {
      return sendLibraryError(reply, "playlist_not_found", "Playlist not found.", 404);
    }

    const songs = options.playlistRepository.reorderSongs({
      userId: user.id,
      playlistId: playlist.id,
      songIds
    });

    if (!songs) {
      return sendLibraryError(reply, "invalid_playlist_order", "Playlist order is invalid.", 400);
    }

    return {
      playlist: serializePlaylistDetail(playlist, songs)
    };
  });

  app.post("/api/songs/:id/like", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const song = findReadySongForUser(options.songRepository, user.id, songIdFromParams(request.params));

    if (!song) {
      return sendLibraryError(reply, "song_not_found", "Song not found.", 404);
    }

    options.songRepository.likeSong({ userId: user.id, songId: song.id });

    return {
      liked: true,
      song: serializeSong(song)
    };
  });

  app.delete("/api/songs/:id/like", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const song = findReadySongForUser(options.songRepository, user.id, songIdFromParams(request.params));

    if (!song) {
      return sendLibraryError(reply, "song_not_found", "Song not found.", 404);
    }

    options.songRepository.unlikeSong({ userId: user.id, songId: song.id });

    return reply.code(204).send();
  });
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService
): Promise<PublicUser | null> {
  try {
    return await authService.getUserForAccessToken(readAccessToken(request));
  } catch (error) {
    if (error instanceof AuthError) {
      sendLibraryError(reply, error.code, error.message, error.statusCode);
      return null;
    }

    throw error;
  }
}

function librarySummary(options: LibraryRoutesOptions, userId: string) {
  const recentSongs = options.songRepository.listRecentReadySongsForUser(userId, 10);
  const likedSongs = options.songRepository.listLikedSongsForUser(userId, 10);
  const playlists = options.playlistRepository.listPlaylistsForUser(userId, 10);
  const counts = {
    likedSongs: options.songRepository.countLikedSongsForUser(userId),
    playlists: options.playlistRepository.countPlaylistsForUser(userId),
    songs: options.songRepository.countReadySongsForUser(userId)
  };

  return {
    counts,
    isEmpty: counts.songs === 0 && counts.playlists === 0 && counts.likedSongs === 0,
    likedSongs: likedSongs.map(serializeSong),
    playlists: playlists.map(serializePlaylistSummary),
    recentSongs: recentSongs.map(serializeSong)
  };
}

function sendPlaylistDetail(
  reply: FastifyReply,
  options: LibraryRoutesOptions,
  userId: string,
  playlistId: string
) {
  const playlist = options.playlistRepository.findPlaylistForUser(userId, playlistId);

  if (!playlist) {
    return sendLibraryError(reply, "playlist_not_found", "Playlist not found.", 404);
  }

  return {
    playlist: serializePlaylistDetail(
      playlist,
      options.playlistRepository.listSongs({ userId, playlistId })
    )
  };
}

function findReadySongForUser(songRepository: SQLiteSongRepository, userId: string, songId: string) {
  const song = songRepository.findSongForUser(userId, songId);

  return song?.importStatus === "ready" ? song : null;
}

function searchQuery(query: unknown) {
  const value = (query as { query?: unknown }).query;

  return typeof value === "string" ? value.trim() : "";
}

function numericQueryValue(query: unknown, key: "cursor" | "limit", fallback: number) {
  const value = (query as Record<string, unknown>)[key];
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (key === "limit") {
    return Math.min(50, Math.max(1, Math.floor(parsed)));
  }

  return Math.max(0, Math.floor(parsed));
}

function objectBody(body: unknown) {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function playlistIdFromParams(params: unknown) {
  return String((params as { id?: string }).id ?? "");
}

function songIdFromParams(params: unknown) {
  return String((params as { songId?: string }).songId ?? (params as { id?: string }).id ?? "");
}

function serializeSong(song: Song) {
  return {
    id: song.id,
    userId: song.userId,
    title: song.title,
    artist: song.artist,
    album: song.album,
    durationMs: song.durationMs,
    mimeType: song.mimeType,
    sizeBytes: song.sizeBytes,
    checksum: song.checksum,
    storagePath: song.storagePath,
    importStatus: song.importStatus,
    externalSource: song.externalSource ? serializeExternalSource(song.externalSource) : null,
    createdAt: song.createdAt.toISOString(),
    updatedAt: song.updatedAt.toISOString()
  };
}

function serializePlaylist(playlist: Playlist) {
  return {
    id: playlist.id,
    userId: playlist.userId,
    name: playlist.name,
    description: playlist.description,
    color: playlist.color,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString()
  };
}

function serializePlaylistSummary(playlist: PlaylistSummary) {
  return {
    ...serializePlaylist(playlist),
    songCount: playlist.songCount
  };
}

function serializePlaylistDetail(playlist: Playlist, songs: PlaylistSong[]) {
  return {
    ...serializePlaylist(playlist),
    songCount: songs.length,
    songs: songs.map((song) => ({
      ...serializeSong(song),
      addedAt: song.addedAt.toISOString(),
      position: song.position
    }))
  };
}

function sendLibraryError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      details: {},
      requestId: reply.request.id
    }
  });
}
