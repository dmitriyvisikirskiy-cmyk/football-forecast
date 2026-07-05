// Orchestrates one full update cycle: pull fresh data from every collector,
// upsert matches, compute each independent prediction, then combine them
// into the final aggregated_predictions row per match. This is the function
// the cron endpoint calls once a day.
//
// Timing note: Vercel Hobby caps function execution at 60s. football-data.org
// fetches are the dominant cost (one request per tracked competition,
// rate-limited to ~1 per 6.2s to respect the free-tier 10 req/min cap), so
// they're done in a single combined pass (collectAllMatches) rather than
// separate fixtures/results passes — see collectors/footballData.ts.

import { collectAllMatches, splitFixturesAndResults } from "@/collectors/footballData";
import { collectEloRatings } from "@/collectors/clubElo";
import { collectOdds, impliedProbabilitiesFromOdds } from "@/collectors/oddsApi";
import { computeMatchProbabilities, type TeamForm } from "./poissonModel";
import { findBestEloMatch } from "@/lib/teamMatch";
import { AGGREGATION_WEIGHTS, FORM_MATCH_COUNT } from "@/lib/config";
import {
  upsertMatch,
  saveRawPrediction,
  saveAggregatedPrediction,
  getRecentResultsForTeam,
  getRawPredictionsForMatch,
} from "@/lib/db";
import type { RawPrediction } from "@/lib/types";

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

  // 1. Fixtures + recent results (one combined football-data.org pass) and
  // Elo ratings, fetched concurrently.
  const [allMatches, eloRatings] = await Promise.all([
    collectAllMatches().catch((e) => {
      errors.push(`collectAllMatches: ${e.message}`);
      return [];
    }),
    collectEloRatings().catch((e) => {
      errors.push(`collectEloRatings: ${e.message}`);
      return [];
    }),
  ]);
  summary.eloRatingsFetched = eloRatings.length;

  const { upcoming: fixtures, recentFinished: recentResults } = splitFixturesAndResults(allMatches);

  const eloTeamNames = eloRatings.map((r) => r.team);
  const eloByTeam = new Map(eloRatings.map((r) => [r.team, r.elo]));

  // Upsert recent (finished) results first so the Poisson model's "form"
  // lookups have fresh data to read from the DB.
  const matchIdByFixtureKey = new Map<string, number>();
  for (const m of recentResults) {
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
  }

  // Upsert upcoming fixtures, attaching best-effort Elo team ids.
  const upcomingMatchIds: { id: number; homeTeam: string; awayTeam: string }[] = [];
  for (const m of fixtures) {
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
      upcomingMatchIds.push({ id, homeTeam: m.homeTeam, awayTeam: m.awayTeam });
      matchIdByFixtureKey.set(fixtureKey(m.homeTeam, m.awayTeam, m.kickoffUtc), id);
    } catch (e: any) {
      errors.push(`upsert fixture ${m.homeTeam} vs ${m.awayTeam}: ${e.message}`);
    }
  }

  // 2. Odds -> implied probability, one raw_predictions row per matched fixture.
  const odds = await collectOdds().catch((e) => {
    errors.push(`collectOdds: ${e.message}`);
    return [];
  });

  for (const o of odds) {
    const matchId = findMatchIdForOdds(matchIdByFixtureKey, o.homeTeam, o.awayTeam, o.commenceTimeUtc);
    if (!matchId) continue;
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
  }

  // 3. Poisson-Elo model for every upcoming fixture.
  for (const match of upcomingMatchIds) {
    try {
      const homeElo = resolveElo(match.homeTeam, eloTeamNames, eloByTeam);
      const awayElo = resolveElo(match.awayTeam, eloTeamNames, eloByTeam);
      const homeForm = await computeTeamForm(match.homeTeam);
      const awayForm = await computeTeamForm(match.awayTeam);

      const result = computeMatchProbabilities({
        homeElo,
        awayElo,
        homeForm,
        awayForm,
      });

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
  }

  // 4. Combine raw predictions per match into the final weighted aggregate.
  for (const match of upcomingMatchIds) {
    try {
      await combineAndSave(match.id);
      summary.matchesAggregated++;
    } catch (e: any) {
      errors.push(`aggregate match ${match.id}: ${e.message}`);
    }
  }

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
