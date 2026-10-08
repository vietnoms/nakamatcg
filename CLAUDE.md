# nakamatcg

TCG tools for one card vendor. The app here is show inventory: Collectr CSV import, pricing, Zebra
ZPL price stickers with QR codes, and an offline phone POS for sales, buys, and trades at shows.
`README.md` has setup and the show-day flow; `docs/decisions.md` records why things are the way they are.

## Rules

- Money is integer cents. Timestamps are `timestamptz`; display time zone from `APP_TZ`.
- One unit per physical copy, each with a 6-character Crockford base32 sticker code (`src/lib/codes.ts`).
- `transactions`, `transaction_lines`, `payments`, `price_history`, `label_prints` are append-only.
  A correction is a void (a new transaction with `voids_transaction_id`).
- Phone deals carry phone-made uuids; `applyOps` must stay idempotent and must never drop a deal.
  A conflict (double sale, unbalanced deal, taken code) is recorded and flagged in `sync_conflicts`.
- Pure logic (codes, pricing, allocation, ZPL, Collectr parsing, deal balance) lives in `src/lib`,
  `src/labels`, `src/import` with tests next to it. Database code lives in `src/server`, tested on
  PGlite in `tests/`.
- The POS (`/pos`, `src/pos`) must keep working offline: no server data at render, no CDN assets.
  `public/sw.js` caches it; bump its `VERSION` only when the cache layout changes.
- Sticker QR links are uppercase (`HTTPS://HOST/U/CODE`) for alphanumeric QR mode; `src/proxy.ts`
  redirects `/U/` to `/u/`. Never change the link format of printed stickers.
- Real collection exports never go in the repo (`*.csv` is ignored outside `fixtures/`).
- Never print or read `.env.local` values.

## Commands

```
pnpm dev / pnpm build / pnpm start
pnpm test               unit + integration (PGlite)
pnpm typecheck
pnpm db:generate        new migration from src/db/schema.ts
pnpm db:migrate         apply migrations to DATABASE_URL
pnpm db:dev             local Postgres (embedded, :54330)
pnpm dev:env            write a local-only .env.local
pnpm passcode:hash      make APP_PASSCODE_HASH
pnpm e2e:offline -- --base http://localhost:3100 --code <in-stock code>
```

Before any library upgrade or new dependency, check the current version and docs; pin exact versions.
