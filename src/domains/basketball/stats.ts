import type { Game, PlayerLine } from './types';

export interface SeasonLine {
  key: string;
  team: string;
  number: string | null;
  name: string | null;
  games: number;
  points: number;
  fg2: number;
  fg3: number;
  ftMade: number;
  ftAttempted: number;
  fouls: number;
}

export const perGame = (total: number, games: number) => (games ? Math.round((total / games) * 10) / 10 : 0);
export const pct = (made: number, att: number) => (att ? Math.round((made / att) * 1000) / 10 : null);

/** A player is the same across games if team, and jersey number (or name), match. */
function seasonKey(team: string, p: PlayerLine): string | null {
  const id = p.number?.trim() || p.name?.trim().toLowerCase();
  return id ? `${team.trim().toLowerCase()}|${id}` : null;
}

/** Season totals per player for one team (or all teams when `team` is omitted). */
export function seasonTotals(games: Game[], team?: string): SeasonLine[] {
  const lines = new Map<string, SeasonLine>();
  for (const g of games) {
    for (const sheet of [g.home, g.away]) {
      const teamName = sheet.name ?? 'Unknown';
      if (team && teamName.toLowerCase() !== team.toLowerCase()) continue;
      for (const p of sheet.players) {
        const key = seasonKey(teamName, p);
        if (!key) continue;
        const line =
          lines.get(key) ??
          ({
            key,
            team: teamName,
            number: p.number,
            name: p.name,
            games: 0,
            points: 0,
            fg2: 0,
            fg3: 0,
            ftMade: 0,
            ftAttempted: 0,
            fouls: 0,
          } satisfies SeasonLine);
        line.name ??= p.name;
        line.games += 1;
        line.points += p.points ?? 0;
        line.fg2 += p.fg2 ?? 0;
        line.fg3 += p.fg3 ?? 0;
        line.ftMade += p.ftMade ?? 0;
        line.ftAttempted += p.ftAttempted ?? 0;
        line.fouls += p.fouls ?? 0;
        lines.set(key, line);
      }
    }
  }
  return [...lines.values()].sort((a, b) => perGame(b.points, b.games) - perGame(a.points, a.games));
}

/** Seasons run across New Year: games from August on belong to "2026-27". */
export function seasonFor(isoDate: string | null, now = new Date()): string {
  const d = isoDate ? new Date(`${isoDate}T12:00:00`) : now;
  const y = Number.isNaN(d.getTime()) ? now.getFullYear() : d.getFullYear();
  const m = Number.isNaN(d.getTime()) ? now.getMonth() : d.getMonth();
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function teamNames(games: Game[]): string[] {
  const names = new Set<string>();
  for (const g of games) for (const s of [g.home, g.away]) if (s.name) names.add(s.name);
  return [...names].sort();
}
