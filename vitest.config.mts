import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    globalSetup: ["tests/unit/global-setup.ts"],
    setupFiles: ["tests/unit/setup.ts"],
    env: {
      DATABASE_URL: "file:../data/test.db",
      STORAGE_DIR: "./data/test-storage",
    },
  },
});
