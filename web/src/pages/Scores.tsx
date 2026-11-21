import { useMemo } from 'react';

import type { Board, Result, Team } from '../lib/api';
import { longDate } from '../lib/dates';
import { Link, withSeason } from '../lib/router';
import { newestFirst, record, teamRows, type StandingRow } from '../lib/standings';
import { TeamBadge } from '../ui';

/** Recent results, newest first, grouped by date. */
export function Scores({ board, season }: { board: Board; season: string | null }) {
  const teams = useMemo(() => new Map(board.teams.map((t) => [t.id, t])), [board]);
  const rows = useMemo(() => teamRows(board), [board]);
  const days = useMemo(() => {
    const out: { date: string; results: Result[] }[] = [];
    for (const r of newestFirst(board.results)) {
      const last = out[out.length - 1];
      if (last?.date === r.date) last.results.push(r);
      else out.push({ date: r.date, results: [r] });
    }
    return out;
  }, [board]);

  return (
    <div className="days">
      <h1 className="visually-hidden">{`Scores, ${board.season}`}</h1>
      {days.map((d) => (
        <section key={d.date} aria-labelledby={`day-${d.date}`} className="day">
          <h2 id={`day-${d.date}`} className="day-title">
            <time dateTime={d.date}>{longDate(d.date)}</time>
          </h2>
          <ul className="games">
            {d.results.map((r) => {
              const home = teams.get(r.home.id);
              const away = teams.get(r.away.id);
              if (!home || !away) return null;
              return (
                <li key={r.id}>
                  <GameCard result={r} home={home} away={away} rows={rows} season={season} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

const STATUS: Record<Result['status'], string> = { confirmed: 'Final', reported: 'Final · unconfirmed', disputed: 'Disputed' };

function GameCard({
  result: r,
  home,
  away,
  rows,
  season,
}: {
  result: Result;
  home: Team;
  away: Team;
  rows: Map<string, StandingRow>;
  season: string | null;
}) {
  const decided = r.home.score !== null && r.away.score !== null && r.home.score !== r.away.score;
  const winner = decided ? (r.home.score! > r.away.score! ? 'home' : 'away') : null;
  const line = (side: 'home' | 'away', team: Team) => {
    const row = rows.get(team.id);
    const lost = winner !== null && winner !== side;
    return (
      <div className={`game-line${lost ? ' lost' : ''}`}>
        <TeamBadge name={team.name} size={24} />
        <Link to={withSeason(`/team/${team.id}`, season)} className="game-team">
          {team.name}
        </Link>
        {row && <span className="game-record">{record(row)}</span>}
        <span className="game-score">{r[side].score ?? '–'}</span>
        <span className="win-mark" aria-hidden="true">
          {winner === side ? '◂' : ''}
        </span>
      </div>
    );
  };
  const label =
    r.home.score === null || r.away.score === null
      ? `${away.name} at ${home.name}, score disputed`
      : `${away.name} ${r.away.score} at ${home.name} ${r.home.score}, ${STATUS[r.status]}`;
  return (
    <article className="card game" aria-label={label}>
      {line('away', away)}
      {line('home', home)}
      <p className={`game-status ${r.status}`}>
        {STATUS[r.status]}
        {r.status === 'disputed' && <span className="muted"> · scorekeepers disagree</span>}
      </p>
    </article>
  );
}
