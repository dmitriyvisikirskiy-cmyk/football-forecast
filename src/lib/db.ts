import { sql } from "@vercel/postgres";
import type { Match, PredictionSource, RawPrediction } from "./types";

// --- matches -----------------------------------------------------------

/**
 * Insert a match if it doesn't exist (matched by fd_match_id when available),
 * otherwise update its mutable fields (status/score/kickoff). Returns the
 * internal numeric id.
 */
export async function upsertMatch(input: {
  fdMatchId?: number;
  competitionCode: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamEloId?: string | null;
  awayTeamEloId?: string | null;
  kickoffUtc: string;
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
}): Promise<number> {
  if (input.fdMatchId) {
    const { rows } = await sql<{ id: number }>`
      insert into matches (
        fd_match_id, competition_code, competition_name,
        home_team, away_team, home_team_elo_id, away_team_elo_id,
        kickoff_utc, status, home_score, away_score, updated_at
      ) values (
        ${input.fdMatchId}, ${input.competitionCode}, ${input.competitionName},
        ${input.homeTeam}, ${input.awayTeam},
        ${input.homeTeamEloId ?? null}, ${input.awayTeamEloId ?? null},
        ${input.kickoffUtc}, ${input.status ?? "SCHEDULED"},
        ${input.homeScore ?? null}, ${input.awayScore ?? null}, now()
      )
      on conflict (fd_match_id) do update set
        status = excluded.status,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        kickoff_utc = excluded.kickoff_utc,
        home_team_elo_id = coalesce(excluded.home_team_elo_id, matches.home_team_elo_id),
        away_team_elo_id = coalesce(excluded.away_team_elo_id, matches.away_team_elo_id),
        updated_at = now()
      returning id
    `;
    return rows[0].id;
  }

  // No football-data id (shouldn't normally happen) — fall back to a plain insert.
  const { rows } = await sql<{ id: number }>`
    insert into matches (
      competition_code, competition_name, home_team, away_team,
      home_team_elo_id, away_team_elo_id, kickoff_utc, status
    ) values (
      ${input.competitionCode}, ${input.competitionName},
      ${input.homeTeam}, ${input.awayTeam},
      ${input.homeTeamEloId ?? null}, ${input.awayTeamEloId ?? null},
      ${input.kickoffUtc}, ${input.status ?? "SCHEDULED"}
    )
    returning id
  `;
  return rows[0].id;
}

export async function getUpcomingMatches(limit = 50): Promise<
  (Match & {
    aggHomeProb: number | null;
    aggDrawProb: number | null;
    aggAwayProb: number | null;
  })[]
> {
  const { rows } = await sql`
    select
      m.id, m.fd_match_id, m.competition_code, m.competition_name,
      m.home_team, m.away_team, m.home_team_elo_id, m.away_team_elo_id,
      m.kickoff_utc, m.status, m.home_score, m.away_score,
      a.home_prob as agg_home_prob, a.draw_prob as agg_draw_prob, a.away_prob as agg_away_prob
    from matches m
    left join aggregated_predictions a on a.match_id = m.id
    where m.status = 'SCHEDULED' and m.kickoff_utc > now() - interval '2 hours'
    order by m.kickoff_utc asc
    limit ${limit}
  `;
  console.log(`[getUpcomingMatches] limit=${limit} rows.length=${rows.length}`);
  return rows.map(rowToMatchWithAgg);
}

export async function getMatchById(id: number) {
  const { rows } = await sql`
    select
      m.id, m.fd_match_id, m.competition_code, m.competition_name,
      m.home_team, m.away_team, m.home_team_elo_id, m.away_team_elo_id,
      m.kickoff_utc, m.status, m.home_score, m.away_score,
      a.home_prob as agg_home_prob, a.draw_prob as agg_draw_prob, a.away_prob as agg_away_prob,
      a.weights_used as agg_weights, a.computed_at as agg_computed_at
    from matches m
    left join aggregated_predictions a on a.match_id = m.id
    where m.id = ${id}
  `;
  if (rows.length === 0) return null;
  return rowToMatchWithAgg(rows[0]);
}

export async function getRawPredictionsForMatch(matchId: number) {
  const { rows } = await sql`
    select source, home_prob, draw_prob, away_prob, meta, fetched_at
    from raw_predictions
    where match_id = ${matchId}
    order by source asc
  `;
  return rows.map((r) => ({
    source: r.source as PredictionSource,
    homeProb: Number(r.home_prob),
    drawProb: Number(r.draw_prob),
    awayProb: Number(r.away_prob),
    meta: r.meta,
    fetchedAt: r.fetched_at,
  }));
}

// --- raw_predictions -----------------------------------------------------

export async function saveRawPrediction(matchId: number, pred: RawPrediction) {
  await sql`
    insert into raw_predictions (match_id, source, home_prob, draw_prob, away_prob, meta, fetched_at)
    values (
      ${matchId}, ${pred.source}, ${pred.homeProb}, ${pred.drawProb}, ${pred.awayProb},
      ${JSON.stringify(pred.meta ?? {})}, ${pred.timestamp}
    )
    on conflict (match_id, source) do update set
      home_prob = excluded.home_prob,
      draw_prob = excluded.draw_prob,
      away_prob = excluded.away_prob,
      meta = excluded.meta,
      fetched_at = excluded.fetched_at
  `;
}

// --- aggregated_predictions ----------------------------------------------

export async function saveAggregatedPrediction(input: {
  matchId: number;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  weightsUsed: Record<string, number>;
}) {
  await sql`
    insert into aggregated_predictions (match_id, home_prob, draw_prob, away_prob, weights_used, computed_at)
    values (
      ${input.matchId}, ${input.homeProb}, ${input.drawProb}, ${input.awayProb},
      ${JSON.stringify(input.weightsUsed)}, now()
    )
    on conflict (match_id) do update set
      home_prob = excluded.home_prob,
      draw_prob = excluded.draw_prob,
      away_prob = excluded.away_prob,
      weights_used = excluded.weights_used,
      computed_at = now()
  `;
}

export async function getAllScheduledMatchIds(): Promise<number[]> {
  const { rows } = await sql<{ id: number }>`
    select id from matches where status = 'SCHEDULED' and kickoff_utc > now() - interval '2 hours'
  `;
  return rows.map((r) => r.id);
}

export async function getRecentResultsForTeam(teamName: string, limit: number) {
  const { rows } = await sql`
    select home_team, away_team, home_score, away_score, kickoff_utc
    from matches
    where status = 'FINISHED'
      and (home_team = ${teamName} or away_team = ${teamName})
      and home_score is not null and away_score is not null
    order by kickoff_utc desc
    limit ${limit}
  `;
  return rows as {
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    kickoff_utc: string;
  }[];
}

// --- helpers ---------------------------------------------------------------

function rowToMatchWithAgg(r: any) {
  return {
    id: r.id,
    fdMatchId: r.fd_match_id,
    competitionCode: r.competition_code,
    competitionName: r.competition_name,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    homeTeamEloId: r.home_team_elo_id,
    awayTeamEloId: r.away_team_elo_id,
    kickoffUtc: r.kickoff_utc,
    status: r.status,
    homeScore: r.home_score,
    awayScore: r.away_score,
    aggHomeProb: r.agg_home_prob !== null && r.agg_home_prob !== undefined ? Number(r.agg_home_prob) : null,
    aggDrawProb: r.agg_draw_prob !== null && r.agg_draw_prob !== undefined ? Number(r.agg_draw_prob) : null,
    aggAwayProb: r.agg_away_prob !== null && r.agg_away_prob !== undefined ? Number(r.agg_away_prob) : null,
    aggWeights: r.agg_weights ?? null,
    aggComputedAt: r.agg_computed_at ?? null,
  };
}
