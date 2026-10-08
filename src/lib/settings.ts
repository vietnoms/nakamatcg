/** App settings: shapes and defaults. Shared by the server and the phone (no server-only imports). */
import { z } from "zod";
import { DEFAULT_PRICING, DEFAULT_RESTICK } from "./pricing";
import { DEFAULT_LABEL } from "@/labels/zpl";

const Tier = z.object({ belowCents: z.number().int().positive().nullable(), stepCents: z.number().int().positive() });

export const PricingRuleSchema = z.object({
  percent: z.number().min(1).max(500),
  mode: z.enum(["nearest", "up", "down"]),
  tiers: z.array(Tier).min(1),
  minCents: z.number().int().min(0),
});

export const RestickSchema = z.object({ percent: z.number().min(0).max(100), minCents: z.number().int().min(0) });

export const LabelSchema = z.object({
  widthIn: z.number().min(0.5).max(4),
  heightIn: z.number().min(0.5).max(6),
  dpi: z.number().int().min(150).max(600),
  darkness: z.number().int().min(-30).max(30),
  offsetXDots: z.number().int().min(0).max(200),
  offsetYDots: z.number().int().min(0).max(200),
  speed: z.number().int().min(2).max(6),
});

export const PaymentMethodSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(1),
  /** processor fee, for profit reports; the app never moves money */
  feePercent: z.number().min(0).max(20),
});
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "cash", label: "Cash", feePercent: 0 },
  { id: "venmo", label: "Venmo", feePercent: 0 },
  { id: "zelle", label: "Zelle", feePercent: 0 },
  { id: "paypal", label: "PayPal", feePercent: 0 },
  { id: "card", label: "Card", feePercent: 2.6 },
  { id: "other", label: "Other", feePercent: 0 },
];

export const SETTINGS = {
  pricing: { schema: PricingRuleSchema, default: DEFAULT_PRICING },
  restick: { schema: RestickSchema, default: DEFAULT_RESTICK },
  label: { schema: LabelSchema, default: DEFAULT_LABEL as z.infer<typeof LabelSchema> },
  paymentMethods: { schema: z.array(PaymentMethodSchema).min(1), default: DEFAULT_PAYMENT_METHODS },
  /** what a trade-in card is worth to me, as a percentage of its market price */
  tradeInPercent: { schema: z.number().min(0).max(200), default: 80 as number },
  activeEventId: { schema: z.string().uuid().nullable(), default: null as string | null },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type AppSettings = { [K in SettingKey]: (typeof SETTINGS)[K]["default"] };

/** Stored values that no longer parse fall back to the default instead of breaking a page. */
export function parseSettings(stored: Record<string, unknown>): AppSettings {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const parsed = SETTINGS[key].schema.safeParse(stored[key]);
    out[key] = parsed.success ? parsed.data : SETTINGS[key].default;
  }
  return out as AppSettings;
}
