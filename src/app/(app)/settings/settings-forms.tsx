"use client";

import { useState, useTransition } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { formatCents, parseDollars } from "@/lib/money";
import { suggestPrice, type PricingRule } from "@/lib/pricing";
import type { AppSettings, PaymentMethod, SettingKey } from "@/lib/settings";
import type { LabelSettings } from "@/labels/zpl";
import { saveSettingAction } from "./actions";

function useSaver() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);
  function save<K extends SettingKey>(key: K, value: AppSettings[K]) {
    start(async () => {
      const r = await saveSettingAction(key, value);
      setMsg({ key, text: r.error ?? "Saved", ok: !r.error });
    });
  }
  const note = (key: string) =>
    msg?.key === key ? <span className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-300" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span> : null;
  return { save, pending, note };
}

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toString());

export function SettingsForms({ settings }: { settings: AppSettings }) {
  const { save, pending, note } = useSaver();
  const [pricing, setPricing] = useState<PricingRule>(settings.pricing);
  const [label, setLabel] = useState<LabelSettings>(settings.label);
  const [methods, setMethods] = useState<PaymentMethod[]>(settings.paymentMethods);
  const [tradeIn, setTradeIn] = useState(settings.tradeInPercent);
  const [restick, setRestick] = useState(settings.restick);
  const [stickerSealed, setStickerSealed] = useState(settings.stickerSealed);

  const examples = [349, 1249, 8240, 30800];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Suggested prices">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">What the Pricing page fills in when you press Enter on an empty box. Each price range rounds to its step: with "up", $12.10 becomes $13. You can always type your own price.</p>
          <label className="flex items-center gap-2">
            <Input
              type="number"
              value={pricing.percent}
              onChange={(e) => setPricing({ ...pricing, percent: Number(e.target.value) })}
              className="w-20 text-right"
            />
            % of market, rounded
            <Select value={pricing.mode} onChange={(e) => setPricing({ ...pricing, mode: e.target.value as PricingRule["mode"] })}>
              <option value="nearest">to the nearest</option>
              <option value="up">up</option>
              <option value="down">down</option>
            </Select>
          </label>
          <table className="text-sm">
            <tbody>
              {pricing.tiers.map((t, i) => (
                <tr key={i}>
                  <td className="pr-2 text-zinc-500 dark:text-zinc-400">{t.belowCents === null ? "Everything above" : "Below $"}</td>
                  <td className="pr-2">
                    {t.belowCents !== null && (
                      <Input
                        value={dollars(t.belowCents)}
                        onChange={(e) => {
                          const tiers = [...pricing.tiers];
                          tiers[i] = { ...t, belowCents: parseDollars(e.target.value) ?? t.belowCents };
                          setPricing({ ...pricing, tiers });
                        }}
                        className="w-20 text-right"
                      />
                    )}
                  </td>
                  <td className="pr-2 text-zinc-500 dark:text-zinc-400">step $</td>
                  <td>
                    <Input
                      value={dollars(t.stepCents)}
                      onChange={(e) => {
                        const tiers = [...pricing.tiers];
                        tiers[i] = { ...t, stepCents: parseDollars(e.target.value) || t.stepCents };
                        setPricing({ ...pricing, tiers });
                      }}
                      className="w-20 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="flex items-center gap-2">
            Never suggest below $
            <Input
              value={dollars(pricing.minCents)}
              onChange={(e) => setPricing({ ...pricing, minCents: parseDollars(e.target.value) ?? 0 })}
              className="w-20 text-right"
            />
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Examples:{" "}
            {examples.map((c) => `${formatCents(c)} -> ${formatCents(suggestPrice(c, pricing) ?? 0)}`).join(", ")}
          </p>
          <div className="flex items-center gap-3">
            <Button disabled={pending} onClick={() => save("pricing", pricing)}>
              Save
            </Button>
            {note("pricing")}
          </div>
        </div>
      </Card>

      <Card title="Stickers">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
            Match the roll in the printer. DPI is on the sticker under the Zebra (203 for most desktop models). Faint print: raise
            darkness. Text cut off on one side: shift it the other way.
          </p>
          <label className="col-span-2 flex items-center gap-2">
            Size
            <Select
              value={`${label.widthIn}x${label.heightIn}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split("x").map(Number);
                setLabel({ ...label, widthIn: w ?? 1.5, heightIn: h ?? 1 });
              }}
            >
              <option value="1.5x1">1.5 x 1 in</option>
              <option value="1.25x1">1.25 x 1 in</option>
              <option value="2x1">2 x 1 in</option>
              <option value="2.25x1.25">2.25 x 1.25 in</option>
            </Select>
          </label>
          <label className="flex items-center gap-2">
            DPI
            <Select value={label.dpi} onChange={(e) => setLabel({ ...label, dpi: Number(e.target.value) })}>
              <option value={203}>203</option>
              <option value={300}>300</option>
            </Select>
          </label>
          <label className="flex items-center gap-2">
            Speed
            <Select value={label.speed} onChange={(e) => setLabel({ ...label, speed: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6].map((s) => (
                <option key={s} value={s}>
                  {s} in/s
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2">
            Darkness
            <Input type="number" value={label.darkness} onChange={(e) => setLabel({ ...label, darkness: Number(e.target.value) })} className="w-20 text-right" />
          </label>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">-30 lighter to 30 darker, 0 = printer default</span>
          <label className="flex items-center gap-2">
            Shift right
            <Input type="number" value={label.offsetXDots} onChange={(e) => setLabel({ ...label, offsetXDots: Number(e.target.value) })} className="w-20 text-right" />
          </label>
          <label className="flex items-center gap-2">
            Shift down
            <Input type="number" value={label.offsetYDots} onChange={(e) => setLabel({ ...label, offsetYDots: Number(e.target.value) })} className="w-20 text-right" />
          </label>
          <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">Shifts are in printer dots (203 per inch). Print a test sticker after changing anything.</p>
          <label className="col-span-2 flex items-center gap-2">
            Layout
            <Select value={label.layout} onChange={(e) => setLabel({ ...label, layout: e.target.value === "fold" ? "fold" : "standard" })}>
              <option value="standard">Standard: everything on the front</option>
              <option value="fold">Fold-over: price on the front, QR on the back</option>
            </Select>
          </label>
          {label.layout === "fold" && (
            <>
              <label className="flex items-center gap-2">
                Front strip
                <Select value={label.foldFrontIn} onChange={(e) => setLabel({ ...label, foldFrontIn: Number(e.target.value) })}>
                  {[0.35, 0.4, 0.45, 0.5, 0.55, 0.6].map((v) => (
                    <option key={v} value={v}>
                      {v} in
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-2">
                Edge
                <Select value={label.foldGapIn} onChange={(e) => setLabel({ ...label, foldGapIn: Number(e.target.value) })}>
                  {[0, 0.04, 0.06, 0.08, 0.1, 0.12].map((v) => (
                    <option key={v} value={v}>
                      {v} in
                    </option>
                  ))}
                </Select>
              </label>
              <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
                The left strip (price and condition) goes on the front of the toploader at its right edge; the rest wraps around
                that edge onto the back, where the QR code, sticker code, name and set are. <b>Edge</b> is the blank band that sits
                on the toploader&apos;s side: about its thickness. The tick marks on the sticker show where to bend it.
              </p>
            </>
          )}
          <label className="col-span-2 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <input
              type="checkbox"
              checked={stickerSealed}
              onChange={(e) => {
                setStickerSealed(e.target.checked);
                save("stickerSealed", e.target.checked);
              }}
            />
            Print stickers for sealed products too
            <span className="text-xs text-zinc-500 dark:text-zinc-400">(off: sealed is rung up with the POS Sealed button)</span>
            {note("stickerSealed")}
          </label>
          <div className="col-span-2 flex items-center gap-3">
            <Button disabled={pending} onClick={() => save("label", label)}>
              Save
            </Button>
            {note("label")}
          </div>
        </div>
      </Card>

      <Card title="Payment methods">
        <div className="space-y-2 text-sm">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">The buttons on the POS, in this order (the last one you used is preselected on each phone). The fee is only used to work out profit on the Sales page; nothing here moves money.</p>
          {methods.map((m, i) => (
            <div key={m.id} className="flex items-center gap-2">
              <Input
                value={m.label}
                onChange={(e) => setMethods(methods.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                className="w-36"
              />
              <span className="text-zinc-500 dark:text-zinc-400">fee</span>
              <Input
                type="number"
                step="0.1"
                value={m.feePercent}
                onChange={(e) => setMethods(methods.map((x, j) => (j === i ? { ...x, feePercent: Number(e.target.value) } : x)))}
                className="w-20 text-right"
              />
              <span className="text-zinc-500 dark:text-zinc-400">%</span>
              <Button variant="ghost" onClick={() => setMethods(methods.filter((_, j) => j !== i))} disabled={methods.length <= 1}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                const label = prompt("Name of the payment method (e.g. Apple Cash)");
                if (!label) return;
                const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `m${methods.length}`;
                if (methods.some((m) => m.id === id)) return;
                setMethods([...methods, { id, label, feePercent: 0 }]);
              }}
            >
              Add
            </Button>
            <Button disabled={pending} onClick={() => save("paymentMethods", methods)}>
              Save
            </Button>
            {note("paymentMethods")}
          </div>
        </div>
      </Card>

      <Card title="Trades and re-stickering">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Trade-in value is the starting credit for a customer's card on the POS Trade tab (you can change it per card). It also becomes that card's cost for gain and loss.</p>
          <label className="flex items-center gap-2">
            Trade-in value
            <Input type="number" value={tradeIn} onChange={(e) => setTradeIn(Number(e.target.value))} className="w-20 text-right" />% of market
          </label>
          <div className="flex items-center gap-3">
            <Button disabled={pending} onClick={() => save("tradeInPercent", tradeIn)}>
              Save
            </Button>
            {note("tradeInPercent")}
          </div>
          <label className="flex flex-wrap items-center gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
            A sticker is out of date when the suggested price moved at least
            <Input type="number" value={restick.percent} onChange={(e) => setRestick({ ...restick, percent: Number(e.target.value) })} className="w-16 text-right" />
            % and at least $
            <Input
              value={dollars(restick.minCents)}
              onChange={(e) => setRestick({ ...restick, minCents: parseDollars(e.target.value) ?? 0 })}
              className="w-16 text-right"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button disabled={pending} onClick={() => save("restick", restick)}>
              Save
            </Button>
            {note("restick")}
          </div>
        </div>
      </Card>
    </div>
  );
}
