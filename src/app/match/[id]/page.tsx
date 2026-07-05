import { notFound } from "next/navigation";
import { getMatchById, getRawPredictionsForMatch } from "@/lib/db";
import { flagForTeam } from "@/lib/countryFlags";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  odds_api: "Kursy bukmacherskie (The Odds API)",
  poisson_elo_model: "Model Poissona (ClubElo + ostatnia forma)",
};

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pl-PL", {
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

function TeamName({ name }: { name: string }) {
  const flag = flagForTeam(name);
  return (
    <>
      {flag && <span className="flag">{flag}</span>}
      {name}
    </>
  );
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
        &larr; Powrót do wszystkich meczów
      </a>

      <div className="detail-header">
        <h1>
          <TeamName name={match.homeTeam} /> vs <TeamName name={match.awayTeam} />
        </h1>
        <div className="kickoff">
          {match.competitionName} &middot; {formatKickoff(match.kickoffUtc)}
          {match.status === "FINISHED" && match.homeScore !== null && match.awayScore !== null && (
            <>
              {" "}
              &middot; <span className="score">{match.homeScore} : {match.awayScore}</span>
            </>
          )}
        </div>
      </div>

      {match.aggHomeProb !== null && (
        <div className="source-card final-card">
          <h3>Ostateczna zagregowana prognoza</h3>
          <div className="prob-bar">
            <div className="home" style={{ width: `${match.aggHomeProb * 100}%` }} />
            <div className="draw" style={{ width: `${(match.aggDrawProb ?? 0) * 100}%` }} />
            <div className="away" style={{ width: `${(match.aggAwayProb ?? 0) * 100}%` }} />
          </div>
          <div className="prob-legend">
            <span className="home-val">1 (gospodarze) {pct(match.aggHomeProb)}</span>
            <span className="draw-val">X (remis) {pct(match.aggDrawProb ?? 0)}</span>
            <span className="away-val">2 (goście) {pct(match.aggAwayProb ?? 0)}</span>
          </div>
          {match.aggWeights && (
            <div className="source-meta">
              Użyte wagi: {Object.entries(match.aggWeights as Record<string, number>)
                .map(([k, v]) => `${SOURCE_LABELS[k] ?? k} ${(v * 100).toFixed(0)}%`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}

      <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8b98a5", margin: "24px 0 10px" }}>
        Co mówi każde źródło
      </h2>

      {rawPredictions.length === 0 && (
        <div className="no-prediction">Brak jeszcze danych źródłowych — czekamy na kolejne uruchomienie crona.</div>
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
            <span className="home-val">1 (gospodarze) {pct(p.homeProb)}</span>
            <span className="draw-val">X (remis) {pct(p.drawProb)}</span>
            <span className="away-val">2 (goście) {pct(p.awayProb)}</span>
          </div>
          {p.meta && (
            <div className="source-meta">
              {p.source === "odds_api" && (
                <>
                  Śr. kursy — Gospodarze {(p.meta as any).avgHomeOdds?.toFixed(2)} · Remis{" "}
                  {(p.meta as any).avgDrawOdds?.toFixed(2) ?? "—"} · Goście{" "}
                  {(p.meta as any).avgAwayOdds?.toFixed(2)} ({(p.meta as any).bookmakerCount} bukmacherów)
                </>
              )}
              {p.source === "poisson_elo_model" && (
                <>
                  Elo — Gospodarze {(p.meta as any).homeElo ?? "b/d"} · Goście {(p.meta as any).awayElo ?? "b/d"}
                  {" · "}Oczekiwane gole — {(p.meta as any).lambdaHome?.toFixed(2)} :{" "}
                  {(p.meta as any).lambdaAway?.toFixed(2)}
                </>
              )}
            </div>
          )}
          <div className="source-meta">Pobrano: {new Date(p.fetchedAt).toLocaleString("pl-PL")}</div>
        </div>
      ))}
    </main>
  );
}
