# Decisions

## 2026-10-07: first build, for a show on 2026-10-10

**Stack.** Next.js 16 App Router, Postgres on Neon via Drizzle, Vercel, pnpm, Vitest, pinned to the
versions the pool dashboard already runs. Tailwind with a handful of local components instead of the
shadcn CLI, to save setup time before the show.

**Hosted, phone-first, offline-capable.** The phone scans with its camera. Show halls have bad signal,
so the POS is a PWA: the page is cached by a hand-written service worker (no PWA plugin: fewer
moving parts with Turbopack), the inventory lives in IndexedDB (Dexie), and deals wait in an outbox.
After each pull the pending deals are replayed locally, so an offline sale never reappears as in stock.

**One unit per copy.** A Collectr row with quantity 3 becomes 3 units with their own codes. A
re-scan of a sold sticker is caught, and each copy keeps its own cost.

**Re-imports only add.** A product matches by a natural key (cert for slabs; otherwise game, set,
number, name, variant, condition, grade, language). New units = file quantity minus units *ever*
imported for that product, so a card sold at a show but still in Collectr is not imported again. The
cost: a copy added to Collectr after an earlier one was sold here is missed. Buys at shows are the
normal way in.

**Collectr's CSV header was not known** when this was built. Columns are found by name from an alias
list and the import page lets the user fix the mapping. Pin the real header in a fixture once seen.

**Deals.** Sales, bundles, buys, and trades are one `deal` op: cards out, misc lines, cards in,
payments. They must balance (goods out minus goods in equals money in minus money out). The server
still records one that does not, and flags it. Bundle prices are split across cards by sticker price
with the largest-remainder method, so per-card profit stays right. Trade-ins carry their trade value
as cost basis.

**Voids, not edits.** A void restocks cards out and removes cards in. Reports ignore voided deals.

**Stickers.** 1.5 x 1 in direct thermal, ZPL via Zebra Browser Print. The QR holds an uppercase link
(alphanumeric mode, version 2 at 203 dpi). `^BQ` prints 10 dots below its field origin at every size
(measured with Labelary), so the origin is raised. The rendered QRs decode with ZXing to the exact link.

**Auth.** One passcode (scrypt hash in `APP_PASSCODE_HASH`, colon-separated because Next expands `$`
in `.env` files) and a 90-day signed cookie. Failed logins are rate limited per IP.

## 2026-10-08

**Whole-dollar prices.** Viet asked for suggestions rounded up to the dollar, no $0.50 prices: under
$50 rounds up to the next dollar, $50 and up to the next $5, never below $1. A rule saved in Settings
overrides the default.

**Gain and loss.** Unrealized = last imported market price minus each copy's cost, grouped by card and
cost; realized = each card's share of its deal minus its cost, voided deals excluded. Copies with no
cost (Collectr's 0.0000) or no market price are counted but left out of the totals, never treated as $0.

**Not built yet (after the show):** re-sticker warnings page (`/restick`) comparing sticker prices
with fresh suggestions; automatic price refresh (tcgcsv.com for raw cards); sales tax.
