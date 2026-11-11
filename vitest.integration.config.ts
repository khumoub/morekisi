import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Runs tests/integration against the local Docker stack (`docker compose up`). */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/integration/server-only-stub.ts", import.meta.url)),
    },
  },
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/integration/**/*.int.test.ts"], testTimeout: 30_000, fileParallelism: false },
});
