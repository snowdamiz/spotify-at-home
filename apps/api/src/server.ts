import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./app.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(apiRoot, ".env") });
loadEnv({ path: resolve(apiRoot, "../..", ".env") });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApiApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
