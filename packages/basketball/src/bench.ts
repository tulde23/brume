import type { PageReading } from './assemble';

/**
 * Known answers for one sample page, written by a person reading the sheet.
 * Leave a field out when the sheet doesn't show it or the answer is unsure;
 * only fields that are present are scored.
 */
export interface BenchTruth {
  id: string;
  /** Short description of the book/layout, for the report. */
  layout: string;
  teamName?: string | null;
  coach?: string | null;
  date?: string | null;
  location?: string | null;
  /** Points per period (not running totals). */
  periods?: number[];
  final?: number;
  players?: { no: string; name?: string; points?: number; fouls?: number }[];
}

export interface BenchScore {
  id: string;
  /** "label: got / expected" lines for anything checked. */
  checks: { field: string; ok: boolean; got: string; expected: string }[];
  playersFound: number;
  playersExpected: number;
  pointsRight: number;
  pointsChecked: number;
  foulsRight: number;
  foulsChecked: number;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === (b ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (s: string | null | undefined) => (s ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');

/** Compare one page's reading with its known answers. */
export function scoreReading(truth: BenchTruth, page: PageReading): BenchScore {
  const checks: BenchScore['checks'] = [];
  const check = (field: string, got: unknown, expected: unknown, ok: boolean) =>
    checks.push({ field, ok, got: String(got ?? '–'), expected: String(expected ?? '–') });

  if (truth.teamName !== undefined) check('team', page.team.name, truth.teamName, same(page.team.name, truth.teamName));
  if (truth.coach !== undefined) check('coach', page.team.coach, truth.coach, same(page.team.coach, truth.coach));
  if (truth.location !== undefined) check('location', page.location, truth.location, same(page.location, truth.location));
  if (truth.date !== undefined) check('date', page.date, truth.date, same(page.date, truth.date));
  if (truth.final !== undefined) check('final', page.team.totalPoints, truth.final, page.team.totalPoints === truth.final);
  if (truth.periods) {
    const got = page.team.periodScores.slice(0, truth.periods.length);
    check('periods', got.join(' '), truth.periods.join(' '), got.every((n, i) => n === truth.periods![i]));
  }

  const expected = truth.players ?? [];
  const byNo = new Map(page.team.players.map((p) => [num(p.number), p]));
  let pointsRight = 0, pointsChecked = 0, foulsRight = 0, foulsChecked = 0;
  for (const t of expected) {
    const p = byNo.get(num(t.no));
    if (t.points !== undefined) {
      pointsChecked++;
      if (p?.points === t.points) pointsRight++;
    }
    if (t.fouls !== undefined) {
      foulsChecked++;
      if ((p?.fouls ?? 0) === t.fouls && p) foulsRight++;
    }
  }
  const playersFound = expected.filter((t) => byNo.has(num(t.no))).length;

  return {
    id: truth.id,
    checks,
    playersFound,
    playersExpected: expected.length,
    pointsRight,
    pointsChecked,
    foulsRight,
    foulsChecked,
  };
}
