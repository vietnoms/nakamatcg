# nakamatcg

TCG tools for Nakama's Card Club. The first one: **show inventory**. Import a Collectr portfolio,
price every card, print Zebra price stickers with QR codes, and sell, buy, and trade at a show from
a phone that keeps working with no signal.

## How it fits together

- **Laptop (Chrome):** Import, Pricing, Labels (Zebra printing), Sales, Settings.
- **Phone:** `/pos`, added to the home screen. Scans sticker QR codes with the camera, keeps the
  whole inventory offline, and syncs deals when there is signal.
- **Server:** Next.js on Vercel, Postgres on Neon. Every deal is a row the phone made with its own id,
  so syncing twice never double-counts.

## Show-day checklist

**The day before (sticker day)**

1. Export the Collectr portfolio as CSV. **Import** it; untick a personal-collection portfolio.
2. **Pricing:** type a price and press Enter, or press Enter on an empty box to take the suggestion.
3. **Labels:** load the 1.5 x 1 in roll, press **Calibrate roll** once, print a **Test sticker**,
   scan it with the phone camera (it should open the card page), then **Print** the queue.
4. **Sales > New show:** name, dates, starting cash in the box. It becomes the active show.
5. On the phone: open `/pos` while online, **Add to Home Screen**, open it from the icon, and wait
   for **Offline ready** in the header. Turn on airplane mode and scan a sticker to be sure.
6. Optional: print the paper backup list at `/inventory/print`.

**At the show**

- **One cart per deal (Deal tab):** scan your cards going out; tap **+ Their cards** for anything coming in
  (photo or search, check, Add) at your offer %. The bottom shows who pays whom: type another amount if you
  agree on one, pick how it was paid, Confirm. A sale, buy or trade follows from what is in the cart.
  Undo is on the toast for 8 seconds; any deal can be voided from History. Cards coming in wait in the
  laptop's label queue for stickers.
- **Customer's card unknown?** Under **+ Their cards**, tap **Take photo**: CardSight (Claude as backup) reads the
  card or slab, and the TCGplayer price fills in. Or type a few words in **search prices**. Needs signal.
- No signal: keep selling. The header shows how many deals are waiting; they sync on their own.

**After the show:** Sales shows revenue, profit, payment totals, and the cash box count. Export the
sold cards CSV to remove them from Collectr. **Gains** sorts every card by gain or loss against your
cost: in stock against today's market price (unrealized), sold against what it brought in
(realized); both export as CSV for your P&L.

## Setup

### Local development

```bash
pnpm install
pnpm dev:env      # writes .env.local for local use (passcode: local-dev-passcode)
pnpm db:dev       # local Postgres on 127.0.0.1:54330, no Docker; leave it running
pnpm dev          # http://localhost:3000
```

`pnpm test` runs unit and integration tests (in-process Postgres via PGlite). `pnpm e2e:offline`
runs the offline rehearsal in the installed Edge against a running server; see the script header.

### Production (Vercel + Neon)

1. Create a Vercel project from this repo and add Neon Postgres from the Vercel Marketplace
   (it sets `DATABASE_URL`).
2. Set the other variables (names in `.env.example`):
   - `APP_PASSCODE_HASH`: run `pnpm passcode:hash` locally and paste the output line.
   - `SESSION_SECRET`: any long random string.
   - `PUBLIC_BASE_URL`: the address printed into every QR code. **Pick it before printing
     stickers**; changing it later breaks camera-app links on old stickers (in-app scanning still works).
   - `APP_TZ`: e.g. `America/Los_Angeles`.
   - `CARDSIGHT_API_KEY` (free key at cardsight.ai) and `ANTHROPIC_API_KEY` (console.anthropic.com):
     photo lookup for cards coming in. Either one alone works; CardSight is tried first.
   - `CRON_SECRET`: any long random string; lets Vercel's nightly price-catalog refresh in.
3. Run the migrations against the production database: `DATABASE_URL=... pnpm db:migrate`.
4. Deploy, then sign in at `/login`.

### Zebra printer

Printing uses **Zebra Browser Print** (free, from Zebra's support site) on the laptop the printer is
plugged into. Labels are ZPL, so the printer must speak ZPL (most Zebra desktop printers do). If
Browser Print is not available, **Download .zpl** and send the file raw to a shared printer:
`copy /b stickers.zpl \\localhost\<printer share name>`, then **Mark printed**.
