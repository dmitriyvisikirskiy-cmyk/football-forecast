import { NextResponse } from "next/server";
import { getUpcomingMatches } from "@/lib/db";

// Simple JSON API for the upcoming matches + aggregated predictions,
// useful for debugging or for anyone who wants to consume the data
// programmatically instead of via the frontend.
// Forced dynamic: this hits the database on every request and must never
// be statically generated at build time (when no DB connection exists yet).
export const dynamic = "force-dynamic";

export async function GET() {
  const matches = await getUpcomingMatches(100);
  return NextResponse.json({ matches });
}
