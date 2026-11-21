import { useMemo } from 'react';

import type { Board } from '../lib/api';
import { Link, useRouter, withSeason } from '../lib/router';
import { divisions, formatGamesBehind, formatPct, record, type StandingRow } from '../lib/standings';
import { TeamBadge } from '../ui';

export function Standings({ board, season }: { board: Board; season: string | null }) {
  const tables = useMemo(() => divisions(board), [board]);
  const counted = board.results.filter((r) => r.status !== 'disputed').length;
  return (
    <div className="stack">
      <h1 className="visually-hidden">{`Standings, ${board.season}`}</h1>
      {tables.map((d) => (
        <StandingsTable key={d.key} label={d.label} rows={d.rows} season={season} showLabel={tables.length > 1} />
      ))}
      <p className="small muted note">
        {`From ${counted} reported game${counted === 1 ? '' : 's'}. Disputed scores don't count until scorekeepers agree. Select a team for its games.`}
      </p>
    </div>
  );
}

const COLS: { key: string; label: string; title?: string; wide?: boolean; roomy?: boolean }[] = [
  { key: 'w', label: 'W', title: 'Wins' },
  { key: 'l', label: 'L', title: 'Losses' },
  { key: 'pct', label: 'PCT', title: 'Winning percentage' },
  { key: 'gb', label: 'GB', title: 'Games behind' },
  { key: 'l10', label: 'L10', title: 'Last 10 games', roomy: true },
  { key: 'strk', label: 'STRK', title: 'Streak' },
  { key: 'home', label: 'HOME', title: 'Home record', wide: true },
  { key: 'away', label: 'AWAY', title: 'Away record', wide: true },
  { key: 'pf', label: 'PF', title: 'Points for', wide: true },
  { key: 'pa', label: 'PA', title: 'Points against', wide: true },
  { key: 'diff', label: 'DIFF', title: 'Point difference', wide: true },
];

function StandingsTable({ label, rows, season, showLabel }: { label: string; rows: StandingRow[]; season: string | null; showLabel: boolean }) {
  const { navigate } = useRouter();
  return (
    <section className="card table-card" aria-label={`${label} standings`}>
      {showLabel && <h2 className="section-title">{label}</h2>}
      <div className="table-scroll">
        <table className="standings">
          <caption className="visually-hidden">{`${label} standings`}</caption>
          <thead>
            <tr>
              <th scope="col" className="c-rank">
                <span className="visually-hidden">Rank</span>
              </th>
              <th scope="col" className="c-team">
                TEAM
              </th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className={`num${c.wide ? ' wide' : ''}${c.roomy ? ' roomy' : ''}`}>
                  <abbr title={c.title}>{c.label}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const to = withSeason(`/team/${r.team.id}`, season);
              const l10w = r.lastTen.filter((x) => x === 'W').length;
              const diff = r.pointsFor - r.pointsAgainst;
              return (
                <tr key={r.team.id} className="row-link" onClick={(e) => !(e.target as HTMLElement).closest('a') && navigate(to)}>
                  <td className="c-rank muted">{i + 1}</td>
                  <th scope="row" className="c-team">
                    <Link to={to} className="team-link">
                      <TeamBadge name={r.team.name} />
                      <span className="team-name">{r.team.name}</span>
                    </Link>
                  </th>
                  <td className="num strong">{r.wins}</td>
                  <td className="num">{r.losses}</td>
                  <td className="num muted">{formatPct(r.pct)}</td>
                  <td className="num muted">{formatGamesBehind(r.gamesBehind)}</td>
                  <td className="num roomy">{r.lastTen.length ? `${l10w}-${r.lastTen.length - l10w}` : '–'}</td>
                  <td className={`num strong ${r.streak?.kind === 'L' ? 'loss' : 'win'}`}>{r.streak ? `${r.streak.kind}${r.streak.count}` : '–'}</td>
                  <td className="num wide">{record(r.home)}</td>
                  <td className="num wide">{record(r.away)}</td>
                  <td className="num wide">{r.pointsFor}</td>
                  <td className="num wide">{r.pointsAgainst}</td>
                  <td className={`num wide ${diff > 0 ? 'win' : diff < 0 ? 'loss' : ''}`}>{`${diff > 0 ? '+' : ''}${diff}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
