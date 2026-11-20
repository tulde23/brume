import type { PageReading } from './assemble';
import { markedParts, type PartId, type ScorebookTemplate } from './scorebook';

export interface PartCheck {
  part: PartId;
  /** What was read, short enough for one line. */
  value: string;
  ok: boolean;
  /** Why it needs checking, when it does. */
  note?: string;
}

/**
 * After a test read, one line per marked part: what Brume got and whether it
 * looks right. "Looks right" means read at all, and where there is a cross-check
 * (points vs the final score, quarters vs the final), that it passes.
 */
export function templateChecks(t: ScorebookTemplate, page: PageReading): PartCheck[] {
  const team = page.team;
  const players = team.players;
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const final = team.totalPoints;
  const text = (part: PartId, v: string | null | undefined, missing: string): PartCheck =>
    v ? { part, value: v, ok: true } : { part, value: 'Not read', ok: false, note: missing };

  return markedParts(t).map((part): PartCheck => {
    switch (part) {
      case 'rows':
        return players.length
          ? { part, value: `${players.length} players found`, ok: true }
          : { part, value: 'No players', ok: false, note: 'Check the box covers the player rows.' };
      case 'names': {
        const named = players.filter((p) => p.name).length;
        return named === players.length && named > 0
          ? { part, value: `${named} named`, ok: true }
          : { part, value: `${named} of ${players.length} named`, ok: false, note: 'Some rows have no name. Check the band covers the names.' };
      }
      case 'points': {
        const pts = players.map((p) => p.points);
        const missing = pts.filter((p) => p === null).length;
        const total = sum(pts);
        if (final !== null && total === final && missing === 0) return { part, value: `add up to ${final} ✓`, ok: true };
        if (final === null && missing === 0) {
          return {
            part,
            value: `${total} total`,
            ok: false,
            note: 'Every player has points, but no Final score was read to check them against. Fix the Score by quarter box to include the Final.',
          };
        }
        return {
          part,
          value: final !== null ? `${total} of ${final}` : `${total} total`,
          ok: false,
          note: missing
            ? `${missing} player${missing === 1 ? '' : 's'} had no points read. Check the band covers just the TP column.`
            : `Player points add up to ${total}, but the final says ${final}.`,
        };
      }
      case 'fouls': {
        const unclear = players.filter((p) => p.fouls === null).length;
        return unclear === 0
          ? { part, value: `${players.length} read`, ok: true }
          : {
              part,
              value: `${players.length - unclear} read, ${unclear} unclear`,
              ok: false,
              note: 'Widening the fouls band a little usually helps. Blank rows with no fouls also show here.',
            };
      }
      case 'teamName':
        return text(part, team.name, 'Box just the handwritten name.');
      case 'coach':
        return text(part, team.coach, 'Box just the handwritten name.');
      case 'location':
        return text(part, page.location, 'Box just the handwriting after the label.');
      case 'date':
        return text(part, page.date, 'Box just the handwritten date.');
      case 'quarters': {
        const q = team.periodScores;
        const shown = q.map((n) => (n === null ? '–' : String(n))).join(' ');
        if (final === null) return { part, value: shown, ok: false, note: 'The Final box was not read.' };
        return sum(q) === final
          ? { part, value: `${shown} = ${final}`, ok: true }
          : { part, value: `${shown} ≠ ${final}`, ok: false, note: 'Quarters don’t add up to the final. Check the box covers every quarter.' };
      }
      case 'timeouts':
        return team.timeoutsUsed !== null
          ? { part, value: `${team.timeoutsUsed} used`, ok: true }
          : { part, value: 'Not read', ok: false, note: 'Box the whole timeouts area.' };
      case 'teamFouls': {
        const tf = team.teamFouls ?? [];
        return tf.length && tf.every((n) => n !== null)
          ? { part, value: tf.join(' · '), ok: true }
          : { part, value: 'Not read', ok: false, note: 'Box all rows of team foul boxes.' };
      }
    }
  });
}
