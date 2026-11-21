import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the react-server condition; tests are server code.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests must never reach the shared Supabase bucket, even with a local .env.local present.
    env: { STORAGE_DRIVER: "memory", REPO_DRIVER: "memory" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
