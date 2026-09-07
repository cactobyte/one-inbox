import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // pglite spins up a fresh in-process Postgres per suite (in `beforeEach`
    // for most). Under enough parallel workers that WASM init alone can pass
    // the default 10s hook timeout — give both the hook and the test room.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
