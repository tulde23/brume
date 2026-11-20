import { resultsFor, type ExtractionRun } from '@brume/ocr-engine';

import { emptyTeam, type PlayerLine, type TeamSheet } from './types';

interface RawPlayer {
  number: string | null;
  name: string | null;
  fouls: number | null;
  field_goals_2pt: number | null;
  field_goals_3pt: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  total_points: number | null;
}

interface RawSummary {
  team_name: string | null;
  opponent: string | null;
  date: string | null;
  location: string | null;
  period_scores: (number | null)[];
  final_score: number | null;
  timeouts_used: number | null;
}

export interface PageReading {
  team: TeamSheet;
  opponent: string | null;
  date: string | null;
  location: string | null;
  /** Regions the model failed on entirely. */
  failures: string[];
}

const filled = (p: PlayerLine) =>
  [p.number, p.name, p.fouls, p.fg2, p.fg3, p.ftMade, p.ftAttempted, p.points].filter((v) => v !== null)
    .length;

/** Rows seen in two overlapping strips are the same player; key on number, else name. */
function playerKey(p: PlayerLine): string | null {
  const num = p.number?.replace(/[^0-9]/g, '');
  if (num) return `#${Number(num)}`;
  const name = p.name?.toLowerCase().replace(/[^a-z]/g, '');
  return name ? `n:${name}` : null;
}

export function mergePlayers(rows: PlayerLine[]): PlayerLine[] {
  const out: PlayerLine[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    if (filled(row) === 0) continue;
    const key = playerKey(row);
    const at = key ? index.get(key) : undefined;
    if (at === undefined) {
      if (key) index.set(key, out.length);
      out.push(row);
    } else if (filled(row) > filled(out[at])) {
      out[at] = { ...row, readNotes: [...out[at].readNotes, ...row.readNotes] };
    }
  }
  return out;
}

/** Turn one page's extraction into a TeamSheet plus header details. */
export function readPage(run: ExtractionRun): PageReading {
  const team = emptyTeam();
  team.pageUri = run.sourceUri;
  const failures: string[] = [];

  const [summary] = resultsFor(run, 'summary');
  const s = summary?.data as RawSummary | null;
  if (summary) team.crops.push({ regionId: 'summary', uri: summary.imageUri });
  if (!s) failures.push('summary');
  if (s) {
    team.name = s.team_name;
    const periods = s.period_scores.length ? s.period_scores : [null, null, null, null];
    team.periodScores = [...periods, ...Array(Math.max(0, 4 - periods.length)).fill(null)];
    team.totalPoints = s.final_score;
    team.timeoutsUsed = s.timeouts_used;
  }

  const rows: PlayerLine[] = [];
  for (const tile of resultsFor(run, 'players')) {
    team.crops.push({ regionId: `players-${tile.tileIndex + 1}`, uri: tile.imageUri });
    const players = (tile.data as { players: RawPlayer[] } | null)?.players;
    if (!players) {
      failures.push(`players strip ${tile.tileIndex + 1}`);
      continue;
    }
    players.forEach((p, i) =>
      rows.push({
        number: p.number,
        name: p.name,
        fouls: p.fouls,
        fg2: p.field_goals_2pt,
        fg3: p.field_goals_3pt,
        ftMade: p.free_throws_made,
        ftAttempted: p.free_throws_attempted,
        points: p.total_points,
        readNotes: tile.warnings
          .filter((w) => w.startsWith(`$.players[${i}]`))
          .map((w) => w.replace(/^\$\.players\[\d+\]\./, '')),
      }),
    );
  }
  team.players = mergePlayers(rows);

  // Fill a missing points column from the marks when every part is known.
  for (const p of team.players) {
    if (p.points === null && p.fg2 !== null && p.fg3 !== null && p.ftMade !== null) {
      p.points = 2 * p.fg2 + 3 * p.fg3 + p.ftMade;
      p.readNotes.push('points computed from baskets and free throws');
    }
  }

  return { team, opponent: s?.opponent ?? null, date: s?.date ?? null, location: s?.location ?? null, failures };
}

/** Best-effort date normalization to yyyy-mm-dd; returns null when unsure. */
export function normalizeDate(raw: string | null, fallbackYear = new Date().getFullYear()): string | null {
  if (!raw) return null;
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return fmt(+iso[1], +iso[2], +iso[3]);
  const us = raw.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (!us) return null;
  let year = us[3] ? +us[3] : fallbackYear;
  if (year < 100) year += 2000;
  return fmt(year, +us[1], +us[2]);
}

function fmt(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
