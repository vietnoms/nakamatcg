import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // reads compilerOptions.paths ("@/*") from tsconfig.json
    tsconfigPaths: true,
    // `import "server-only"` throws outside the Next.js bundler
    alias: { "server-only": fromRoot("./tests/stubs/server-only.ts") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // PGlite boots a whole Postgres in-process; give it room on a cold start
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
