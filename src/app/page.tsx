import { getUpcomingMatches, getRecentResults } from "@/lib/db";
import { flagForTeam } from "@/lib/countryFlags";

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

function TeamName({ name }: { name: string }) {
  const flag = flagForTeam(name);
  return (
    <>
      {flag && <span className="flag">{flag}</span>}
      {name}
    </>
  );
}

export default async function HomePage() {
  let matches: Awaited<ReturnType<typeof getUpcomingMatches>> = [];
  let results: Awaited<ReturnType<typeof getRecentResults>> = [];
  let dbError: string | null = null;

  try {
    [matches, results] = await Promise.all([getUpcomingMatches(100), getRecentResults(100)]);
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

  if (matches.length === 0 && results.length === 0) {
    return (
      <main className="container">
        <div className="empty-state">
          Brak meczów z ustalonymi drużynami. Dane pojawią się, gdy tylko
          codzienne zadanie cron (<code>/api/cron/update</code>) je znajdzie.
        </div>
      </main>
    );
  }

  const upcomingByCompetition = groupByCompetition(matches);
  const resultsByCompetition = groupByCompetition(results);

  return (
    <main className="container">
      {matches.length > 0 && (
        <>
          <h1 className="section-heading">Nadchodzące mecze</h1>
          {[...upcomingByCompetition.entries()].map(([competition, list]) => (
            <section className="competition-group" key={`upcoming-${competition}`}>
              <h2>{competition}</h2>
              {list.map((m) => (
                <a className="match-card" href={`/match/${m.id}`} key={m.id}>
                  <div className="match-row">
                    <div>
                      <div className="teams">
                        <TeamName name={m.homeTeam} /> vs <TeamName name={m.awayTeam} />
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
        </>
      )}

      {results.length > 0 && (
        <>
          <h1 className="section-heading">Rozegrane mecze</h1>
          {[...resultsByCompetition.entries()].map(([competition, list]) => (
            <section className="competition-group" key={`results-${competition}`}>
              <h2>{competition}</h2>
              {list.map((m) => (
                <div className="match-card result-card" key={m.id}>
                  <div className="match-row">
                    <div>
                      <div className="teams">
                        <TeamName name={m.homeTeam} /> vs <TeamName name={m.awayTeam} />
                      </div>
                      <div className="kickoff">{formatKickoff(m.kickoffUtc)}</div>
                    </div>
                    <div className="score">
                      {m.homeScore} : {m.awayScore}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

function groupByCompetition<T extends { competitionName: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const m of items) {
    const key = m.competitionName;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return map;
}
