# Football Forecast

Aggregated football match predictions, built entirely on free tiers.
Next.js (App Router) frontend + API routes, Vercel Postgres, Vercel Cron.

## Architecture

```
src/
  collectors/        one module per data source, unified output shape
    footballData.ts   fixtures, results, competitions  (football-data.org API)
    clubElo.ts         Elo ratings                       (clubelo.com public API)
    oddsApi.ts          bookmaker odds -> implied prob     (the-odds-api.com API)
  aggregation/
    poissonModel.ts    Elo + recent-form -> Poisson goal model
    aggregate.ts       orchestrates collectors, writes matches / raw_predictions /
                        aggregated_predictions, called once a day by the cron route
  app/
    page.tsx                        home page: upcoming matches + final prediction
    match/[id]/page.tsx             match detail: per-source breakdown
    api/cron/update/route.ts        cron entrypoint (Vercel Cron, daily)
    api/matches/route.ts            JSON API for the upcoming matches
  lib/
    db.ts              all SQL, via @vercel/postgres
    teamMatch.ts        fuzzy name matching between football-data.org and ClubElo
    config.ts           aggregation weights + tunable constants
db/schema.sql          matches / raw_predictions / aggregated_predictions tables
vercel.json            daily cron schedule
```

## Data sources actually used

| Source | What it provides | Why |
|---|---|---|
| [football-data.org](https://www.football-data.org/) | fixtures, results, competitions | free forever, official API, 10 req/min |
| [ClubElo.com](http://clubelo.com/) | club Elo ratings | free, no key, no documented limit |
| [The Odds API](https://the-odds-api.com/) | bookmaker odds -> market-implied probability | free (500 credits/mo), no card |

**Understat, Opta Analyst (theanalyst.com) and Oddsportal were in the original
spec but were dropped after checking their `robots.txt`** — see
`src/collectors/README.md` for the exact rules that blocked each one and
what replaced them (The Odds API replaces Oddsportal; the statistical model
uses Elo + recent scoring form instead of Understat's xG; Opta's published
probabilities were dropped as a third input rather than scraped).

## Aggregation model

Two independent inputs, combined by weighted average (weights in
`src/lib/config.ts`, `AGGREGATION_WEIGHTS`):

1. **`odds_api`** — de-vigged implied probability from bookmaker odds.
2. **`poisson_elo_model`** — a Poisson goal model: expected goals are derived
   from the Elo rating difference (home advantage baked in) and tilted by
   each team's actual goals-for/against over its last 6 matches, then every
   scoreline's probability is summed into home/draw/away win probability.

## Setup

1. **Install dependencies**: `npm install`
2. **Database**: in the Vercel dashboard, open this project → Storage →
   Create Database → Postgres (Hobby/free tier, no card needed). Vercel
   injects `POSTGRES_URL` automatically once attached.
3. **Apply the schema**: `vercel env pull .env.local` then `npm run db:migrate`
   (or paste `db/schema.sql` into the Postgres query console in the dashboard).
4. **API keys** (Vercel dashboard → Settings → Environment Variables, not
   hardcoded anywhere in the repo):
   - `FOOTBALL_DATA_API_KEY` — free key from https://www.football-data.org/client/register
   - `ODDS_API_KEY` — free key from https://the-odds-api.com/
   - `CRON_SECRET` — any random string; Vercel Cron sends it back as a Bearer
     token so `/api/cron/update` can reject non-Vercel callers.
5. **Deploy**: push to `main`, Vercel builds and deploys automatically.
   `vercel.json` registers the daily cron (`0 5 * * *` UTC) against
   `/api/cron/update`.
6. **First run**: trigger `/api/cron/update` once manually (with the
   `Authorization: Bearer <CRON_SECRET>` header) to populate the database —
   otherwise the home page shows "no upcoming matches" until the first
   scheduled run.

## Known limitations / next steps

- **Team-name matching is heuristic.** football-data.org, ClubElo and The
  Odds API each spell club names slightly differently ("Manchester United"
  vs "Manchester United FC" vs ClubElo's own abbreviations). `teamMatch.ts`
  does normalized fuzzy matching, which works for most top-6-league clubs
  but can miss or mismatch edge cases. A persisted alias table would fix
  this properly.
- **Only 6 competitions tracked** (`TRACKED_COMPETITIONS` in `config.ts`) —
  easy to extend to all 12 football-data.org free-tier competitions (adds
  World Cup, Euros, Championship, etc.), just mind the 10 req/min rate limit
  when adding more.
- **No xG input.** Understat (the natural free xG source) disallows all
  scraping. A legitimate free xG API would be a strong addition if one
  surfaces; until then the Poisson model relies on Elo + recent scoring form.
- **No third "published probability" source.** Opta Analyst explicitly
  blocks AI-agent scraping; no other free, ToS-compliant source of
  ready-made match probabilities was identified. Worth revisiting
  periodically — a new source would slot into `AGGREGATION_WEIGHTS` and a
  new file in `src/collectors/` with no changes to the schema.
- **The Odds API free tier caps at 500 credits/month.** Comfortable for one
  request/competition/day (~180/month across the 6 tracked leagues), but
  don't increase cron frequency past once a day without checking the budget.
- **Cron runs once/day** (Vercel Hobby plan limit) — fine for pre-match
  predictions, not for in-play/live odds.
- **No tests yet.** The Poisson model and team-matching logic are pure
  functions and would be easy to unit test; worth adding before extending
  the model further.
