# nakamatcg — pallet sniper

TCG Tools for Nakama's Card Club.

**Pallet sniper** is a local-first web app that watches the [PalletTrade](https://pallet.trade)
deal feed for underpriced trading-card listings, runs Claude-vision condition analysis on the
listing photos, and pings Discord so you can snipe manually.

> **This app never buys or bids.** It is notify-only, by design.

## How it works

```
PalletTrade MCP feed ──poll──▶ SQLite cache ──rules──▶ analysis queue
                                                          │
                                    eBay Browse API ──────┤ (image tier 1)
                                    Playwright + Chrome ──┤ (tier 2 — beats eBay's TLS block)
                                    i.ebayimg.com CDN ────┘ (tier 3, primary photo only)
                                                          │
                                             Claude vision verdict (structured JSON)
                                                          │
                                          Discord webhook embed (BUY / MAYBE / PASS)
```

- **Deal browser** — filter the live feed (tier, price, % off, grader/grade, auctions/BIN,
  ends-within), see price vs market estimate, auction countdowns, and analysis verdicts inline.
- **AI condition analysis** — all listing photos go to the Claude API with a professional
  card-grader system prompt; you get a structured verdict: assessed condition (NM/LP/MP/HP/DMG/
  slab-verified), claim match, flaw list with photo locations, red flags, BUY/MAYBE/PASS,
  confidence + reason.
- **Auto-analysis rules** — e.g. "auto-analyze new eBay steals ≥35% off under $300". The poller
  detects NEW listings, dedupes by listing id, and enqueues matches. Hard budget caps
  (per-hour, per-day, daily $ spend) are enforced atomically in SQLite; a listing is never
  auto-analyzed twice.
- **Discord alerts** — rich embeds with card, thumbnail, price vs estimate, verdict, top flaws,
  deep link, and a live auction countdown. Red + `[ENDING SOON]` for auctions ending < 2h.

## Windows quickstart

Prereqs: [Node.js 20 or 22](https://nodejs.org) and Google Chrome installed
(Chrome is what gets past eBay's TLS-fingerprint blocking for image scraping).

```powershell
git clone https://github.com/vietnoms/nakamatcg
cd nakamatcg
npm install
copy .env.example .env     # then fill in your keys (see below)
npm run build
npm start                  # → http://127.0.0.1:8787
```

Dev mode (hot reload): `npm run dev` → UI at http://localhost:5173.

### .env keys

| Key | Required | Where to get it |
|---|---|---|
| `PALLET_TRADE_TOKEN` | yes | pallet.trade MCP token (`pt_mcp_...`) |
| `ANTHROPIC_API_KEY` | yes (for analysis) | console.anthropic.com |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | recommended | free production keyset at developer.ebay.com — best image source (full gallery + item specifics) |
| `DISCORD_WEBHOOK_URL` | optional | Discord channel → Integrations → Webhooks |

Missing keys degrade gracefully: no eBay creds → Playwright/CDN image fallback; no Discord →
no notifications; no Anthropic key → browsing only.

### Verify each integration (smoke scripts)

Run these once after setup, in order:

```powershell
npm run smoke:mcp        # PalletTrade feed reachable, deals parse
npm run smoke:ebay       # eBay OAuth + full image gallery for a live deal
npm run smoke:images     # 3-tier image chain end-to-end (writes ./tmp/*.jpg to eyeball)
npm run smoke:analyze    # one real Claude analysis (~$0.03–0.10)
npm run smoke:discord    # test embed in your channel
npm run smoke:e2e        # poll → rule match → auto-analysis → Discord embed
```

## Your grader prompt

The analysis system prompt lives at [`prompts/card-verifier.md`](prompts/card-verifier.md).
A solid default ships in-repo; **paste your own tuned grader prompt over it** (drop any agent
frontmatter) and restart the app. The structured verdict schema is enforced separately, so
swapping the prompt is always safe.

## Costs & budget guards

A typical 10-photo analysis ≈ 18k input + ~1–3k output tokens:
- `claude-sonnet-5`: **≈ $0.07–0.10** per analysis
- `claude-haiku-4-5`: **≈ $0.02–0.03** per analysis

Defaults: max 10 auto-analyses/hour, 40/day, $5/day spend cap (Settings page). Caps are
enforced in the database itself; manual analyses bypass the count caps but count toward spend.

## Development

```bash
npm run typecheck   # server + web strict TS
npm test            # vitest, no network needed
npm run build       # tsc → dist/ + vite → web/dist
```

Notes:
- Do **not** commit a repo-root `.mcp.json` — CI (`.github/workflows/claude.yml`) generates an
  ephemeral one at runtime. It's gitignored; keep it that way.
- SQLite lives in `data/app.sqlite` (WAL). Delete it to reset the cache; analyses/rules go with it.
- To keep it running 24/7 on Windows, use Task Scheduler ("At log on", run `npm start` in the
  repo directory) or [pm2-windows-service](https://www.npmjs.com/package/pm2-windows-service).
