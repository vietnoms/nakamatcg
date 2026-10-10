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

**Photo lookup for cards coming in.** Viet chose CardSight (free tier, 750 identifications a month;
reads raw cards and slab labels for Pokemon and One Piece) with Claude vision as the backup when
CardSight is unsure, fails, or names a card the price catalog doesn't have. Claude runs
`claude-opus-5-5` at low effort with structured output and `fallbacks: "default"`. Raw prices come
from TCGplayer's catalog via tcgcsv.com (the source Collectr uses for raw cards), synced nightly by a
Vercel cron into `catalog_items` (about 55,000 prices, a few seconds). Slab prices are the median of
CardSight's last 90 days of sales at that company and grade, when CardSight identified the card.
Scrydex was considered; its $29 plan has neither vision nor graded prices. Lookup needs signal; the
form still works by hand offline.

**Not built yet (after the show):** re-sticker warnings page (`/restick`) comparing sticker prices
with fresh suggestions; automatic price refresh (tcgcsv.com for raw cards); sales tax.

**Dark theme.** Viet asked for the whole site in dark mode, replacing the earlier light-only call,
then for a light/dark toggle. Every color class is a light/`dark:` pair; `dark:` keys off
`data-theme` on `<html>` (not the OS setting), set before paint by an inline script from
localStorage. Dark is the default. Printouts stay black on white.

**Confirm, then batch, cards coming in.** A photo or catalog pick no longer fills the form straight
away: it opens a confirm step (the photo next to the catalog image, condition, amounts) whose
**Add to cart** puts the card in the deal's cart as its own line, ready for the next card. Buy and
Trade each have a 60-100% of market slider, remembered on the phone; moving it re-prices the cart
except amounts typed by hand. An offer under $1 keeps its cents instead of rounding down to $0, so a
stack of cheap cards adds up; $1 and over still rounds down on the pricing steps.

**Fold-over sticker layout.** Viet wanted less of the card covered: a second layout (Settings >
Stickers > Layout) puts only the price and condition on a front strip (0.5 in by default); a blank
band for the toploader's edge follows, then the back with the QR, code, date, price, name and set.
The left part goes on the front at the toploader's right edge and the rest wraps around it, so the
back reads upright when the toploader is turned over side to side. Both layouts are lists of fields
that the ZPL and the on-screen preview draw from, so the preview matches the printout. The QR link is
unchanged.

**Groups and consignment.** Viet wanted cards organized into groups named after Collectr
portfolios, and to sell other people's cards on consignment. `unit_groups` holds the groups; each
unit has an optional `group_id`. An own import makes one group per portfolio and fills in groups for
copies imported before groups existed (oldest copy first). A consignor's CSV is imported into their
consignment group with no cost, and is compared only with that group's earlier imports, so their
copies never block or duplicate mine (my imports likewise ignore consigned units). Consigned units
are left out of gain and loss. My fee is a percentage (basis points) of each card's share of its
deal, with an optional minimum per card, capped at the sale; voided deals are left out. The group
page reports it by day range in `APP_TZ` and downloads a statement CSV. There is no payout ledger
yet: settle up by date range.

**Personal collection (PC).** Viet wanted a one-tap way to keep a card instead of pricing it. Groups
gained a third kind, `personal`: its cards are left out of Pricing, the sticker queue, the home page
stock counts, the paper inventory list, and re-pricing; the phone gets them as `removed`, so they
cannot be rung up. **Move to PC** on a Pricing row moves my in-stock copies of that card (never
consigned ones) into the first personal group, making "PC" if there is none, and clears their price.
PC cards stay in gain and loss: they are still mine. To sell one after all, move it to another group.

**Sealed product.** Sealed was already a product kind (Collectr import, Pricing filter, POS Buy).
What was missing: a way to add stock bought outside Collectr and outside a show (Import page, **Add
stock by hand**: catalog search or photo, qty, cost each, price each, group; units get
`source = 'manual'`), and a way to sell it without stickers. Sealed now stays out of the sticker
queue unless Settings turns sealed stickers on (a reprint asked for by code still prints). The POS
**Sealed** button lists in-stock sealed by product with a quantity, and the cart shows copies of one
product at one price on one line. Each copy is still its own unit with its own code, so the
one-unit-per-copy rule and the sale ops are unchanged.

**Set all in view to market.** A Pricing button that re-prices every card in the current view,
priced or not, to `suggestPrice` (market times the pricing rule's percent, rounded by its tiers),
so "market" means the same thing as the suggested column. Cards with no market price are left alone.

**Printer status.** Calibrate (`~JC`) acts at once, even on a paused printer; stickers (`^XA...^XZ`)
wait while the printer is paused, its head is open, or it expects a ribbon, so "calibrate works,
printing does nothing" looked like a bug in the page. The Stickers page now asks the printer for
its host status (`~HS`, read back through Browser Print's `read`) after finding it and after each
print, and says what stops it in plain words. It has Resume (`~PS`), Clear stuck jobs (`~JA`) and
a Plain test label that ignores the sticker settings, to tell a printer problem from a layout one.

**Riftbound.** Added as a third game for the price catalog and the photo lookup (Viet,
2026-10-10). Inventory, stickers, the POS and reports never cared about the game. The catalog syncs
TCGplayer category 89 from tcgcsv.com (found in other open-source projects' code; tcgcsv.com was
unreachable from the build sandbox, so the first nightly sync confirms it). Riftbound numbers such as
`OGN-066/298` normalize to `66`, so a photo read with the set code matches a catalog number without
it, and the other way round. CardSight tries a `riftbound` segment; if it has none, photos fall back
to Claude, whose prompt now describes Riftbound cards.

**Separate by group everywhere.** Viet wanted every page to split by group. One `?group=` address
parameter (a group id, or `none` for cards in no group) drives a shared Group picker on Home,
Pricing, Sales, Gains and the paper list; Stickers reads it as its starting filter. In a group view,
**Pricing** prices only that group's copies, so a consignor's copy can carry a different price from
mine (Move to PC is hidden for consignment groups; PC groups are not offered, as they have no
prices). **Sales** counts only that group's card lines, by each unit's current group, since one
deal can mix groups. Payments and the cash box belong to whole deals, so a group view hides them,
and card fees are split by the group's share of each deal's sales. **Gains** offers no consignment
groups (those cards are not mine). The sold and gains CSV exports take the same parameter.
