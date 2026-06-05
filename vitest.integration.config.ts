import { defineConfig } from "vitest/config"
import path from "path"

// Integration tests that hit the live Supabase branch (read-only). Run explicitly:
//   npx vitest run --config vitest.integration.config.ts
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
