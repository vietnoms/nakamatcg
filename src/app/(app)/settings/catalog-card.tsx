"use client";

import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";

export function CatalogCard({
  items,
  lastOk,
  lastError,
  cardsight,
  claude,
}: {
  items: number;
  lastOk: string | null;
  lastError: string | null;
  cardsight: boolean;
  claude: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg("Refreshing... this takes a few minutes. You can leave this page open.");
    try {
      const res = await fetch("/api/catalog/sync", { method: "POST" });
      const body = (await res.json()) as { items?: number; sets?: number; error?: string };
      setMsg(res.ok ? `Done: ${body.items} prices across ${body.sets} sets. Reload to see the time.` : `Failed: ${body.error}`);
    } catch (e) {
      setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Price catalog and card photos">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          When you buy or trade for a card, the POS can photograph it and fill in the card and its price. Raw prices are
          TCGplayer market prices for Pok&eacute;mon, One Piece and Riftbound (the same source Collectr uses for raw cards), refreshed every
          night. Slab prices come from recent sales on CardSight.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>Catalog:</span>
          {items > 0 ? <Badge tone="green">{items.toLocaleString()} prices</Badge> : <Badge tone="amber">empty</Badge>}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{lastOk ? `updated ${lastOk}` : "never refreshed"}</span>
        </div>
        {lastError && <p className="text-xs text-red-700 dark:text-red-300">Last refresh failed: {lastError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span>Photo services:</span>
          <Badge tone={cardsight ? "green" : "zinc"}>CardSight {cardsight ? "on" : "off"}</Badge>
          <Badge tone={claude ? "green" : "zinc"}>Claude fallback {claude ? "on" : "off"}</Badge>
        </div>
        {(!cardsight || !claude) && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            A service is switched on by adding its key on the server (CARDSIGHT_API_KEY, ANTHROPIC_API_KEY) and redeploying.
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Refreshing..." : "Refresh prices now"}
          </Button>
          {msg && <span className="text-xs text-zinc-500 dark:text-zinc-400">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
