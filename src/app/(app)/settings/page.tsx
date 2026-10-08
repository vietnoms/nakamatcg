import { getDb } from "@/db/client";
import { getSettings } from "@/server/settings";
import { catalogStatus } from "@/server/catalog";
import { CatalogCard } from "./catalog-card";
import { SettingsForms } from "./settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = getDb();
  const [settings, catalog] = await Promise.all([getSettings(db), catalogStatus(db)]);
  const when = (d: Date | null | undefined) =>
    d ? new Intl.DateTimeFormat("en-US", { timeZone: process.env.APP_TZ ?? "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(d) : null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-zinc-500">
        Sticker QR codes link to <code className="rounded bg-zinc-100 px-1">{process.env.PUBLIC_BASE_URL || "(not set)"}</code>. It is
        set on the server (PUBLIC_BASE_URL) and should never change once stickers are printed. Phones pick up changes here on
        their next sync.
      </p>
      <SettingsForms settings={settings} />
      <CatalogCard
        items={catalog.items}
        lastOk={when(catalog.lastOk?.finishedAt)}
        lastError={catalog.last?.error ?? null}
        cardsight={Boolean(process.env.CARDSIGHT_API_KEY)}
        claude={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  );
}
