import { Explainer } from "@/components/explainer";
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
      <h1 className="text-2xl font-semibold">Stickers</h1>
      <Explainer id="labels" title="How sticker printing works">
        <p>
          The queue lists every card whose sticker is missing (<b>new</b>), shows an old price (<b>was $X</b>), or was asked for
          again (<b>reprint</b>). Printing a batch marks those cards as stickered with today&apos;s price and date.
        </p>
        <p className="font-medium">One-time setup on the laptop the Zebra is plugged into:</p>
        <ol>
          <li>
            Install <a className="underline" href="https://developer.zebra.com/products/printers/browser-print" target="_blank" rel="noreferrer">Zebra Browser Print</a> and
            start it (a Zebra icon appears in the tray). Allow this site when it asks.
          </li>
          <li>Load the 1.5 x 1 in roll, then press <b>Calibrate roll</b> once so the printer learns the label size.</li>
          <li>Press <b>Test sticker</b> and scan it with your phone&apos;s camera: it should open this app. If text is faint or cut off, adjust darkness or shift in Settings.</li>
        </ol>
        <p>
          Each sticker has a QR code (scan it in the POS to sell), the price, the card&apos;s 6-character code (type it if a QR
          won&apos;t scan), condition or grade, the date it was priced, and the name and set. Put it on the toploader or sleeve,
          not the card. No Browser Print? <b>Download .zpl</b> and send the file to the printer, then <b>Mark printed</b>.
        </p>
      </Explainer>
      {!baseUrl && (
        <p className="rounded-md bg-red-950/40 p-3 text-sm text-red-300">
          PUBLIC_BASE_URL is not set. The QR codes need the app&apos;s public address before anything is printed.
        </p>
      )}
      <LabelsClient queue={queue} settings={settings.label} baseUrl={baseUrl} pricedOn={shortDate(new Date(), process.env.APP_TZ ?? "America/Los_Angeles")} />
    </div>
  );
}
