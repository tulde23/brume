import { pct, perGame, type SeasonLine } from './stats';
import type { Game } from './types';
import { teamScore } from './validate';

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (values: unknown[]) => values.map(cell).join(',');

export function gameToCsv(game: Game): string {
  const lines = [row(['date', 'team', 'opponent', 'number', 'name', 'fg2', 'fg3', 'ft_made', 'ft_att', 'fouls', 'points'])];
  for (const [team, opp] of [
    [game.home, game.away],
    [game.away, game.home],
  ] as const) {
    for (const p of team.players) {
      lines.push(
        row([game.date, team.name, opp.name, p.number, p.name, p.fg2, p.fg3, p.ftMade, p.ftAttempted, p.fouls, p.points]),
      );
    }
  }
  return lines.join('\n') + '\n';
}

/** Game as JSON without device-local file paths (they mean nothing on another device). */
export function gameToJson(game: Game): string {
  const strip = ({ pageUri: _p, crops: _c, ...team }: Game['home']) => team;
  return JSON.stringify(
    {
      ...game,
      home: { ...strip(game.home), score: teamScore(game.home) },
      away: { ...strip(game.away), score: teamScore(game.away) },
    },
    null,
    2,
  );
}

export function seasonToCsv(lines: SeasonLine[]): string {
  const out = [
    row(['team', 'number', 'name', 'games', 'points', 'ppg', 'fg2', 'fg3', 'ft_made', 'ft_att', 'ft_pct', 'fouls']),
  ];
  for (const l of lines) {
    out.push(
      row([
        l.team,
        l.number,
        l.name,
        l.games,
        l.points,
        perGame(l.points, l.games),
        l.fg2,
        l.fg3,
        l.ftMade,
        l.ftAttempted,
        pct(l.ftMade, l.ftAttempted),
        l.fouls,
      ]),
    );
  }
  return out.join('\n') + '\n';
}
