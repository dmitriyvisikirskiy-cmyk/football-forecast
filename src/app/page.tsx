import { getUpcomingMatches } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pl-PL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function HomePage() {
  let matches: Awaited<ReturnType<typeof getUpcomingMatches>> = [];
  let dbError: string | null = null;

  try {
    matches = await getUpcomingMatches(100);
  } catch (err: any) {
    dbError = err.message ?? String(err);
  }

  if (dbError) {
    return (
      <main className="container">
        <div className="empty-state">
          Baza danych jest jeszcze niedostępna ({dbError}). Gdy tylko POSTGRES_URL
          zostanie skonfigurowany, a schemat zmigrowany, nadchodzące mecze pojawią
          się tutaj.
        </div>
      </main>
    );
  }

  if (matches.length === 0) {
    return (
      <main className="container">
        <div className="empty-state">
          Brak nadchodzących meczów z ustalonymi drużynami. Prognozy pojawią się,
          gdy tylko codzienne zadanie cron (<code>/api/cron/update</code>) je znajdzie.
        </div>
      </main>
    );
  }

  const byCompetition = new Map<string, typeof matches>();
  for (const m of matches) {
    const key = m.competitionName;
    if (!byCompetition.has(key)) byCompetition.set(key, []);
    byCompetition.get(key)!.push(m);
  }

  return (
    <main className="container">
      {[...byCompetition.entries()].map(([competition, list]) => (
        <section className="competition-group" key={competition}>
          <h2>{competition}</h2>
          {list.map((m) => (
            <a className="match-card" href={`/match/${m.id}`} key={m.id}>
              <div className="match-row">
                <div>
                  <div className="teams">
                    {m.homeTeam} vs {m.awayTeam}
                  </div>
                  <div className="kickoff">{formatKickoff(m.kickoffUtc)}</div>
                </div>
              </div>
              {m.aggHomeProb !== null ? (
                <>
                  <div className="prob-bar">
                    <div className="home" style={{ width: `${m.aggHomeProb * 100}%` }} />
                    <div className="draw" style={{ width: `${(m.aggDrawProb ?? 0) * 100}%` }} />
                    <div className="away" style={{ width: `${(m.aggAwayProb ?? 0) * 100}%` }} />
                  </div>
                  <div className="prob-legend">
                    <span className="home-val">1 {(m.aggHomeProb * 100).toFixed(0)}%</span>
                    <span className="draw-val">X {((m.aggDrawProb ?? 0) * 100).toFixed(0)}%</span>
                    <span className="away-val">2 {((m.aggAwayProb ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                </>
              ) : (
                <div className="no-prediction">Brak jeszcze prognozy — czekamy na kolejne uruchomienie crona.</div>
              )}
            </a>
          ))}
        </section>
      ))}
    </main>
  );
}
