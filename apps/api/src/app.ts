import Fastify, { type FastifyInstance } from "fastify";
import { SQLiteAuthRepository } from "./auth/repositories.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import type { AuthRoutesOptions } from "./auth/routes.js";
import { closeTunelyDatabase, openTunelyDatabase, runMigrations } from "./db/index.js";
import { SQLitePlaylistRepository, SQLiteSongRepository, type SqliteDatabase } from "./db/index.js";
import { registerLibraryRoutes } from "./library/routes.js";
import { registerSongRoutes, type SongRoutesOptions } from "./songs/routes.js";

export interface CreateApiAppOptions {
  auth?: Partial<AuthRoutesOptions>;
  db?: SqliteDatabase;
  songs?: Partial<Omit<SongRoutesOptions, "authService" | "songRepository">>;
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = Fastify({
    logger: false
  });
  const db = options.db ?? openTunelyDatabase();
  const ownsDatabase = !options.db;

  runMigrations(db);
  registerCors(app);

  app.get("/api/health", async () => {
    return { ok: true };
  });

  const authOptions: AuthRoutesOptions = {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
    allowedReturnToOrigins: process.env.APP_WEB_ORIGIN ? [process.env.APP_WEB_ORIGIN] : [],
    authRepository: new SQLiteAuthRepository(db),
    ...options.auth
  };
  const authService = authOptions.authService ?? new AuthService(authOptions);

  registerAuthRoutes(app, {
    ...authOptions,
    authService
  });
  const songRepository = new SQLiteSongRepository(db);
  const playlistRepository = new SQLitePlaylistRepository(db);

  registerSongRoutes(app, {
    authService,
    songRepository,
    ...options.songs
  });
  registerLibraryRoutes(app, {
    authService,
    playlistRepository,
    songRepository
  });

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      closeTunelyDatabase(db);
    });
  }

  return app;
}

function registerCors(app: FastifyInstance) {
  const allowedOrigins = new Set(
    [
      process.env.APP_WEB_ORIGIN,
      "http://localhost:8081",
      "http://localhost:8082",
      "http://127.0.0.1:8081",
      "http://127.0.0.1:8082"
    ].filter(Boolean)
  );

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin && allowedOrigins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
    }

    reply.header("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
}
