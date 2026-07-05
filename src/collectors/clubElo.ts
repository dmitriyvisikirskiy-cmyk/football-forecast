// Collector: ClubElo.com
// Public API, no key, no documented rate limit — but we still fetch it at
// most once per cron run (daily) to be a good citizen.
// Docs: http://clubelo.com/API

import type { EloRating } from "@/lib/types";

const BASE_URL = "http://api.clubelo.com";

/**
 * ClubElo publishes one CSV per day: http://api.clubelo.com/YYYY-MM-DD
 * containing the Elo rating of every club as of that date. We fetch today's
 * snapshot once per cron run.
 */
export async function collectEloRatings(date = new Date()): Promise<EloRating[]> {
  const dateStr = date.toISOString().slice(0, 10);
  const res = await fetch(`${BASE_URL}/${dateStr}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`ClubElo fetch failed: ${res.status}`);
  }
  const csv = await res.text();
  return parseEloCsv(csv);
}

function parseEloCsv(csv: string): EloRating[] {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const clubIdx = header.indexOf("Club");
  const eloIdx = header.indexOf("Elo");
  const rankIdx = header.indexOf("Rank");

  const ratings: EloRating[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < header.length) continue;
    const elo = Number(cols[eloIdx]);
    if (Number.isNaN(elo)) continue;
    const rankRaw = cols[rankIdx];
    ratings.push({
      team: cols[clubIdx],
      elo,
      rank: rankRaw && !Number.isNaN(Number(rankRaw)) ? Number(rankRaw) : null,
    });
  }
  return ratings;
}
