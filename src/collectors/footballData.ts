// Collector: football-data.org
// Free tier: 10 requests/minute, 12 competitions. Docs: https://www.football-data.org/documentation/quickstart
// Used as the source of truth for fixtures, results and competition metadata.

import { FIXTURE_LOOKAHEAD_DAYS, TRACKED_COMPETITIONS } from "@/lib/config";

const BASE_URL = "https://api.football-data.org/v4";

export interface FdMatch {
  fdMatchId: number;
  competitionCode: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "SUSPENDED" | "CANCELLED";
  homeScore: number | null;
  awayScore: number | null;
}

function apiKey(): string {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error("FOOTBALL_DATA_API_KEY is not set");
  return key;
}

async function fdFetch(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": apiKey() },
    // football-data.org data changes at most a few times a day; let the
    // platform cache responses for a while between cron runs.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

/** Simple sequential rate limiter: football-data.org free tier allows 10 req/min. */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapStatus(fdStatus: string): "SCHEDULED" | "FINISHED" | "POSTPONED" | "LIVE" {
  if (fdStatus === "FINISHED") return "FINISHED";
  if (fdStatus === "POSTPONED" || fdStatus === "CANCELLED" || fdStatus === "SUSPENDED") return "POSTPONED";
  if (fdStatus === "IN_PLAY" || fdStatus === "PAUSED") return "LIVE";
  return "SCHEDULED";
}

/**
 * Pulls upcoming fixtures (next FIXTURE_LOOKAHEAD_DAYS days) for every
 * tracked competition. One request per competition, spaced out to respect
 * the 10 req/min free-tier limit.
 */
export async function collectUpcomingFixtures(): Promise<FdMatch[]> {
  const dateFrom = new Date().toISOString().slice(0, 10);
  const dateTo = new Date(Date.now() + FIXTURE_LOOKAHEAD_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const results: FdMatch[] = [];

  for (const code of TRACKED_COMPETITIONS) {
    try {
      const data = await fdFetch(
        `/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`
      );
      for (const m of data.matches ?? []) {
        results.push({
          fdMatchId: m.id,
          competitionCode: code,
          competitionName: data.competition?.name ?? code,
          homeTeam: m.homeTeam?.name ?? "Unknown",
          awayTeam: m.awayTeam?.name ?? "Unknown",
          kickoffUtc: m.utcDate,
          status: m.status,
          homeScore: m.score?.fullTime?.home ?? null,
          awayScore: m.score?.fullTime?.away ?? null,
        });
      }
    } catch (err) {
      // One competition failing (e.g. temporarily rate-limited) shouldn't
      // take down the whole cron run.
      console.error(`[footballData] failed for ${code}:`, err);
    }
    await sleep(6500); // ~9 req/min, safely under the 10 req/min cap
  }

  return results;
}

/**
 * Pulls recently finished matches for the tracked competitions, used by the
 * Poisson model to compute each team's current scoring form.
 */
export async function collectRecentResults(daysBack = 30): Promise<FdMatch[]> {
  const dateFrom = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  const results: FdMatch[] = [];

  for (const code of TRACKED_COMPETITIONS) {
    try {
      const data = await fdFetch(
        `/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=FINISHED`
      );
      for (const m of data.matches ?? []) {
        results.push({
          fdMatchId: m.id,
          competitionCode: code,
          competitionName: data.competition?.name ?? code,
          homeTeam: m.homeTeam?.name ?? "Unknown",
          awayTeam: m.awayTeam?.name ?? "Unknown",
          kickoffUtc: m.utcDate,
          status: m.status,
          homeScore: m.score?.fullTime?.home ?? null,
          awayScore: m.score?.fullTime?.away ?? null,
        });
      }
    } catch (err) {
      console.error(`[footballData] recent results failed for ${code}:`, err);
    }
    await sleep(6500);
  }

  return results;
}
