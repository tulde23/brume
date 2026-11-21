import type { Board, Gender, Level, Result, Team } from './api';

/**
 * The league table, the same maths as the phone (packages/basketball/src/standings.ts),
 * built from registry results instead of scanned games. Disputed results have no score,
 * so they are listed but never counted; a tie means a misread score and is skipped too.
 */

export type Side = 'home' | 'away';

/** One game from one team's side. `won` is null when the result does not count. */
export interface TeamGame {
  result: Result;
  side: Side;
  opponent: Team;
  us: number | null;
  them: number | null;
  won: boolean | null;
}

export interface StandingRow {
  team: Team;
  wins: number;
  losses: number;
  pct: number;
  gamesBehind: number;
  /** Newest first. */
  lastTen: ('W' | 'L')[];
  streak: { kind: 'W' | 'L'; count: number } | null;
  home: { wins: number; losses: number };
  away: { wins: number; losses: number };
  pointsFor: number;
  pointsAgainst: number;
  /** Every game, newest first, counted or not. */
  games: TeamGame[];
}

export interface Division {
  key: string;
  label: string;
  rows: StandingRow[];
}

const LEVEL: Record<Level, string> = {
  varsity: 'Varsity',
  jv: 'JV',
  freshman: 'Freshman',
  middle: 'Middle School',
  youth: 'Youth',
  college: 'College',
  adult: 'Adult',
  other: 'Other',
};
const GENDER: Record<Gender, string> = { boys: 'Boys', girls: 'Girls', men: 'Men', women: 'Women', coed: 'Coed' };
const LEVEL_ORDER: Level[] = ['varsity', 'jv', 'freshman', 'middle', 'youth', 'college', 'adult', 'other'];

export const divisionKey = (t: Team) => `${t.level}|${t.gender}`;
export const divisionLabel = (t: Team) => `${LEVEL[t.level] ?? 'Other'} ${GENDER[t.gender] ?? ''}`.trim();

export const counts = (r: Result) =>
  r.status !== 'disputed' && r.home.score !== null && r.away.score !== null && r.home.score !== r.away.score;

/** Newest first; the server sends this order, but don't rely on it. */
export const newestFirst = (results: Result[]) => [...results].sort((a, b) => b.date.localeCompare(a.date));

/** Every team's row, keyed by team id. Games behind is set per division in `divisions`. */
export function teamRows(board: Board): Map<string, StandingRow> {
  const teams = new Map(board.teams.map((t) => [t.id, t]));
  const rows = new Map<string, StandingRow>();
  const rowOf = (team: Team) => {
    let row = rows.get(team.id);
    if (!row) {
      row = {
        team,
        wins: 0,
        losses: 0,
        pct: 0,
        gamesBehind: 0,
        lastTen: [],
        streak: null,
        home: { wins: 0, losses: 0 },
        away: { wins: 0, losses: 0 },
        pointsFor: 0,
        pointsAgainst: 0,
        games: [],
      };
      rows.set(team.id, row);
    }
    return row;
  };
  for (const r of newestFirst(board.results)) {
    const home = teams.get(r.home.id);
    const away = teams.get(r.away.id);
    if (!home || !away) continue;
    const counted = counts(r);
    for (const side of ['home', 'away'] as const) {
      const row = rowOf(side === 'home' ? home : away);
      const us = r[side].score;
      const them = r[side === 'home' ? 'away' : 'home'].score;
      const won = counted ? us! > them! : null;
      row.games.push({ result: r, side, opponent: side === 'home' ? away : home, us, them, won });
      if (won === null) continue;
      const mark = won ? 'W' : 'L';
      if (won) row.wins++;
      else row.losses++;
      if (won) row[side].wins++;
      else row[side].losses++;
      row.pointsFor += us!;
      row.pointsAgainst += them!;
      if (row.lastTen.length < 10) row.lastTen.push(mark);
      // Games arrive newest first, so the streak is the opening run.
      if (!row.streak) row.streak = { kind: mark, count: 1 };
      else if (row.streak.kind === mark && row.streak.count === row.wins + row.losses - 1) row.streak.count++;
    }
  }
  for (const row of rows.values()) row.pct = row.wins / Math.max(1, row.wins + row.losses);
  return rows;
}

const played = (r: StandingRow) => r.wins + r.losses;

/** Best record first; ties broken by point difference, then name. Teams yet to count a game go last. */
export function sortRows(rows: StandingRow[]): StandingRow[] {
  const table = [...rows].sort(
    (a, b) =>
      Number(played(b) > 0) - Number(played(a) > 0) ||
      b.pct - a.pct ||
      b.wins - a.wins ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      a.team.name.localeCompare(b.team.name),
  );
  const top = table[0];
  for (const row of table) row.gamesBehind = top ? (top.wins - row.wins + (row.losses - top.losses)) / 2 : 0;
  return table;
}

/** One table per level and gender ("Varsity Boys"), most common divisions in a fixed order. */
export function divisions(board: Board, rows = teamRows(board)): Division[] {
  const byKey = new Map<string, StandingRow[]>();
  for (const row of rows.values()) {
    const k = divisionKey(row.team);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }
  return [...byKey.entries()]
    .map(([key, list]) => ({ key, label: divisionLabel(list[0].team), rows: sortRows(list) }))
    .sort((a, b) => {
      const [la, ga] = a.key.split('|');
      const [lb, gb] = b.key.split('|');
      return LEVEL_ORDER.indexOf(la as Level) - LEVEL_ORDER.indexOf(lb as Level) || ga.localeCompare(gb);
    });
}

/** ".750"; "1.000" for an unbeaten team. */
export const formatPct = (p: number) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
/** "–" for the leader, "1½" for halves. */
export const formatGamesBehind = (gb: number) => (gb <= 0 ? '–' : `${Math.floor(gb) || ''}${gb % 1 ? '½' : ''}` || '½');
export const record = (s: { wins: number; losses: number }) => `${s.wins}–${s.losses}`;
export const perGame = (total: number, games: number) => (games ? Math.round((total / games) * 10) / 10 : 0);
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
export const place = (t: Team) => [t.town, t.state].filter(Boolean).join(', ');
