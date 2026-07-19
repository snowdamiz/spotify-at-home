import { config as loadEnv } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./app.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(apiRoot, ".env") });
loadEnv({ path: resolve(apiRoot, "../..", ".env") });

if (process.env.BROADSIDE_DATABASE_PATH) {
  process.env.BROADSIDE_DATABASE_PATH = resolveDatabasePath(process.env.BROADSIDE_DATABASE_PATH);
} else {
  process.env.BROADSIDE_DATABASE_PATH = resolve(apiRoot, "../..", "data", "broadside.sqlite");
}

// Default matches the port every other default assumes (README, Dockerfile,
// fly.toml, and the client's /api rewrite all point at 3101).
const port = Number(process.env.PORT ?? 3101);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApiApp();

try {
  const address = await app.listen({ host, port });
  console.info(`API server listening at ${address}`);
} catch (error) {
  reportStartupError(error);
  process.exit(1);
}

function resolveDatabasePath(path: string) {
  if (path === ":memory:" || isAbsolute(path)) {
    return path;
  }

  return resolve(apiRoot, path);
}

function reportStartupError(error: unknown) {
  console.error(`API server failed to start on ${host}:${port}.`);

  if (isNodeError(error) && error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing API process or set PORT to an open port.`);
  }

  console.error(error);
}

function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}
