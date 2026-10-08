import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` diffs schema.ts against the snapshots in src/db/migrations/meta.
// It never needs a live database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
