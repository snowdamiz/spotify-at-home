import Fastify from "fastify";

export function createApiApp() {
  const app = Fastify({
    logger: false
  });

  app.get("/api/health", async () => {
    return { ok: true };
  });

  return app;
}
