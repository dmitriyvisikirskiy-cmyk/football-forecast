// football-data.org and ClubElo name teams differently
// (e.g. "Manchester United FC" vs "Man United"). This module normalizes both
// sides and does best-effort fuzzy matching so we can join Elo ratings onto
// football-data.org fixtures without a hand-maintained mapping table for
// every club in every league.
//
// This is a known weak point — see README "Next steps" for how to improve it
// (e.g. a persisted alias table, or matching via country + squad overlap).

const SUFFIXES = [
  "fc",
  "cf",
  "afc",
  "sc",
  "ac",
  "cd",
  "ud",
  "rcd",
  "ssc",
  "as",
  "ss",
  "calcio",
  "club",
  "de futbol",
  "futbol club",
  "football club",
  "1899",
  "1900",
  "1904",
  "1909",
  "1913",
];

export function normalizeTeamName(name: string): string {
  let n = name.toLowerCase();
  n = n.normalize("NFD").replace(/[̀-ͯ]/g, ""); // strip accents
  n = n.replace(/[.'-]/g, " ");
  for (const suf of SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suf}\\b`, "g"), " ");
  }
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Finds the best matching Elo team name for a given football-data.org team
 * name, using normalized-string containment/equality. Returns null if
 * nothing looks close enough.
 */
export function findBestEloMatch(
  fdTeamName: string,
  eloTeamNames: string[]
): string | null {
  const target = normalizeTeamName(fdTeamName);
  if (!target) return null;

  let best: { name: string; score: number } | null = null;

  for (const eloName of eloTeamNames) {
    const candidate = normalizeTeamName(eloName);
    if (!candidate) continue;

    let score = 0;
    if (candidate === target) {
      score = 100;
    } else if (candidate.includes(target) || target.includes(candidate)) {
      score = 80 - Math.abs(candidate.length - target.length);
    } else {
      score = tokenOverlapScore(target, candidate);
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { name: eloName, score };
    }
  }

  // Require a reasonably confident match to avoid silently attaching the
  // wrong club's Elo rating.
  return best && best.score >= 40 ? best.name : null;
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter((t) => t.length > 2));
  const bTokens = new Set(b.split(" ").filter((t) => t.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) overlap++;
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return Math.round((overlap / union) * 60);
}
