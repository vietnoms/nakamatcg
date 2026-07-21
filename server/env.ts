import 'dotenv/config';
import { z } from 'zod';

const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const EnvSchema = z.object({
  PALLET_TRADE_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  EBAY_CLIENT_ID: z.preprocess(emptyToUndef, z.string().optional()),
  EBAY_CLIENT_SECRET: z.preprocess(emptyToUndef, z.string().optional()),
  DISCORD_WEBHOOK_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  PORT: z.coerce.number().int().positive().default(8787),
  DB_PATH: z.preprocess(emptyToUndef, z.string().default('data/app.sqlite')),
  PALLET_TRADE_MCP_URL: z.preprocess(
    emptyToUndef,
    z.string().url().default('https://pallet.trade/mcp'),
  ),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nCheck your .env file.`);
  }
  return parsed.data;
}

/** Which optional integrations are configured — surfaced via /api/status and boot logs. */
export function envCapabilities(env: Env) {
  return {
    pallet_trade: Boolean(env.PALLET_TRADE_TOKEN),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    ebay_api: Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET),
    discord: Boolean(env.DISCORD_WEBHOOK_URL),
  };
}
