import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.ts"
    ]
  },
  resolve: {
    alias: {
      "@tunely/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@tunely/shared/": fileURLToPath(new URL("./packages/shared/src/", import.meta.url)),
      "@tunely/app/": fileURLToPath(new URL("./apps/app/src/", import.meta.url)),
      "@tunely/api/": fileURLToPath(new URL("./apps/api/src/", import.meta.url))
    }
  },
  root
});
