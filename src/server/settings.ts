import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { SETTINGS, parseSettings, type AppSettings, type SettingKey } from "@/lib/settings";

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  return parseSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

export async function saveSetting<K extends SettingKey>(db: Db, key: K, value: AppSettings[K]): Promise<void> {
  const parsed = SETTINGS[key].schema.parse(value);
  await db
    .insert(settings)
    .values({ key, value: parsed })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt: sql`now()` } });
}
