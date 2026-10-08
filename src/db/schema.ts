/**
 * Inventory, stickers, and show transactions. Money is integer cents, times are timestamptz.
 *
 * Ids are uuids so the phone can create transactions and bought units offline and sync them
 * later. transactions, transaction_lines, payments, price_history and label_prints are
 * append-only: a correction is a new row (a void is a transaction with voids_transaction_id).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** raw | slab | sealed */
    kind: text("kind").notNull(),
    game: text("game").notNull().default(""),
    name: text("name").notNull(),
    setName: text("set_name").notNull().default(""),
    cardNumber: text("card_number").notNull().default(""),
    variant: text("variant").notNull().default(""),
    rarity: text("rarity").notNull().default(""),
    /** raw cards: NM, LP, MP, HP, DMG */
    condition: text("condition").notNull().default(""),
    grader: text("grader").notNull().default(""),
    grade: text("grade").notNull().default(""),
    cert: text("cert").notNull().default(""),
    language: text("language").notNull().default(""),
    /** productKey() from src/import/collectr.ts: a re-import updates instead of duplicating */
    naturalKey: text("natural_key").notNull(),
    marketCents: integer("market_cents"),
    marketUpdatedAt: ts("market_updated_at"),
    tcgplayerProductId: integer("tcgplayer_product_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_natural_key_uq").on(t.naturalKey), index("products_name_idx").on(t.name)],
);

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  summary: jsonb("summary").notNull(),
  appliedAt: ts("applied_at").notNull().defaultNow(),
});

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** the sticker code, 6 Crockford base32 characters */
    code: text("code").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    costCents: integer("cost_cents"),
    acquiredAt: ts("acquired_at").notNull().defaultNow(),
    /** import | buy | trade_in | manual */
    source: text("source").notNull(),
    importId: uuid("import_id").references(() => imports.id),
    /** in_stock | sold | traded_out | removed */
    status: text("status").notNull().default("in_stock"),
    /** the price the card should carry now */
    priceCents: integer("price_cents"),
    /** what the physical sticker says, and when and against which market price it was printed */
    stickeredPriceCents: integer("stickered_price_cents"),
    stickeredAt: ts("stickered_at"),
    stickeredMarketCents: integer("stickered_market_cents"),
    /** a damaged or lost sticker: print again even though the price is unchanged */
    reprint: boolean("reprint").notNull().default(false),
    note: text("note").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** bumped on every change; the phone pulls units changed since its last snapshot */
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("units_code_uq").on(t.code),
    index("units_product_idx").on(t.productId),
    index("units_status_idx").on(t.status),
    index("units_updated_idx").on(t.updatedAt),
  ],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    marketCents: integer("market_cents").notNull(),
    /** collectr | manual | tcgcsv */
    source: text("source").notNull(),
    importId: uuid("import_id").references(() => imports.id),
    observedAt: ts("observed_at").notNull().defaultNow(),
  },
  (t) => [index("price_history_product_idx").on(t.productId, t.observedAt)],
);

export const labelPrints = pgTable(
  "label_prints",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    priceCents: integer("price_cents").notNull(),
    printedAt: ts("printed_at").notNull().defaultNow(),
  },
  (t) => [index("label_prints_unit_idx").on(t.unitId)],
);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  startingCashCents: integer("starting_cash_cents").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    /** generated on the device that recorded it: syncing the same transaction twice is a no-op */
    id: uuid("id").primaryKey(),
    /** sale | buy | trade | void */
    kind: text("kind").notNull(),
    eventId: uuid("event_id").references(() => events.id),
    occurredAt: ts("occurred_at").notNull(),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    note: text("note").notNull().default(""),
    voidsTransactionId: uuid("voids_transaction_id"),
    device: text("device").notNull().default(""),
  },
  (t) => [
    index("transactions_event_idx").on(t.eventId, t.occurredAt),
    uniqueIndex("transactions_voids_uq").on(t.voidsTransactionId).where(sql`voids_transaction_id is not null`),
  ],
);

export const transactionLines = pgTable(
  "transaction_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    /** null for a misc line (bulk bin, unstickered card) */
    unitId: uuid("unit_id").references(() => units.id),
    /** out: a card leaves the table (sold, traded away); in: a card arrives (bought, traded in) */
    direction: text("direction").notNull(),
    /** this line's share of the deal: sale revenue for out, cost basis for in */
    amountCents: integer("amount_cents").notNull(),
    stickerCents: integer("sticker_cents"),
    costCents: integer("cost_cents"),
    description: text("description").notNull().default(""),
  },
  (t) => [index("transaction_lines_txn_idx").on(t.transactionId), index("transaction_lines_unit_idx").on(t.unitId)],
);

export const payments = pgTable(
  "payments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    /** a payment method id from settings: cash, venmo, zelle, ... */
    method: text("method").notNull(),
    /** in: money to me; out: money I paid */
    direction: text("direction").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [index("payments_txn_idx").on(t.transactionId)],
);

/** A synced transaction that touched a unit some other transaction already sold. Kept, flagged for review. */
export const syncConflicts = pgTable("sync_conflicts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id),
  unitId: uuid("unit_id").references(() => units.id),
  reason: text("reason").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  resolvedAt: ts("resolved_at"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    ok: boolean("ok").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_idx").on(t.ip, t.at)],
);

/**
 * TCGplayer's catalog for Pokemon and One Piece, from tcgcsv.com (a daily mirror of TCGplayer's
 * API), refreshed nightly. One row per product and printing (Normal, Holofoil, Reverse
 * Holofoil, ...), each with its own market price. Used to price cards customers bring to the
 * table; derived data, safe to drop and re-sync.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: integer("product_id").notNull(),
    /** TCGplayer printing: Normal, Holofoil, Reverse Holofoil, 1st Edition Holofoil, ...; "" when unpriced */
    subType: text("sub_type").notNull(),
    /** pokemon | one_piece */
    game: text("game").notNull(),
    groupId: integer("group_id").notNull(),
    setName: text("set_name").notNull(),
    name: text("name").notNull(),
    cleanName: text("clean_name").notNull(),
    number: text("number").notNull().default(""),
    /** normalizeNumber(number): the part before the slash, no leading zeros, for matching scans */
    numberKey: text("number_key").notNull().default(""),
    rarity: text("rarity").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    marketCents: integer("market_cents"),
    lowCents: integer("low_cents"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_items_product_subtype_uq").on(t.productId, t.subType),
    index("catalog_items_number_idx").on(t.game, t.numberKey),
    index("catalog_items_name_idx").on(t.game, t.cleanName),
  ],
);

export const catalogSyncs = pgTable("catalog_syncs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  items: integer("items"),
  error: text("error"),
});
