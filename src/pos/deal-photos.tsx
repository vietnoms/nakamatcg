"use client";

import { useCallback, useEffect, useState } from "react";
import { shrink } from "./card-lookup";
import { posDb, type LocalPhoto } from "./db";

/**
 * Photos of the deal being built (the pile across the table, the agreed numbers). Kept on the
 * phone with no signal; once the deal is recorded they go with it and upload after it syncs.
 */
export function useCartPhotos(draftId: string) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const load = useCallback(
    async () => setPhotos((await posDb().photos.where("draftId").equals(draftId).sortBy("takenAt")).filter((p) => p.state === "cart")),
    [draftId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return {
    photos,
    add: async (file: File) => {
      const blob = await shrink(file);
      await posDb().photos.put({ id: crypto.randomUUID(), draftId, dealId: null, blob, takenAt: new Date().toISOString(), state: "cart" });
      await load();
    },
    remove: async (id: string) => {
      await posDb().photos.delete(id);
      await load();
    },
    /** the deal is recorded: this draft's photos go with it and wait to upload */
    attach: async (dealId: string) => {
      await posDb().photos.where("draftId").equals(draftId).and((p) => p.state === "cart").modify({ dealId, state: "pending" });
      await load();
    },
  };
}

export type CartPhotos = ReturnType<typeof useCartPhotos>;

function Thumb({ photo, onRemove }: { photo: LocalPhoto; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo.blob) return;
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo.blob]);
  return (
    <li className="relative">
      {url && <img src={url} alt="Deal photo" className="h-20 w-20 rounded-md object-cover" />}
      <button type="button" aria-label="Remove photo" onClick={onRemove} className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-zinc-900 text-sm leading-none text-white dark:bg-zinc-100 dark:text-zinc-950">
        ×
      </button>
    </li>
  );
}

export function DealPhotos({ cart }: { cart: CartPhotos }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <span aria-hidden>📷</span> {busy ? "Saving..." : cart.photos.length ? "Another photo of the deal" : "Photo of the deal"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            try {
              await cart.add(f);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {cart.photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {cart.photos.map((p) => (
            <Thumb key={p.id} photo={p} onRemove={() => void cart.remove(p.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
