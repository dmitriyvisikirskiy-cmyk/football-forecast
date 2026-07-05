// Collector: football-data.org
// Free tier: 10 requests/minute, 12 competitions. Docs: https://www.football-data.org/documentation/quickstart
// Used as the source of truth for fixtures, results and competition metadata.
//
// Fetches upcoming fixtures AND recent finished results in a single request
// per competition (one wide date range, no status filter) instead of two
// separate passes. This matters because Vercel Hobby caps function
// execution at 60s: two passes x 6 competitions x ~6.5s rate-limit spacing
// would alone take ~78s and blow the budget before any DB work happens.
// One pass x 6 competitions fits comfortably.

import { FIXTURE_LOOKAHEAD_DAYS, TRACKED_COMPETITIONS } from "@/lib/config";

const BASE_URL = "https://api.football-data.org/v4";
const RECENT_RESULTS_DAYS_BACK = 30;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls both recently finished results (last 30 days) and upcoming fixtures
 * (next FIXTURE_LOOKAHEAD_DAYS days) for every tracked competition, one
 * request per competition. Rate-limited to stay under the free-tier
 * 10 req/min cap (no sleep after the last competition, since nothing
 * follows it).
 */
export async function collectAllMatches(): Promise<FdMatch[]> {
  const dateFrom = new Date(Date.now() - RECENT_RESULTS_DAYS_BACK * 86400_000)
    .toISOString()
    .slice(0, 10);
  const dateTo = new Date(Date.now() + FIXTURE_LOOKAHEAD_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const results: FdMatch[] = [];
  const competitions = [...TRACKED_COMPETITIONS];

  for (let i = 0; i < competitions.length; i++) {
    const code = competitions[i];
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
    if (i < competitions.length - 1) {
      await sleep(6200); // ~9.7 req/min, safely under the 10 req/min cap
    }
  }

  return results;
}

export function splitFixturesAndResults(matches: FdMatch[]): {
  upcoming: FdMatch[];
  recentFinished: FdMatch[];
} {
  const upcoming: FdMatch[] = [];
  const recentFinished: FdMatch[] = [];
  for (const m of matches) {
    if (m.status === "FINISHED") recentFinished.push(m);
    else if (m.status === "SCHEDULED" || m.status === "TIMED") upcoming.push(m);
  }
  return { upcoming, recentFinished };
}
