import { withRegionOverrides, type DocumentTemplate, type FieldSchema, type NormRect } from '@brume/ocr-engine';

/**
 * A scorebook template: where each part of one kind of scorebook sits, marked
 * once by the user on a photo of a filled-in page. Positions are fractions of
 * the page (0..1), so they carry over to later photos of the same book taken
 * with the page filling the frame.
 */

/** Every part a template can mark. */
export type PartId =
  | 'rows'
  | 'names'
  | 'points'
  | 'fouls'
  | 'teamName'
  | 'coach'
  | 'location'
  | 'date'
  | 'timeouts'
  | 'teamFouls'
  | 'quarters';

/** A column inside the player rows: only its left edge and width; it spans the rows' height. */
export interface Band {
  x: number;
  w: number;
}

export type PartGroup = 'needed' | 'details' | 'stats';

export interface PartSpec {
  id: PartId;
  name: string;
  group: PartGroup;
  /** A box anywhere on the page, or a band across the player rows. */
  shape: 'box' | 'band';
  /** What to do, shown on the marking step. */
  instruction: string;
  /** Why Brume needs it, shown on the marking step and the section picker. */
  why: string;
  /** Shorter reason for the section picker. */
  short: string;
}

export const PARTS: PartSpec[] = [
  {
    id: 'rows',
    name: 'Player rows',
    group: 'needed',
    shape: 'box',
    instruction: 'Draw a box around every player row, from the first name to the last empty row. Leave out the column headings.',
    why: 'Brume only looks for players inside this box. The running-score grid is full of numbers that look like jersey numbers, so keeping it out stops fake players.',
    short: 'Keeps Brume out of the headers and running-score grid.',
  },
  {
    id: 'names',
    name: 'Names and numbers',
    group: 'needed',
    shape: 'band',
    instruction: 'Drag across the player name and jersey number columns.',
    why: 'Tells Brume which player each row belongs to.',
    short: 'Which player each row belongs to.',
  },
  {
    id: 'points',
    name: 'Total points',
    group: 'needed',
    shape: 'band',
    instruction: 'Drag across the TP or PTS column only. The band already runs the height of your player rows.',
    why: 'Next to the total are FG, FT and foul marks. If they are in the band, Brume cannot tell which number is the total.',
    short: 'Read from just this column, points stay with the right player.',
  },
  {
    id: 'fouls',
    name: 'Fouls',
    group: 'stats',
    shape: 'band',
    instruction: 'Drag across the foul boxes (P1 to P5), or the F total column if your book has one.',
    why: 'Brume counts the crossed-off boxes in each row to get a player’s fouls. A written F total is read more reliably than marks, so use it if your book has one.',
    short: 'Counts each player’s fouls.',
  },
  {
    id: 'teamName',
    name: 'Team name',
    group: 'details',
    shape: 'box',
    instruction: 'Box the handwritten team name, not the printed label.',
    why: 'Read from the whole page, scribbles near the name (like possession arrows) get taken for it. A small box shows Brume only the name, enlarged.',
    short: 'Read up close, so nearby scribbles aren’t taken for the name.',
  },
  {
    id: 'coach',
    name: 'Coach',
    group: 'details',
    shape: 'box',
    instruction: 'Box the handwritten coach’s name.',
    why: 'Shown on the box score and in exports.',
    short: 'Shown on the box score and in exports.',
  },
  {
    id: 'location',
    name: 'Played at',
    group: 'details',
    shape: 'box',
    instruction: 'Box where the game was played.',
    why: 'Recorded with the game, and kept separate from the opponent’s name.',
    short: 'Recorded with the game.',
  },
  {
    id: 'date',
    name: 'Date',
    group: 'details',
    shape: 'box',
    instruction: 'Box the handwritten date.',
    why: 'Puts the game in the right season and order.',
    short: 'Puts the game in the right season.',
  },
  {
    id: 'timeouts',
    name: 'Timeouts',
    group: 'stats',
    shape: 'box',
    instruction: 'Box the timeouts area, where taken timeouts are written or crossed off.',
    why: 'Brume counts how many timeouts were used.',
    short: 'How many timeouts were used.',
  },
  {
    id: 'teamFouls',
    name: 'Team fouls',
    group: 'stats',
    shape: 'box',
    instruction: 'Box the team fouls area: the numbered boxes crossed off as fouls happen.',
    why: 'Brume counts team fouls for each half or quarter, for bonus tracking.',
    short: 'Team fouls per half or quarter.',
  },
  {
    id: 'quarters',
    name: 'Score by quarter',
    group: 'stats',
    shape: 'box',
    instruction: 'Box the score-by-quarter boxes, including overtime and the final score.',
    why: 'Brume checks that player points add up to the final score, and converts running totals to points per quarter.',
    short: 'Checks player points add up to the final.',
  },
];

export const partSpec = (id: PartId): PartSpec => PARTS.find((p) => p.id === id)!;

/** Game details: marked together on one step, read together as one joined image. */
export const DETAIL_PARTS: PartId[] = ['teamName', 'coach', 'location', 'date'];
export const REQUIRED_PARTS: PartId[] = ['rows', 'names', 'points'];

export interface ScorebookTemplate {
  version: 2;
  id: string;
  name: string;
  /** Parts the user chose to read, whether or not each is marked yet. */
  enabled: PartId[];
  /** Where each marked part is. Bands (names, points, fouls) span the rows box. */
  parts: Partial<Record<PartId, NormRect | Band>>;
  /** How the book records player fouls: crossed-off boxes, or a written F total. */
  foulsKind: 'boxes' | 'total';
  /** The photo the template was made on, for editing and re-testing. */
  photoUri: string | null;
  /**
   * Printed labels on the template's photo and where they were. A new photo is
   * matched against them and the boxes are moved to fit it (optional: older
   * templates lack them and assume photos framed the same way).
   */
  anchors?: { text: string; x: number; y: number }[];
  /** Built-in layout this template started from, if any. */
  builtinId?: string;
  /** Last test read on that photo. */
  test: { at: number; seconds: number; checks: number; problems: number } | null;
  createdAt: number;
  updatedAt: number;
}

/** The single layout saved before templates existed (still read for migration). */
export interface LegacyScorebookLayout {
  version: 1;
  table: NormRect;
  nameColumn: Band;
  pointsColumn: Band;
  teamName?: NormRect;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where boxes start before the user moves them: roughly where most books put each part. */
export const DEFAULT_PARTS: Record<PartId, NormRect | Band> = {
  rows: { x: 0.04, y: 0.36, w: 0.92, h: 0.58 },
  names: { x: 0.04, w: 0.22 },
  points: { x: 0.86, w: 0.05 },
  fouls: { x: 0.44, w: 0.09 },
  teamName: { x: 0.06, y: 0.02, w: 0.3, h: 0.06 },
  coach: { x: 0.4, y: 0.02, w: 0.2, h: 0.06 },
  location: { x: 0.64, y: 0.02, w: 0.18, h: 0.06 },
  date: { x: 0.84, y: 0.02, w: 0.14, h: 0.06 },
  timeouts: { x: 0.03, y: 0.19, w: 0.28, h: 0.11 },
  teamFouls: { x: 0.33, y: 0.19, w: 0.34, h: 0.11 },
  quarters: { x: 0.69, y: 0.19, w: 0.29, h: 0.11 },
};

export function newTemplate(id: string, name: string, photoUri: string | null, now = Date.now()): ScorebookTemplate {
  return {
    version: 2,
    id,
    name,
    enabled: PARTS.map((p) => p.id),
    parts: {},
    foulsKind: 'boxes',
    photoUri,
    test: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function fromLegacyLayout(l: LegacyScorebookLayout, id: string, now = Date.now()): ScorebookTemplate {
  const t = newTemplate(id, 'My scorebook', null, now);
  t.enabled = [...REQUIRED_PARTS, ...(l.teamName ? (['teamName'] as PartId[]) : [])];
  t.parts = { rows: l.table, names: l.nameColumn, points: l.pointsColumn, ...(l.teamName ? { teamName: l.teamName } : {}) };
  return normalizeTemplate(t);
}

const isBand = (id: PartId) => partSpec(id).shape === 'band';

/** Keep boxes inside the page and bands inside the rows box. */
export function normalizeTemplate(t: ScorebookTemplate): ScorebookTemplate {
  const parts: ScorebookTemplate['parts'] = {};
  const rowsRaw = t.parts.rows as NormRect | undefined;
  const box = (r: NormRect, min = 0.01): NormRect => {
    const x = clamp(r.x, 0, 1 - min);
    const y = clamp(r.y, 0, 1 - min);
    return { x, y, w: clamp(r.w, min, 1 - x), h: clamp(r.h, min, 1 - y) };
  };
  const rows = rowsRaw ? box(rowsRaw, 0.05) : undefined;
  if (rows) parts.rows = rows;
  for (const [id, value] of Object.entries(t.parts) as [PartId, NormRect | Band][]) {
    if (id === 'rows' || !value) continue;
    if (isBand(id)) {
      const lo = rows?.x ?? 0;
      const hi = rows ? rows.x + rows.w : 1;
      const x = clamp(value.x, lo, hi - 0.01);
      parts[id] = { x, w: clamp(value.w, 0.01, hi - x) };
    } else {
      parts[id] = box(value as NormRect);
    }
  }
  return { ...t, parts };
}

/** Enabled parts that still need marking, in the order the wizard asks for them. */
export function unmarkedParts(t: ScorebookTemplate): PartId[] {
  return PARTS.map((p) => p.id).filter((id) => t.enabled.includes(id) && !t.parts[id]);
}

/** Enabled and marked: what a scan will actually read from the template. */
export function markedParts(t: ScorebookTemplate): PartId[] {
  return PARTS.map((p) => p.id).filter((id) => t.enabled.includes(id) && !!t.parts[id]);
}

/** A template can read pages once the player table is fully marked. */
export const isUsable = (t: ScorebookTemplate) => REQUIRED_PARTS.every((id) => t.enabled.includes(id) && !!t.parts[id]);

// Region ids added by templates; assemble.ts reads them.
export const REGION = {
  /** Older templates read all game details in one region. */
  details: 'details',
  fouls: 'player_fouls',
  timeouts: 'timeouts',
  teamFouls: 'team_fouls',
  quarters: 'quarters',
} as const;

/** Region id for one game detail's own read. */
export const detailRegion = (id: 'teamName' | 'coach' | 'location' | 'date') => `detail_${DETAIL_FIELDS[id].key}`;

const DETAIL_FIELDS: Record<'teamName' | 'coach' | 'location' | 'date', { key: string; label: string }> = {
  teamName: { key: 'team_name', label: 'team name' },
  coach: { key: 'coach', label: "coach's name" },
  location: { key: 'location', label: 'where the game was played' },
  date: { key: 'date', label: 'date' },
};

const nullableInt = (description: string, maximum: number): FieldSchema => ({
  type: 'integer',
  nullable: true,
  minimum: 0,
  maximum,
  description,
});

/**
 * The page template with every marked part applied:
 * - the player table reads only the marked columns, joined side by side;
 * - game details are one joined image of their small boxes, read up close;
 * - timeouts, team fouls and quarters each read their own box;
 * - the whole-page summary only runs when something it covers is not marked.
 */
export function applyTemplate(base: DocumentTemplate, raw: ScorebookTemplate): DocumentTemplate {
  const t = normalizeTemplate(raw);
  const has = (id: PartId) => t.enabled.includes(id) && !!t.parts[id];
  const rows = t.parts.rows as NormRect | undefined;

  let doc = base;
  if (rows && has('names') && has('points')) {
    // Points and fouls are read in separate passes. Measured on the Stars sheet with
    // Gemini Nano: names | TP gets every total; names | fouls | TP lost both.
    const columns = [
      { ...(t.parts.names as Band), label: 'jersey number and player name' },
      { ...(t.parts.points as Band), label: 'total points (TP or PTS)' },
    ].sort((a, b) => a.x - b.x);
    doc = withRegionOverrides(doc, {
      players: {
        rect: rows,
        columns,
        joinColumns: true,
        // Near-square crops: nothing is squeezed when a model resizes to a square.
        tiles: { targetAspect: 1.2, overlap: 0.1, minRows: 2, maxRows: 10 },
        prompt:
          'These are rows from the player table of a basketball scorebook. Each row is one player. ' +
          'For each row with a player written in, give the jersey number, the name, and the total points. ' +
          'Fouls are not shown here: use null for f. ' +
          'Use null for any blank cell; do not write 0 unless a 0 is written. Skip empty rows.',
      },
    });
  }

  const extra: DocumentTemplate['regions'] = [];
  if (rows && has('names') && has('fouls')) {
    extra.push({
      id: REGION.fouls,
      label: 'Player fouls',
      rect: rows,
      columns: [
        { ...(t.parts.names as Band), label: 'jersey number and player name' },
        { ...(t.parts.fouls as Band), label: t.foulsKind === 'total' ? 'fouls (F total)' : 'foul boxes' },
      ].sort((a, b) => a.x - b.x),
      joinColumns: true,
      tiles: { targetAspect: 1.2, overlap: 0.1, minRows: 2, maxRows: 10 },
      maxImageSide: 2048,
      maxTokens: 300,
      prompt:
        'These are rows from the player table of a basketball scorebook. Each row is one player. ' +
        (t.foulsKind === 'total'
          ? 'For each row with a player written in, give the jersey number and the number in the fouls (F) column. '
          : 'For each row with a player written in, give the jersey number and how many of that row\u2019s foul boxes ' +
            'are crossed off, slashed or marked (0 if none). Printed box labels like P1 or 1 are not marks. ') +
        'Skip empty rows.',
      schema: {
        type: 'object',
        properties: {
          players: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                no: { type: 'string', nullable: true, description: 'jersey number' },
                f: { type: 'integer', nullable: true, minimum: 0, maximum: 6, description: 'fouls' },
              },
            },
          },
        },
      },
    });
  }
  // Each game detail is read on its own: a small box enlarged alone is the most
  // legible (side by side, the date read 94 for 14; stacked, place and date came back blank).
  for (const id of ['teamName', 'coach', 'location', 'date'] as const) {
    if (!has(id)) continue;
    const field = DETAIL_FIELDS[id];
    extra.push({
      id: detailRegion(id),
      label: partSpec(id).name,
      rect: t.parts[id] as NormRect,
      maxImageSide: 1024,
      maxTokens: 40,
      prompt:
        `This box is from the header of a basketball scorebook page and holds the ${field.label}. ` +
        'Copy the handwriting exactly as written. Leave out printed labels like "TEAM:", "COACH:", "PLAYED AT:" or "DATE:". ' +
        'Use null if nothing is written.',
      schema: { type: 'object', properties: { [field.key]: { type: 'string', nullable: true, description: field.label } } },
    });
  }
  if (has('timeouts')) {
    extra.push({
      id: REGION.timeouts,
      label: 'Timeouts',
      rect: t.parts.timeouts as NormRect,
      maxImageSide: 1024,
      maxTokens: 40,
      prompt:
        'This is the timeouts area of a basketball scorebook page. Count the timeouts marked as taken: ' +
        'a written time, a slash, or a crossed-off box each count as one. Use 0 if none are marked.',
      schema: { type: 'object', properties: { timeouts_used: nullableInt('timeouts taken', 10) } },
    });
  }
  if (has('teamFouls')) {
    extra.push({
      id: REGION.teamFouls,
      label: 'Team fouls',
      rect: t.parts.teamFouls as NormRect,
      maxImageSide: 1024,
      maxTokens: 60,
      prompt:
        'This is the team fouls area of a basketball scorebook page: one row of numbered boxes per half ' +
        '(or per quarter). For each row, top to bottom, give how many fouls are marked: the count of ' +
        'crossed-off boxes (the highest number crossed off). Use 0 for a row with nothing marked.',
      schema: {
        type: 'object',
        properties: {
          team_fouls: { type: 'array', items: nullableInt('fouls marked in that row', 20), maxItems: 4 },
        },
      },
    });
  }
  if (has('quarters')) {
    extra.push({
      id: REGION.quarters,
      label: 'Score by quarter',
      rect: t.parts.quarters as NormRect,
      maxImageSide: 1024,
      maxTokens: 80,
      prompt:
        'This is the score-by-quarter box of a basketball scorebook page. Copy the number in each quarter ' +
        'box, then any overtime boxes, exactly as written (they may be running totals), and the Final box. ' +
        'A slashed zero (Ø) is 0.',
      schema: {
        type: 'object',
        properties: {
          period_scores: { type: 'array', items: nullableInt('the number in that box', 200), maxItems: 8 },
          final_score: nullableInt('the Final / Total box', 300),
        },
      },
    });
  }

  // The whole-page summary is a fallback: skip it when every field it reads is marked.
  const summaryCovered = has('teamName') && has('date') && has('location') && has('quarters');
  return {
    ...doc,
    regions: [...doc.regions.filter((r) => !(summaryCovered && r.id === 'summary')), ...extra],
  };
}
