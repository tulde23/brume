import type { PageReading } from './assemble';
import { markedParts, partSpec, type PartId, type ScorebookTemplate } from './scorebook';

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

  return markedParts(t)
    .filter((part) => partSpec(part).status !== 'planned')
    .map((part): PartCheck => {
    switch (part) {
      case 'opponent':
        return text(part, page.opponent, 'Box just the handwritten name.');
      case 'finalScore':
        return final !== null
          ? { part, value: String(final), ok: true }
          : { part, value: 'Not read', ok: false, note: 'Box just the final score.' };
      case 'halfScore': {
        const h = team.halfScore ?? null;
        const q = team.periodScores;
        if (h === null) return { part, value: 'Not read', ok: false, note: 'Box just the half-time score.' };
        if (q[0] !== null && q[1] !== null && q[0] + q[1] !== h)
          return { part, value: `${h}`, ok: false, note: `Q1 + Q2 make ${q[0] + q[1]}, not ${h}.` };
        return { part, value: String(h), ok: true };
      }
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
        if (players.length >= 5 && players.every((p) => p.fouls === 0))
          return {
            part,
            value: 'all 0',
            ok: false,
            note: 'Every player reads 0 fouls, which almost never happens: crossed-off boxes were probably missed. Counting marks isn\u2019t reliable yet; a written F total reads better.',
          };
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
        if (team.timeoutsUsed === 0)
          return { part, value: '0 used', ok: false, note: 'No timeouts read. If the team took any, the marks were probably missed: counting marks isn\u2019t reliable yet.' };
        return team.timeoutsUsed !== null
          ? { part, value: `${team.timeoutsUsed} used`, ok: true }
          : { part, value: 'Not read', ok: false, note: 'Box the whole timeouts area.' };
      case 'teamFouls': {
        const tf = team.teamFouls ?? [];
        return tf.length && tf.every((n) => n !== null)
          ? { part, value: tf.join(' · '), ok: true }
          : { part, value: 'Not read', ok: false, note: 'Counting crossed-off boxes isn\u2019t reliable yet. Enter team fouls on the box score.' };
      }
      default:
        // Planned region types are kept with the template but not read yet.
        return { part, value: 'Not read yet', ok: true };
    }
  });
}
