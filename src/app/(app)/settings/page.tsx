import { getDb } from "@/db/client";
import { getSettings } from "@/server/settings";
import { SettingsForms } from "./settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings(getDb());
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-zinc-500">
        Sticker link base: <code className="rounded bg-zinc-100 px-1">{process.env.PUBLIC_BASE_URL || "(not set)"}</code>. Set
        on the server as PUBLIC_BASE_URL; it is printed into every QR code.
      </p>
      <SettingsForms settings={settings} />
    </div>
  );
}
