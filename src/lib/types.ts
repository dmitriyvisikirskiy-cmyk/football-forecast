// Shared types across collectors, aggregation and the frontend.

export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED";

export interface Match {
  id: number;
  fdMatchId: number | null;
  competitionCode: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamEloId: string | null;
  awayTeamEloId: string | null;
  kickoffUtc: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
}

// Source identifiers used consistently in raw_predictions.source
export type PredictionSource = "odds_api" | "poisson_elo_model";

/**
 * Unified shape every collector/model must return, one entry per match,
 * per the architecture spec: { match, source, homeProb, drawProb, awayProb, timestamp }.
 */
export interface RawPrediction {
  match: {
    // Enough to identify/upsert the match row; either fdMatchId or the
    // team+kickoff combination is used depending on the source.
    fdMatchId?: number;
    homeTeam: string;
    awayTeam: string;
    kickoffUtc: string;
    competitionCode: string;
    competitionName: string;
  };
  source: PredictionSource;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface AggregatedPrediction {
  matchId: number;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  weightsUsed: Record<PredictionSource, number>;
  computedAt: string;
}

export interface EloRating {
  team: string; // ClubElo's own team name/slug
  elo: number;
  rank: number | null;
}
