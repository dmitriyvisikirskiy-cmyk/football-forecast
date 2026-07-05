// Collector: The Odds API (https://the-odds-api.com/)
//
// Replaces the originally-planned Oddsportal.com scraper. Oddsportal's
// robots.txt disallows the ajax-nextgames-odds/* endpoint that a scraper
// would need for fresh odds, and the site is behind Cloudflare bot
// protection — scraping it would be unstable and against the site's stated
// crawl rules. The Odds API provides the same underlying signal (real
// bookmaker odds -> market-implied win/draw/loss probability) legitimately,
// for free, via a documented API (500 credits/month, no card required).
//
// Docs: https://the-odds-api.com/liveapi/guides/v4/

const BASE_URL = "https://api.the-odds-api.com/v4";

// The Odds API's own competition keys (soccer_*), mapped from our
// football-data.org competition codes.
const COMPETITION_TO_ODDS_API_SPORT: Record<string, string> = {
  PL: "soccer_epl",
  PD: "soccer_spain_la_liga",
  BL1: "soccer_germany_bundesliga",
  SA: "soccer_italy_serie_a",
  FL1: "soccer_france_ligue_one",
  CL: "soccer_uefa_champs_league",
};

export interface OddsApiMatchOdds {
  homeTeam: string;
  awayTeam: string;
  commenceTimeUtc: string;
  competitionCode: string;
  // Decimal odds averaged across all bookmakers returned for this event.
  avgHomeOdds: number;
  avgDrawOdds: number | null;
  avgAwayOdds: number;
  bookmakerCount: number;
}

function apiKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY is not set");
  return key;
}

/**
 * Fetches h2h (moneyline) odds for every tracked competition that The Odds
 * API supports. One request per sport key — well within the 500
 * credits/month free tier for a once-a-day cron.
 */
export async function collectOdds(): Promise<OddsApiMatchOdds[]> {
  // The Odds API's free tier is a monthly credit budget, not a per-minute
  // rate limit, so unlike football-data.org these requests can run
  // concurrently — that matters on Vercel Hobby's 60s function cap.
  const perCompetition = await Promise.all(
    Object.entries(COMPETITION_TO_ODDS_API_SPORT).map(async ([competitionCode, sportKey]) => {
      const matches: OddsApiMatchOdds[] = [];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${apiKey()}&regions=eu&markets=h2h&oddsFormat=decimal`;
        const res = await fetch(url, { next: { revalidate: 3600 }, signal: controller.signal });
        if (!res.ok) {
          console.error(`[oddsApi] ${sportKey} failed: ${res.status}`);
          return matches;
        }
        const events = await res.json();
        for (const event of events) {
          const averaged = averageBookmakerOdds(
            event.bookmakers ?? [],
            event.home_team,
            event.away_team
          );
          if (!averaged) continue;
          matches.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            commenceTimeUtc: event.commence_time,
            competitionCode,
            ...averaged,
          });
        }
      } catch (err) {
        console.error(`[oddsApi] failed for ${sportKey}:`, err);
      } finally {
        clearTimeout(timeout);
      }
      return matches;
    })
  );

  return perCompetition.flat();
}

/**
 * The Odds API's h2h market returns `outcomes`, each `{ name, price }`,
 * where `name` is either "Draw" or the literal team name. We identify
 * home/away by position: for soccer h2h markets The Odds API always orders
 * outcomes as [home, away, draw] or [home, draw, away] depending on region,
 * so we match by name against the event's home_team/away_team instead of
 * relying on position.
 */
function averageBookmakerOdds(
  bookmakers: any[],
  homeTeam: string,
  awayTeam: string
): { avgHomeOdds: number; avgDrawOdds: number | null; avgAwayOdds: number; bookmakerCount: number } | null {
  const homeOdds: number[] = [];
  const awayOdds: number[] = [];
  const drawOdds: number[] = [];

  for (const bm of bookmakers) {
    const market = bm.markets?.find((m: any) => m.key === "h2h");
    if (!market?.outcomes) continue;
    for (const outcome of market.outcomes) {
      if (outcome.name === "Draw") drawOdds.push(outcome.price);
      else if (outcome.name === homeTeam) homeOdds.push(outcome.price);
      else if (outcome.name === awayTeam) awayOdds.push(outcome.price);
    }
  }

  if (homeOdds.length === 0 || awayOdds.length === 0) return null;

  return {
    avgHomeOdds: average(homeOdds),
    avgDrawOdds: drawOdds.length > 0 ? average(drawOdds) : null,
    avgAwayOdds: average(awayOdds),
    bookmakerCount: bookmakers.length,
  };
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Converts averaged decimal odds into de-vigged (margin-removed) implied
 * probabilities. Raw implied probability = 1/odds; these always sum to
 * >1 (the bookmaker's overround), so we normalize back to 1.
 */
export function impliedProbabilitiesFromOdds(
  homeOdds: number,
  drawOdds: number | null,
  awayOdds: number
): { homeProb: number; drawProb: number; awayProb: number } {
  const rawHome = 1 / homeOdds;
  const rawAway = 1 / awayOdds;
  const rawDraw = drawOdds ? 1 / drawOdds : 0;

  const overround = rawHome + rawDraw + rawAway;

  return {
    homeProb: rawHome / overround,
    drawProb: rawDraw / overround,
    awayProb: rawAway / overround,
  };
}
