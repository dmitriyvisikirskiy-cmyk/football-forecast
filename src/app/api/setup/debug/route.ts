import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

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

  const [matchCount, scheduledCount, sampleMatches, rawCount, aggCount] = await Promise.all([
    sql`select count(*)::int as n from matches`,
    sql`select count(*)::int as n from matches where status = 'SCHEDULED'`,
    sql`select id, competition_code, home_team, away_team, status, kickoff_utc from matches order by id desc limit 15`,
    sql`select count(*)::int as n from raw_predictions`,
    sql`select count(*)::int as n from aggregated_predictions`,
  ]);

  return NextResponse.json({
    totalMatches: matchCount.rows[0].n,
    scheduledMatches: scheduledCount.rows[0].n,
    rawPredictions: rawCount.rows[0].n,
    aggregatedPredictions: aggCount.rows[0].n,
    sampleMatches: sampleMatches.rows,
    now: new Date().toISOString(),
  });
}
