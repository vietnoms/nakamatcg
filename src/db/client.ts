import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Any Drizzle Postgres database with our schema: node-postgres in the app, PGlite in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

let pool: Pool | undefined;
let db: Db | undefined;

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
    // an idle client that errors (server restart) must not crash the process
    pool.on("error", () => {});
    db = drizzle(pool, { schema }) as unknown as Db;
  }
  return db;
}
