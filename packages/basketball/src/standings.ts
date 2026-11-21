import type { Game, Side } from './types';
import { teamScore } from './validate';

/** One team's result in one game, from that team's side. */
export interface TeamResult {
  game: Game;
  side: Side;
  opponent: string;
  us: number;
  them: number;
  won: boolean;
}

export interface StandingRow {
  key: string;
  name: string;
  wins: number;
  losses: number;
  /** Win fraction, 0 to 1; 0 with no games. */
  pct: number;
  /** Games behind the leader; 0 for the leader. Halves are possible. */
  gamesBehind: number;
  /** Last ten, newest first: "W" / "L". */
  lastTen: ('W' | 'L')[];
  /** Current run, e.g. { kind: 'W', count: 3 }; null before the first result. */
  streak: { kind: 'W' | 'L'; count: number } | null;
  home: { wins: number; losses: number };
  away: { wins: number; losses: number };
  pointsFor: number;
  pointsAgainst: number;
  /** Newest first. */
  results: TeamResult[];
}

/**
 * The same team written two ways ("Hawks", "HAWKS ", "Hawks.") is one team.
 * Kept deliberately simple; the server registry handles real aliases.
 */
export function teamKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const when = (g: Game) => `${g.date ?? ''}|${String(g.createdAt).padStart(15, '0')}`;

/**
 * Every result a game can count toward: both teams named, both scores known, and
 * not a tie (a basketball game always has a winner; a tie means a misread score).
 */
export function gameResults(games: Game[]): TeamResult[][] {
  const out: TeamResult[][] = [];
  for (const g of games) {
    const h = teamScore(g.home);
    const a = teamScore(g.away);
    if (!g.home.name?.trim() || !g.away.name?.trim() || h === null || a === null || h === a) continue;
    out.push([
      { game: g, side: 'home', opponent: g.away.name, us: h, them: a, won: h > a },
      { game: g, side: 'away', opponent: g.home.name, us: a, them: h, won: a > h },
    ]);
  }
  return out;
}

/** The league table: best record first; ties broken by point difference, then name. */
export function standings(games: Game[]): StandingRow[] {
  const ordered = [...games].sort((x, y) => when(y).localeCompare(when(x))); // newest first
  const rows = new Map<string, StandingRow>();
  for (const pair of gameResults(ordered)) {
    for (const r of pair) {
      const name = (r.side === 'home' ? r.game.home.name : r.game.away.name)!.trim();
      const key = teamKey(name);
      const row =
        rows.get(key) ??
        ({
          key,
          name,
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
          results: [],
        } satisfies StandingRow);
      const mark = r.won ? 'W' : 'L';
      if (r.won) row.wins++;
      else row.losses++;
      const split = row[r.side];
      if (r.won) split.wins++;
      else split.losses++;
      row.pointsFor += r.us;
      row.pointsAgainst += r.them;
      if (row.lastTen.length < 10) row.lastTen.push(mark);
      // Results arrive newest first, so the streak is the opening run.
      if (!row.streak) row.streak = { kind: mark, count: 1 };
      else if (row.results.every((p) => p.won === r.won)) row.streak.count++;
      row.results.push(r);
      rows.set(key, row);
    }
  }
  const table = [...rows.values()];
  for (const row of table) row.pct = row.wins / Math.max(1, row.wins + row.losses);
  table.sort(
    (a, b) =>
      b.pct - a.pct ||
      b.wins - a.wins ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      a.name.localeCompare(b.name),
  );
  const top = table[0];
  for (const row of table) row.gamesBehind = top ? (top.wins - row.wins + (row.losses - top.losses)) / 2 : 0;
  return table;
}

/** ".750"; "1.000" for an unbeaten team. */
export const formatPct = (p: number) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
/** "–" for the leader, "1½" for halves. */
export const formatGamesBehind = (gb: number) =>
  gb <= 0 ? '–' : `${Math.floor(gb) || ''}${gb % 1 ? '½' : ''}` || '½';
