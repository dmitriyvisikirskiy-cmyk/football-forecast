import { notFound } from "next/navigation";
import { getMatchById, getRawPredictionsForMatch } from "@/lib/db";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  odds_api: "Bookmaker odds (The Odds API)",
  poisson_elo_model: "Poisson model (ClubElo + recent form)",
};

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function MatchDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();

  const match = await getMatchById(id);
  if (!match) notFound();

  const rawPredictions = await getRawPredictionsForMatch(id);

  return (
    <main className="container">
      <a className="back-link" href="/">
        &larr; Back to all matches
      </a>

      <div className="detail-header">
        <h1>
          {match.homeTeam} vs {match.awayTeam}
        </h1>
        <div className="kickoff">
          {match.competitionName} &middot; {formatKickoff(match.kickoffUtc)}
        </div>
      </div>

      {match.aggHomeProb !== null && (
        <div className="source-card final-card">
          <h3>Final aggregated prediction</h3>
          <div className="prob-bar">
            <div className="home" style={{ width: `${match.aggHomeProb * 100}%` }} />
            <div className="draw" style={{ width: `${(match.aggDrawProb ?? 0) * 100}%` }} />
            <div className="away" style={{ width: `${(match.aggAwayProb ?? 0) * 100}%` }} />
          </div>
          <div className="prob-legend">
            <span className="home-val">Home {pct(match.aggHomeProb)}</span>
            <span className="draw-val">Draw {pct(match.aggDrawProb ?? 0)}</span>
            <span className="away-val">Away {pct(match.aggAwayProb ?? 0)}</span>
          </div>
          {match.aggWeights && (
            <div className="source-meta">
              Weights used: {Object.entries(match.aggWeights as Record<string, number>)
                .map(([k, v]) => `${SOURCE_LABELS[k] ?? k} ${(v * 100).toFixed(0)}%`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}

      <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8b98a5", margin: "24px 0 10px" }}>
        What each source says
      </h2>

      {rawPredictions.length === 0 && (
        <div className="no-prediction">No source data yet — waiting for the next cron run.</div>
      )}

      {rawPredictions.map((p) => (
        <div className="source-card" key={p.source}>
          <h3>{SOURCE_LABELS[p.source] ?? p.source}</h3>
          <div className="prob-bar">
            <div className="home" style={{ width: `${p.homeProb * 100}%` }} />
            <div className="draw" style={{ width: `${p.drawProb * 100}%` }} />
            <div className="away" style={{ width: `${p.awayProb * 100}%` }} />
          </div>
          <div className="prob-legend">
            <span className="home-val">Home {pct(p.homeProb)}</span>
            <span className="draw-val">Draw {pct(p.drawProb)}</span>
            <span className="away-val">Away {pct(p.awayProb)}</span>
          </div>
          {p.meta && (
            <div className="source-meta">
              {p.source === "odds_api" && (
                <>
                  Avg odds — Home {(p.meta as any).avgHomeOdds?.toFixed(2)} · Draw{" "}
                  {(p.meta as any).avgDrawOdds?.toFixed(2) ?? "—"} · Away{" "}
                  {(p.meta as any).avgAwayOdds?.toFixed(2)} ({(p.meta as any).bookmakerCount} bookmakers)
                </>
              )}
              {p.source === "poisson_elo_model" && (
                <>
                  Elo — Home {(p.meta as any).homeElo ?? "n/a"} · Away {(p.meta as any).awayElo ?? "n/a"}
                  {" · "}Expected goals — {(p.meta as any).lambdaHome?.toFixed(2)} :{" "}
                  {(p.meta as any).lambdaAway?.toFixed(2)}
                </>
              )}
            </div>
          )}
          <div className="source-meta">Fetched: {new Date(p.fetchedAt).toLocaleString()}</div>
        </div>
      ))}
    </main>
  );
}
