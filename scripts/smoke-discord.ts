// Live check: posts a test embed to the configured Discord webhook.
import { loadEnv } from '../server/env.js';
import { DiscordNotifier } from '../server/notify/discord.js';

const env = loadEnv();
if (!env.DISCORD_WEBHOOK_URL) {
  console.error('FAIL: DISCORD_WEBHOOK_URL missing in .env');
  process.exit(1);
}
try {
  await new DiscordNotifier(env.DISCORD_WEBHOOK_URL).sendTest();
  console.log('PASS — check your Discord channel for the test embed');
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
}
