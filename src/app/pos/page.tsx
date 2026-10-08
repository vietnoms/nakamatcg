import type { Metadata } from "next";
import { PosApp } from "@/pos/pos-app";

export const metadata: Metadata = { title: "Nakama POS" };

/**
 * Static on purpose: the service worker caches this page so it opens with no signal. Everything
 * it shows comes from the phone's own IndexedDB copy of the inventory.
 */
export default function PosPage() {
  return <PosApp />;
}
