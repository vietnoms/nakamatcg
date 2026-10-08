import { getDb } from "@/db/client";
import { shortDate } from "@/labels/label-data";
import { labelQueue } from "@/server/inventory";
import { getSettings } from "@/server/settings";
import { LabelsClient } from "./labels-client";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const db = getDb();
  const [queue, settings] = await Promise.all([labelQueue(db), getSettings(db)]);
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "";
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Stickers</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cards whose sticker is missing or shows an old price. Printing goes to the Zebra through Zebra Browser Print on this
          computer.
        </p>
      </div>
      {!baseUrl && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          PUBLIC_BASE_URL is not set. The QR codes need the app&apos;s public address before anything is printed.
        </p>
      )}
      <LabelsClient queue={queue} settings={settings.label} baseUrl={baseUrl} pricedOn={shortDate(new Date(), process.env.APP_TZ ?? "America/Los_Angeles")} />
    </div>
  );
}
