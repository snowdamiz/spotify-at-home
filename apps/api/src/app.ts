import Fastify from "fastify";
import { registerAuthRoutes } from "./auth/routes.js";
import type { AuthRoutesOptions } from "./auth/routes.js";

export interface CreateApiAppOptions {
  auth?: Partial<AuthRoutesOptions>;
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = Fastify({
    logger: false
  });

  app.get("/api/health", async () => {
    return { ok: true };
  });

  registerAuthRoutes(app, {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "local-google-client-id",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "local-google-client-secret",
    googleRedirectUri:
      process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/api/auth/google/callback",
    allowedReturnToOrigins: process.env.APP_WEB_ORIGIN ? [process.env.APP_WEB_ORIGIN] : [],
    ...options.auth
  });

  return app;
}
