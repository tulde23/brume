import { useEffect, useMemo, useState } from 'react';

import type { Board } from '../lib/api';
import { shortDate } from '../lib/dates';
import { Link, withSeason } from '../lib/router';
import { divisionKey, divisionLabel, divisions, ordinal, perGame, place, record, teamRows, type StandingRow, type TeamGame } from '../lib/standings';
import { teamColor } from '../lib/team';
import { Notice, TeamBadge, Tabs } from '../ui';

type Tab = 'overview' | 'games';

/** One team: a header band in its colour, then Overview and Games tabs. */
export function TeamPage({ board, id, season }: { board: Board; id: string; season: string | null }) {
  const [tab, setTab] = useState<Tab>('overview');
  const rows = useMemo(() => teamRows(board), [board]);
  const row = rows.get(id);
  const table = useMemo(() => (row ? divisions(board, rows).find((d) => d.key === divisionKey(row.team)) : undefined), [board, rows, row]);

  useEffect(() => {
    document.title = row ? `${row.team.name} · InkStat` : 'Team · InkStat';
  }, [row]);

  if (!row) {
    return (
      <Notice title="No results for this team">
        <p className="muted">{`Nothing has been reported for this team in ${board.season}.`}</p>
        <p>
          <Link to={withSeason('/', season)}>Back to the standings</Link>
        </p>
      </Notice>
    );
  }

  const rank = table ? table.rows.findIndex((r) => r.team.id === id) + 1 : 0;
  const played = row.wins + row.losses;
  const where = place(row.team);
  const color = teamColor(row.team.name);
  const facts = [
    played > 0 && table ? `${ordinal(rank)} of ${table.rows.length}` : null,
    record(row),
    row.streak ? `${row.streak.kind}${row.streak.count}` : null,
  ].filter(Boolean);

  return (
    <div className="stack">
      <section className="team-hero" style={{ background: color }}>
        <div className="team-hero-top">
          <TeamBadge name={row.team.name} size={56} inverted />
          <div className="team-hero-text">
            <h1>{row.team.name}</h1>
            <p>{[where, divisionLabel(row.team), board.season].filter(Boolean).join(' · ')}</p>
            <p className="team-hero-facts">{facts.join(' · ')}</p>
          </div>
        </div>
        <Tabs
          label="Team"
          idPrefix="team"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'games', label: 'Games' },
          ]}
        />
      </section>
      <div id="team-panel" role="tabpanel" aria-labelledby={`team-tab-${tab}`} className="stack">
        {tab === 'overview' ? <Overview row={row} season={season} onAll={() => setTab('games')} /> : <Games games={row.games} season={season} />}
      </div>
    </div>
  );
}

function Overview({ row, season, onAll }: { row: StandingRow; season: string | null; onAll: () => void }) {
  const gp = row.wins + row.losses;
  const diff = perGame(row.pointsFor - row.pointsAgainst, gp);
  const tiles = [
    { k: 'Home', v: record(row.home) },
    { k: 'Away', v: record(row.away) },
    { k: 'PPG', v: String(perGame(row.pointsFor, gp)), title: 'Points per game' },
    { k: 'Diff', v: `${diff > 0 ? '+' : ''}${diff}`, cls: diff > 0 ? 'win' : diff < 0 ? 'loss' : '', title: 'Point difference per game' },
  ];
  return (
    <>
      <dl className="card tiles">
        {tiles.map((t) => (
          <div key={t.k} className="tile">
            <dt title={t.title}>{t.k}</dt>
            <dd className={t.cls}>{t.v}</dd>
          </div>
        ))}
      </dl>
      <section className="card" aria-labelledby="last10">
        <h2 id="last10" className="section-title plain">
          Last 10 · newest first
        </h2>
        {row.lastTen.length ? (
          <ol className="chips" aria-label={`Last ${row.lastTen.length}: ${row.lastTen.map((r) => (r === 'W' ? 'won' : 'lost')).join(', ')}`}>
            {row.lastTen.map((r, i) => (
              <li key={i} className={`chip ${r === 'W' ? 'chip-w' : 'chip-l'}`} aria-hidden="true">
                {r}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted pad">No counted games yet.</p>
        )}
      </section>
      <section className="card" aria-labelledby="recent">
        <h2 id="recent" className="section-title">
          Recent games
        </h2>
        <GameList games={row.games.slice(0, 4)} season={season} />
        {row.games.length > 4 && (
          <button type="button" className="more" onClick={onAll}>
            {`All ${row.games.length} games`}
          </button>
        )}
      </section>
    </>
  );
}

function Games({ games, season }: { games: TeamGame[]; season: string | null }) {
  return (
    <section className="card" aria-labelledby="all-games">
      <h2 id="all-games" className="section-title">
        {`${games.length} game${games.length === 1 ? '' : 's'} · newest first`}
      </h2>
      <GameList games={games} season={season} />
    </section>
  );
}

function GameList({ games, season }: { games: TeamGame[]; season: string | null }) {
  return (
    <ul className="results">
      {games.map((g) => {
        const mark = g.won === null ? '–' : g.won ? 'W' : 'L';
        const status = g.result.status === 'disputed' ? 'Disputed' : g.result.status === 'reported' ? 'Unconfirmed' : null;
        return (
          <li key={g.result.id} className="result">
            <span className={`result-mark ${g.won === null ? 'muted' : g.won ? 'win' : 'loss'}`} aria-label={g.won === null ? 'Not counted' : g.won ? 'Won' : 'Lost'}>
              {mark}
            </span>
            <span className="result-main">
              <span className="result-opp">
                {g.side === 'home' ? 'vs ' : '@ '}
                <Link to={withSeason(`/team/${g.opponent.id}`, season)}>{g.opponent.name}</Link>
              </span>
              <span className="result-sub">
                <time dateTime={g.result.date}>{shortDate(g.result.date)}</time>
                {` · ${g.side === 'home' ? 'Home' : 'Away'}`}
                {status && <span className={`flag ${g.result.status}`}>{status}</span>}
              </span>
            </span>
            <span className="result-score">{g.us === null || g.them === null ? '–' : `${g.us}–${g.them}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
