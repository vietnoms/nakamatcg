import { Explainer } from "@/components/explainer";
import { getDb } from "@/db/client";
import { pendingIntake } from "@/server/intake";
import { getSettings } from "@/server/settings";
import { IntakeDeal } from "./intake-client";

export const dynamic = "force-dynamic";

/** Cards taken in at the table as quick placeholders, to identify after the show. */
export default async function IntakePage() {
  const db = getDb();
  const [deals, settings] = await Promise.all([pendingIntake(db), getSettings(db)]);
  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const count = deals.reduce((n, d) => n + d.units.filter((u) => u.pending).length, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Needs details ({count})</h1>
      <Explainer id="intake" title="Identifying cards taken in at a show">
        <ul>
          <li>These came in on the POS as a quick pile or quick item, with no time to look them up. Each already has a code and is in stock.</li>
          <li>For each one, take a photo or search the catalog (or type it), check the details, and press <b>Save</b>. It becomes that card: market price, a suggested sticker price, and a sticker in the queue.</li>
          <li>The deal&apos;s photos are shown to help. A pile&apos;s cost was split evenly; once its cards are identified, <b>Re-split cost by market</b> gives the slab a bigger share than the bulk (same total).</li>
        </ul>
      </Explainer>
      {deals.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing left to identify.</p>}
      {deals.map((d) => (
        <IntakeDeal key={d.dealId} deal={{ ...d, when: when.format(d.occurredAt) }} rule={settings.pricing} />
      ))}
    </div>
  );
}
