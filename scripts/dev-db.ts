/**
 * A local Postgres for development, no Docker: real Postgres binaries from embedded-postgres,
 * data in ./.devdb, on 127.0.0.1:54330. Creates the database and applies migrations, then
 * runs until Ctrl+C. Pair with `pnpm dev:env` (writes .env.local pointing here).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export const DEV_DB = { port: 54330, user: "postgres", password: "local-dev-db", database: "nakamatcg" };

async function main() {
  const dir = path.join(process.cwd(), ".devdb");
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: DEV_DB.user,
    password: DEV_DB.password,
    port: DEV_DB.port,
    persistent: true,
    onLog: () => {},
  });
  if (!existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();

  const admin = new Client({ host: "127.0.0.1", port: DEV_DB.port, user: DEV_DB.user, password: DEV_DB.password, database: "postgres" });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [DEV_DB.database]);
  if (exists.rowCount === 0) await admin.query(`create database ${DEV_DB.database}`);
  await admin.end();

  const client = new Client({ host: "127.0.0.1", port: DEV_DB.port, user: DEV_DB.user, password: DEV_DB.password, database: DEV_DB.database });
  await client.connect();
  await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "src", "db", "migrations") });
  await client.end();
  console.log(`dev database ready on 127.0.0.1:${DEV_DB.port}/${DEV_DB.database} (Ctrl+C to stop)`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  setInterval(() => {}, 1 << 30);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
