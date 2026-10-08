/** What the phone keeps offline. Shared by the snapshot API and the POS (no server-only imports). */
import type { ProductKind } from "@/import/collectr";
import type { PaymentMethod } from "@/lib/settings";
import type { PricingRule } from "@/lib/pricing";

export type UnitStatus = "in_stock" | "sold" | "traded_out" | "removed";

export type PosUnit = {
  id: string;
  code: string;
  status: UnitStatus;
  priceCents: number | null;
  costCents: number | null;
  productId: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  badge: string;
  marketCents: number | null;
  /** ISO time of the server's last change */
  updatedAt: string;
};

export type PosProduct = {
  id: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  condition: string;
  grader: string;
  grade: string;
  marketCents: number | null;
};

export type PosEvent = { id: string; name: string; startsOn: string; endsOn: string };

export type PosSnapshot = {
  /** the database clock at the time of the snapshot: the next pull asks for changes since then */
  serverTime: string;
  full: boolean;
  units: PosUnit[];
  products: PosProduct[];
  settings: { paymentMethods: PaymentMethod[]; tradeInPercent: number; pricing: PricingRule; activeEventId: string | null };
  events: PosEvent[];
};
