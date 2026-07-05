# Collectors

Each file returns data in a unified shape and is meant to be called once per
day from the cron endpoint (`/api/cron/update`).

| File | Source | Method | Status |
|---|---|---|---|
| `footballData.ts` | football-data.org | Official API (free tier, 10 req/min) | Active |
| `clubElo.ts` | clubelo.com | Public API, no key | Active |
| `oddsApi.ts` | the-odds-api.com | Official API (free tier, 500 credits/mo) | Active |

## Sources dropped from the original spec

Three sources originally planned as scrapers were checked against their
`robots.txt` before writing any scraper, per the project's own data-sourcing
rules, and dropped:

- **Understat.com** — `robots.txt` sets `Disallow: /` for all user agents.
  No scraping allowed, full stop.
- **Opta Analyst (theanalyst.com)** — `robots.txt` explicitly lists
  `anthropic-ai`, `ClaudeBot` and ~30 other AI-agent user agents under
  `Disallow: /`. This blocks the exact agent that would have written and run
  this scraper.
- **Oddsportal.com** — general pages are technically crawlable, but
  `robots.txt` disallows `*/ajax-nextgames-odds/*`, the endpoint that would
  actually be needed to pull fresh upcoming-match odds, and the site runs
  Cloudflare bot protection on top of that.

**Replacement:** `oddsApi.ts` (The Odds API) provides the same underlying
signal as Oddsportal — real bookmaker odds, convertible to market-implied
probability — through a documented, ToS-compliant free API instead. The
Elo+xG statistical model was re-scoped to Elo+recent-goals (see
`src/aggregation/poissonModel.ts`) since Understat's xG data isn't legally
scrapable; Opta's published probabilities were dropped as a third input, so
the final aggregation combines two independent sources instead of three
(weights in `src/lib/config.ts`).
