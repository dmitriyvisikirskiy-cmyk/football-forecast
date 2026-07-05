import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getUpcomingMatches } from "@/lib/db";

// Temporary debug endpoint: dumps counts + a few sample rows from each
// table so we can see what the cron run actually persisted. Protected by
// CRON_SECRET like the other setup/cron routes. Safe to delete once the
// pipeline is confirmed working end-to-end.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const testLimit = 100;
  const [matchCount, scheduledCount, sampleMatches, rawCount, aggCount, upcomingQuery, dbNow, exactQuery] = await Promise.all([
    sql`select count(*)::int as n from matches`,
    sql`select count(*)::int as n from matches where status = 'SCHEDULED'`,
    sql`select id, competition_code, home_team, away_team, status, kickoff_utc from matches order by id desc limit 15`,
    sql`select count(*)::int as n from raw_predictions`,
    sql`select count(*)::int as n from aggregated_predictions`,
    sql`
      select m.id, m.home_team, m.away_team, m.status, m.kickoff_utc
      from matches m
      where m.status = 'SCHEDULED' and m.kickoff_utc > now() - interval '2 hours'
      order by m.kickoff_utc asc
      limit 20
    `,
    sql`select now() as n`,
    sql`
      select
        m.id, m.fd_match_id, m.competition_code, m.competition_name,
        m.home_team, m.away_team, m.home_team_elo_id, m.away_team_elo_id,
        m.kickoff_utc, m.status, m.home_score, m.away_score,
        a.home_prob as agg_home_prob, a.draw_prob as agg_draw_prob, a.away_prob as agg_away_prob
      from matches m
      left join aggregated_predictions a on a.match_id = m.id
      where m.status = 'SCHEDULED' and m.kickoff_utc > now() - interval '2 hours'
      order by m.kickoff_utc asc
      limit ${testLimit}
    `,
  ]);

  return NextResponse.json({
    totalMatches: matchCount.rows[0].n,
    scheduledMatches: scheduledCount.rows[0].n,
    rawPredictions: rawCount.rows[0].n,
    aggregatedPredictions: aggCount.rows[0].n,
    sampleMatches: sampleMatches.rows,
    upcomingQueryResult: upcomingQuery.rows,
    exactQueryResultCount: exactQuery.rows.length,
    exactQueryResult: exactQuery.rows,
    dbNow: dbNow.rows[0].n,
    now: new Date().toISOString(),
    realFunctionResult: await getUpcomingMatches(100),
  });
}
