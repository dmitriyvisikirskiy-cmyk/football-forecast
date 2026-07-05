// Own statistical baseline: a Poisson goal model driven by ClubElo ratings
// and each team's recent scoring form (from football-data.org results).
//
// Approach:
//   1. Elo difference -> expected goal difference, using the standard
//      logistic relationship between Elo and win probability, converted to
//      an expected-goals tilt around the league-average goals/match.
//   2. Recent scoring form (goals for/against in each team's last N matches)
//      adjusts the baseline up/down for attack and defense strength.
//   3. Combine into home/away expected goals (lambda_home, lambda_away).
//   4. Score every plausible scoreline (0-0 up to 9-9) with the Poisson
//      probability mass function, and sum into home/draw/away win
//      probabilities.

import { LEAGUE_AVG_GOALS } from "@/lib/config";

export interface TeamForm {
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  matchesUsed: number;
}

export interface PoissonInput {
  homeElo: number | null;
  awayElo: number | null;
  homeForm: TeamForm | null;
  awayForm: TeamForm | null;
}

export interface PoissonResult {
  homeProb: number;
  drawProb: number;
  awayProb: number;
  lambdaHome: number;
  lambdaAway: number;
}

// Home advantage bump applied to the home side's expected goals.
const HOME_ADVANTAGE_GOALS = 0.25;

// Elo points that correspond to roughly one extra expected goal of quality
// difference. 400 Elo ~= 10x win odds in the standard Elo model; we use a
// gentler, empirically reasonable scaling for goal expectancy.
const ELO_POINTS_PER_GOAL = 400;

const MAX_GOALS = 9;

export function computeMatchProbabilities(input: PoissonInput): PoissonResult {
  const { lambdaHome, lambdaAway } = computeExpectedGoals(input);
  const { homeProb, drawProb, awayProb } = poissonMatchOutcomes(lambdaHome, lambdaAway);
  return { homeProb, drawProb, awayProb, lambdaHome, lambdaAway };
}

function computeExpectedGoals(input: PoissonInput): { lambdaHome: number; lambdaAway: number } {
  let lambdaHome = LEAGUE_AVG_GOALS + HOME_ADVANTAGE_GOALS / 2;
  let lambdaAway = LEAGUE_AVG_GOALS - HOME_ADVANTAGE_GOALS / 2;

  // Elo-based tilt: shift expected goals toward the stronger side.
  if (input.homeElo !== null && input.awayElo !== null) {
    const eloDiff = input.homeElo - input.awayElo;
    const goalTilt = eloDiff / ELO_POINTS_PER_GOAL;
    lambdaHome += goalTilt / 2;
    lambdaAway -= goalTilt / 2;
  }

  // Recent-form adjustment: blend in each team's own attack/defense rates
  // relative to the league average, dampened so a handful of matches can't
  // swing the estimate wildly.
  const FORM_WEIGHT = 0.35;
  if (input.homeForm && input.homeForm.matchesUsed > 0) {
    const attackFactor = input.homeForm.avgGoalsFor / LEAGUE_AVG_GOALS;
    const concedeFactor = input.homeForm.avgGoalsAgainst / LEAGUE_AVG_GOALS;
    lambdaHome = blend(lambdaHome, lambdaHome * attackFactor, FORM_WEIGHT);
    lambdaAway = blend(lambdaAway, lambdaAway * concedeFactor, FORM_WEIGHT);
  }
  if (input.awayForm && input.awayForm.matchesUsed > 0) {
    const attackFactor = input.awayForm.avgGoalsFor / LEAGUE_AVG_GOALS;
    const concedeFactor = input.awayForm.avgGoalsAgainst / LEAGUE_AVG_GOALS;
    lambdaAway = blend(lambdaAway, lambdaAway * attackFactor, FORM_WEIGHT);
    lambdaHome = blend(lambdaHome, lambdaHome * concedeFactor, FORM_WEIGHT);
  }

  // Keep expected goals in a sane range.
  lambdaHome = clamp(lambdaHome, 0.2, 4.5);
  lambdaAway = clamp(lambdaAway, 0.2, 4.5);

  return { lambdaHome, lambdaAway };
}

function poissonMatchOutcomes(lambdaHome: number, lambdaAway: number) {
  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      if (h > a) homeProb += p;
      else if (h === a) drawProb += p;
      else awayProb += p;
    }
  }

  // Residual probability mass beyond MAX_GOALS is negligible for lambda <= 4.5
  // but normalize anyway so the three probabilities sum to exactly 1.
  const total = homeProb + drawProb + awayProb;
  return {
    homeProb: homeProb / total,
    drawProb: drawProb / total,
    awayProb: awayProb / total,
  };
}

function poissonPmf(k: number, lambda: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

const FACTORIAL_CACHE = [1];
function factorial(n: number): number {
  if (FACTORIAL_CACHE[n] !== undefined) return FACTORIAL_CACHE[n];
  for (let i = FACTORIAL_CACHE.length; i <= n; i++) {
    FACTORIAL_CACHE[i] = FACTORIAL_CACHE[i - 1] * i;
  }
  return FACTORIAL_CACHE[n];
}

function blend(base: number, adjusted: number, weight: number): number {
  return base * (1 - weight) + adjusted * weight;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
