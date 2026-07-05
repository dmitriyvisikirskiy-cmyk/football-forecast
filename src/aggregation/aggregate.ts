// Orchestrates one full update cycle: pull fresh data from every collector,
// upsert matches, compute each independent prediction, then combine them
// into the final aggregated_predictions row per match. This is the function
// the cron endpoint calls once a day.
//
// Timing note: Vercel Hobby caps function execution at 60s. Two things
// mattered to fit inside that budget:
//  1. football-data.org fetches: one combined fixtures+results pass per
//     tracked competition (collectAllMatches), rate-limited to ~1 req/6.2s
//     to respect the free-tier 10 req/min cap — six competitions still costs
//     ~31-37s, the single biggest chunk of the budget.
//  2. Database work: with 6 competitions over a ~24-day window there can
//     easily be 100+ matches per run. Upserting/reading them one at a time
//     was too slow, so DB-bound loops below run with bounded concurrency
//     (mapWithConcurrency) instead of a plain sequential for-loop.

import { collectAllMatches, splitFixturesAndResults, type FdMatch } from "@/collectors/footballData";
import { collectEloRatings } from "@/collectors/clubElo";
import { collectOdds, impliedProbabilitiesFromOdds } from "@/collectors/oddsApi";
import { computeMatchProbabilities, type TeamForm } from "./poissonModel";
import { findBestEloMatch } from "@/lib/teamMatch";
import { AGGREGATION_WEIGHTS, FORM_MATCH_COUNT } from "@/lib/config";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  upsertMatch,
  saveRawPrediction,
  saveAggregatedPrediction,
  getRecentResultsForTeam,
  getRawPredictionsForMatch,
} from "@/lib/db";
import type { RawPrediction } from "@/lib/types";

const DB_CONCURRENCY = 12;

function stageTimer() {
  const start = Date.now();
  let last = start;
  return (label: string) => {
    const now = Date.now();
    console.log(`[cron timing] ${label}: +${now - last}ms (total ${now - start}ms)`);
    last = now;
  };
}

export interface UpdateSummary {
  fixturesUpserted: number;
  recentResultsUpserted: number;
  eloRatingsFetched: number;
  oddsMatched: number;
  poissonComputed: number;
  matchesAggregated: number;
  errors: string[];
}

export async function runFullUpdate(): Promise<UpdateSummary> {
  const tick = stageTimer();
  const errors: string[] = [];
  const summary: UpdateSummary = {
    fixturesUpserted: 0,
    recentResultsUpserted: 0,
    eloRatingsFetched: 0,
    oddsMatched: 0,
    poissonComputed: 0,
    matchesAggregated: 0,
    errors,
  };

  // 1. Fixtures + recent results (one combined football-data.org pass),
  // Elo ratings, and odds — all fetched concurrently (odds/Elo don't depend
  // on football-data.org's rate-limited pass).
  const [allMatches, eloRatings, odds] = await Promise.all([
    collectAllMatches().catch((e) => {
      errors.push(`collectAllMatches: ${e.message}`);
      return [] as FdMatch[];
    }),
    collectEloRatings().catch((e) => {
      errors.push(`collectEloRatings: ${e.message}`);
      return [];
    }),
    collectOdds().catch((e) => {
      errors.push(`collectOdds: ${e.message}`);
      return [];
    }),
  ]);
  summary.eloRatingsFetched = eloRatings.length;
  tick(`step1 collectAllMatches(${allMatches.length}) + elo(${eloRatings.length}) + odds(${odds.length})`);

  const { upcoming: fixtures, recentFinished: recentResults } = splitFixturesAndResults(allMatches);

  const eloTeamNames = eloRatings.map((r) => r.team);
  const eloByTeam = new Map(eloRatings.map((r) => [r.team, r.elo]));

  // Upsert recent (finished) results first so the Poisson model's "form"
  // lookups have fresh data to read from the DB.
  await mapWithConcurrency(recentResults, DB_CONCURRENCY, async (m) => {
    try {
      await upsertMatch({
        fdMatchId: m.fdMatchId,
        competitionCode: m.competitionCode,
        competitionName: m.competitionName,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffUtc: m.kickoffUtc,
        status: "FINISHED",
        homeScore: m.homeScore,
        awayScore: m.awayScore,
      });
      summary.recentResultsUpserted++;
    } catch (e: any) {
      errors.push(`upsert recent result ${m.homeTeam} vs ${m.awayTeam}: ${e.message}`);
    }
  });
  tick(`upsert recentResults(${recentResults.length})`);

  // Upsert upcoming fixtures, attaching best-effort Elo team ids.
  const matchIdByFixtureKey = new Map<string, number>();
  const upcomingResults = await mapWithConcurrency(fixtures, DB_CONCURRENCY, async (m) => {
    try {
      const homeEloId = findBestEloMatch(m.homeTeam, eloTeamNames);
      const awayEloId = findBestEloMatch(m.awayTeam, eloTeamNames);
      const id = await upsertMatch({
        fdMatchId: m.fdMatchId,
        competitionCode: m.competitionCode,
        competitionName: m.competitionName,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeTeamEloId: homeEloId,
        awayTeamEloId: awayEloId,
        kickoffUtc: m.kickoffUtc,
        status: "SCHEDULED",
      });
      summary.fixturesUpserted++;
      matchIdByFixtureKey.set(fixtureKey(m.homeTeam, m.awayTeam, m.kickoffUtc), id);
      return { id, homeTeam: m.homeTeam, awayTeam: m.awayTeam };
    } catch (e: any) {
      errors.push(`upsert fixture ${m.homeTeam} vs ${m.awayTeam}: ${e.message}`);
      return null;
    }
  });
  const upcomingMatchIds = upcomingResults.filter(
    (r): r is { id: number; homeTeam: string; awayTeam: string } => r !== null
  );
  tick(`upsert fixtures(${fixtures.length})`);

  // 2. Odds -> implied probability, one raw_predictions row per matched fixture.
  await mapWithConcurrency(odds, DB_CONCURRENCY, async (o) => {
    const matchId = findMatchIdForOdds(matchIdByFixtureKey, o.homeTeam, o.awayTeam, o.commenceTimeUtc);
    if (!matchId) return;
    const probs = impliedProbabilitiesFromOdds(o.avgHomeOdds, o.avgDrawOdds, o.avgAwayOdds);
    const pred: RawPrediction = {
      match: {
        homeTeam: o.homeTeam,
        awayTeam: o.awayTeam,
        kickoffUtc: o.commenceTimeUtc,
        competitionCode: o.competitionCode,
        competitionName: o.competitionCode,
      },
      source: "odds_api",
      homeProb: probs.homeProb,
      drawProb: probs.drawProb,
      awayProb: probs.awayProb,
      timestamp: new Date().toISOString(),
      meta: {
        avgHomeOdds: o.avgHomeOdds,
        avgDrawOdds: o.avgDrawOdds,
        avgAwayOdds: o.avgAwayOdds,
        bookmakerCount: o.bookmakerCount,
      },
    };
    try {
      await saveRawPrediction(matchId, pred);
      summary.oddsMatched++;
    } catch (e: any) {
      errors.push(`saveRawPrediction odds ${o.homeTeam} vs ${o.awayTeam}: ${e.message}`);
    }
  });
  tick(`match+save odds(${odds.length})`);

  // 3. Poisson-Elo model. Pre-fetch each unique team's recent form once
  // (concurrently) instead of once per match per side, since the same team
  // can appear in several upcoming fixtures across the lookahead window.
  const uniqueTeams = Array.from(
    new Set(upcomingMatchIds.flatMap((m) => [m.homeTeam, m.awayTeam]))
  );
  const formEntries = await mapWithConcurrency(uniqueTeams, DB_CONCURRENCY, async (team) => {
    try {
      return [team, await computeTeamForm(team)] as const;
    } catch {
      return [team, null] as const;
    }
  });
  const formByTeam = new Map(formEntries);
  tick(`form lookups(${uniqueTeams.length} teams)`);

  await mapWithConcurrency(upcomingMatchIds, DB_CONCURRENCY, async (match) => {
    try {
      const homeElo = resolveElo(match.homeTeam, eloTeamNames, eloByTeam);
      const awayElo = resolveElo(match.awayTeam, eloTeamNames, eloByTeam);
      const homeForm = formByTeam.get(match.homeTeam) ?? null;
      const awayForm = formByTeam.get(match.awayTeam) ?? null;

      const result = computeMatchProbabilities({ homeElo, awayElo, homeForm, awayForm });

      const pred: RawPrediction = {
        match: {
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          kickoffUtc: new Date().toISOString(),
          competitionCode: "",
          competitionName: "",
        },
        source: "poisson_elo_model",
        homeProb: result.homeProb,
        drawProb: result.drawProb,
        awayProb: result.awayProb,
        timestamp: new Date().toISOString(),
        meta: {
          homeElo,
          awayElo,
          lambdaHome: result.lambdaHome,
          lambdaAway: result.lambdaAway,
          homeForm,
          awayForm,
        },
      };
      await saveRawPrediction(match.id, pred);
      summary.poissonComputed++;
    } catch (e: any) {
      errors.push(`poisson model ${match.homeTeam} vs ${match.awayTeam}: ${e.message}`);
    }
  });

  tick(`poisson compute+save(${upcomingMatchIds.length})`);

  // 4. Combine raw predictions per match into the final weighted aggregate.
  await mapWithConcurrency(upcomingMatchIds, DB_CONCURRENCY, async (match) => {
    try {
      await combineAndSave(match.id);
      summary.matchesAggregated++;
    } catch (e: any) {
      errors.push(`aggregate match ${match.id}: ${e.message}`);
    }
  });

  tick("combine+save aggregated");
  return summary;
}

async function combineAndSave(matchId: number) {
  const raw = await getRawPredictionsForMatch(matchId);
  if (raw.length === 0) return;

  let weightSum = 0;
  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;
  const weightsUsed: Record<string, number> = {};

  for (const r of raw) {
    const weight = AGGREGATION_WEIGHTS[r.source as keyof typeof AGGREGATION_WEIGHTS] ?? 0;
    if (weight <= 0) continue;
    homeProb += r.homeProb * weight;
    drawProb += r.drawProb * weight;
    awayProb += r.awayProb * weight;
    weightSum += weight;
    weightsUsed[r.source] = weight;
  }

  if (weightSum === 0) return;

  homeProb /= weightSum;
  drawProb /= weightSum;
  awayProb /= weightSum;

  await saveAggregatedPrediction({
    matchId,
    homeProb,
    drawProb,
    awayProb,
    weightsUsed,
  });
}

async function computeTeamForm(teamName: string): Promise<TeamForm | null> {
  const recent = await getRecentResultsForTeam(teamName, FORM_MATCH_COUNT);
  if (recent.length === 0) return null;

  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const m of recent) {
    if (m.home_team === teamName) {
      goalsFor += m.home_score;
      goalsAgainst += m.away_score;
    } else {
      goalsFor += m.away_score;
      goalsAgainst += m.home_score;
    }
  }

  return {
    avgGoalsFor: goalsFor / recent.length,
    avgGoalsAgainst: goalsAgainst / recent.length,
    matchesUsed: recent.length,
  };
}

function resolveElo(
  teamName: string,
  eloTeamNames: string[],
  eloByTeam: Map<string, number>
): number | null {
  const match = findBestEloMatch(teamName, eloTeamNames);
  if (!match) return null;
  return eloByTeam.get(match) ?? null;
}

function fixtureKey(home: string, away: string, kickoffUtc: string): string {
  // Bucket by day so small kickoff-time discrepancies between football-data.org
  // and The Odds API don't break the join.
  const day = kickoffUtc.slice(0, 10);
  return `${normalizeKey(home)}|${normalizeKey(away)}|${day}`;
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findMatchIdForOdds(
  map: Map<string, number>,
  home: string,
  away: string,
  kickoffUtc: string
): number | null {
  return map.get(fixtureKey(home, away, kickoffUtc)) ?? null;
}
