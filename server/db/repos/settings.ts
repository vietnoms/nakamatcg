import { z } from 'zod';
import type { DB } from '../db.js';
import type { Settings } from '../../../shared/types.js';

export const SettingsSchema = z.object({
  poll_interval_min: z.number().int().min(1).max(120).default(5),
  max_auto_per_hour: z.number().int().min(0).max(200).default(10),
  max_auto_per_day: z.number().int().min(0).max(1000).default(40),
  daily_spend_cap_usd: z.number().min(0).max(500).default(5),
  model: z.string().default('claude-sonnet-5'),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  max_images: z.number().int().min(1).max(20).default(12),
  notify_verdicts: z.array(z.enum(['BUY', 'MAYBE', 'PASS'])).default(['BUY']),
  discord_enabled: z.boolean().default(true),
});

export function createSettingsRepo(db: DB) {
  function getAll(): Settings {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        // ignore malformed row; default applies
      }
    }
    return SettingsSchema.parse(raw) as Settings;
  }

  function put(patch: Partial<Settings>): Settings {
    const merged = SettingsSchema.parse({ ...getAll(), ...patch });
    const stmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(merged)) stmt.run(k, JSON.stringify(v));
    });
    tx();
    return merged as Settings;
  }

  return { getAll, put };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
