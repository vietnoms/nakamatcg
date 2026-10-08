/**
 * Applies the Drizzle migrations in src/db/migrations to DATABASE_URL (or DATABASE_URL_UNPOOLED
 * when set: Neon's direct connection). Reads .env.local when present. Never prints the URL.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: use the environment as is
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function main(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "src", "db", "migrations") });
    console.log("migrations applied");
  } finally {
    await client.end();
  }
}

main(url).catch((e: unknown) => {
  // the message only: a pg error object can carry connection details
  console.error(e instanceof Error ? e.message : "migration failed");
  process.exit(1);
});
