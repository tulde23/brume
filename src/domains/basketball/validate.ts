import type { Game, Issue, Side, TeamSheet } from './types';

export interface ValidationRules {
  /** Fouls before a player fouls out (5 in most US high school / youth leagues, 6 in NBA). */
  foulLimit: number;
}

export const DEFAULT_RULES: ValidationRules = { foulLimit: 5 };

const sum = (xs: (number | null)[]) =>
  xs.every((x) => x !== null) ? (xs as number[]).reduce((a, b) => a + b, 0) : null;

/**
 * Basketball arithmetic gives free cross-checks on what the model read.
 * Every disagreement becomes an Issue pointing at the cell to look at.
 */
export function validateTeam(team: TeamSheet, side: Side, rules = DEFAULT_RULES): Issue[] {
  const issues: Issue[] = [];
  const at = (path: string) => `${side}.${path}`;

  team.players.forEach((p, i) => {
    const row = `players.${i}`;
    const who = p.number ? `#${p.number}` : p.name ?? `row ${i + 1}`;
    if (!p.number && !p.name) {
      issues.push({ severity: 'warning', path: at(`${row}.number`), message: `Row ${i + 1} has no number or name` });
    }
    if (p.ftMade !== null && p.ftAttempted !== null && p.ftMade > p.ftAttempted) {
      issues.push({
        severity: 'error',
        path: at(`${row}.ftMade`),
        message: `${who}: ${p.ftMade} free throws made but only ${p.ftAttempted} attempted`,
      });
    }
    if (p.fouls !== null && p.fouls > rules.foulLimit) {
      issues.push({
        severity: 'warning',
        path: at(`${row}.fouls`),
        message: `${who}: ${p.fouls} fouls is over the ${rules.foulLimit}-foul limit`,
      });
    }
    if (p.points !== null && p.fg2 !== null && p.fg3 !== null && p.ftMade !== null) {
      const expected = 2 * p.fg2 + 3 * p.fg3 + p.ftMade;
      if (expected !== p.points) {
        issues.push({
          severity: 'warning',
          path: at(`${row}.points`),
          message: `${who}: baskets and free throws add up to ${expected}, but points say ${p.points}`,
        });
      }
    }
  });

  const numbers = new Map<string, number>();
  team.players.forEach((p, i) => {
    if (!p.number) return;
    const prev = numbers.get(p.number);
    if (prev !== undefined) {
      issues.push({
        severity: 'warning',
        path: at(`players.${i}.number`),
        message: `#${p.number} appears twice (rows ${prev + 1} and ${i + 1})`,
      });
    } else numbers.set(p.number, i);
  });

  const playerTotal = sum(team.players.map((p) => p.points));
  const periodTotal = sum(team.periodScores);
  if (team.totalPoints !== null && playerTotal !== null && team.players.length && playerTotal !== team.totalPoints) {
    issues.push({
      severity: 'warning',
      path: at('totalPoints'),
      message: `Player points add up to ${playerTotal}, but the final score says ${team.totalPoints}`,
    });
  }
  if (team.totalPoints !== null && periodTotal !== null && periodTotal !== team.totalPoints) {
    issues.push({
      severity: 'warning',
      path: at('periodScores'),
      message: `Period scores add up to ${periodTotal}, but the final score says ${team.totalPoints}`,
    });
  }
  if (team.totalPoints === null) {
    issues.push({ severity: 'warning', path: at('totalPoints'), message: 'Final score is missing' });
  }
  return issues;
}

export function validateGame(game: Game, rules = DEFAULT_RULES): Issue[] {
  return [...validateTeam(game.home, 'home', rules), ...validateTeam(game.away, 'away', rules)];
}

/** Final score for a team: the written total, else the sum of player points. */
export function teamScore(team: TeamSheet): number | null {
  return team.totalPoints ?? sum(team.players.map((p) => p.points));
}
