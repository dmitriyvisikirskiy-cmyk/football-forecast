// Central, tweakable constants for the whole project.

/**
 * Aggregation weights: how much each independent prediction source
 * contributes to the final combined probability. Must sum to 1.
 *
 * Originally the spec called for three sources (odds market, Elo+xG model,
 * Opta's published probabilities). Opta's site (theanalyst.com) disallows
 * AI-agent scraping in robots.txt and Understat disallows all scraping, so
 * the model below uses two independent, ToS-compliant sources instead:
 *   - odds_api: implied probability from real bookmaker odds (The Odds API)
 *   - poisson_elo_model: our own Poisson goal model driven by ClubElo
 *     ratings + recent scoring form pulled from football-data.org results
 */
export const AGGREGATION_WEIGHTS: Record<"odds_api" | "poisson_elo_model", number> = {
  odds_api: 0.55,
  poisson_elo_model: 0.45,
};

// football-data.org competitions to track (free-tier codes).
export const TRACKED_COMPETITIONS = [
  "PL", // Premier League
  "PD", // La Liga (Primera Division)
  "BL1", // Bundesliga
  "SA", // Serie A
  "FL1", // Ligue 1
  "CL", // UEFA Champions League
] as const;

// How many days ahead to pull upcoming fixtures for.
export const FIXTURE_LOOKAHEAD_DAYS = 10;

// How many recent finished matches per team to use for the Poisson model's
// "current form" component.
export const FORM_MATCH_COUNT = 6;

// League-average goals per team per match, used to scale the Poisson model
// (rough multi-league average; refine later per-competition if desired).
export const LEAGUE_AVG_GOALS = 1.35;

export const CRON_PATH = "/api/cron/update";
