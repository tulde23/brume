import { withRegionOverrides, type DocumentTemplate, type FieldSchema, type NormRect } from '@inkstat/ocr-engine';

/**
 * A scorebook template: where each part of one kind of scorebook sits, marked
 * once by the user on a photo of a filled-in page. Positions are fractions of
 * the page (0..1), so they carry over to later photos of the same book taken
 * with the page filling the frame.
 */

/**
 * The region bank: every part a youth or high school scoresheet can have.
 * A template tags boxes with these types; each type has one way to be read
 * (applyTemplate) and checked (templateChecks), whatever the book.
 */
export type PartId =
  // Player table
  | 'rows'
  | 'names'
  | 'points'
  | 'fouls'
  | 'techFouls'
  | 'periodsPlayed'
  | 'scoringMarks'
  | 'fieldGoals'
  | 'threePointers'
  | 'freeThrows'
  // Game details
  | 'teamName'
  | 'opponent'
  | 'coach'
  | 'date'
  | 'location'
  | 'homeVisitor'
  | 'officials'
  | 'gameNumber'
  // Score summary
  | 'quarters'
  | 'halfScore'
  | 'finalScore'
  // Team areas
  | 'teamFouls'
  | 'timeouts'
  | 'runningScore'
  | 'benchTechs'
  | 'possession'
  | 'teamTotals';

/** A column inside the player rows: only its left edge and width; it spans the rows' height. */
export interface Band {
  x: number;
  w: number;
}

export type PartGroup = 'table' | 'details' | 'score' | 'team';

export const PART_GROUPS: { group: PartGroup; title: string; shape: string }[] = [
  { group: 'table', title: 'Player table', shape: 'Player rows box, then columns inside it' },
  { group: 'details', title: 'Game details', shape: 'Small boxes, one value each' },
  { group: 'score', title: 'Score summary', shape: 'Boxes of numbers' },
  { group: 'team', title: 'Team areas', shape: 'Small grids' },
];

/** How well a region reads today, from the test bench. */
export type PartStatus = 'strong' | 'ok' | 'weak' | 'planned';

export interface PartVariant {
  id: string;
  name: string;
  sub: string;
}

export interface PartSpec {
  id: PartId;
  name: string;
  group: PartGroup;
  /** A box anywhere on the page, or a band (column) across the player rows. */
  shape: 'box' | 'band';
  status: PartStatus;
  /** Ways a book can write this; picked once per template. The first is the default. */
  variants?: PartVariant[];
  /** Printed words near this part on most books, for suggesting a box's meaning. */
  labels: string[];
  /** What to do, shown on the marking step. */
  instruction: string;
  /** Why InkStat needs it, shown on the marking step. */
  why: string;
  /** Shorter reason for lists. */
  short: string;
}

const planned = (id: PartId, name: string, group: PartGroup, shape: 'box' | 'band', labels: string[], short: string): PartSpec => ({
  id,
  name,
  group,
  shape,
  status: 'planned',
  labels,
  instruction: shape === 'band' ? `Drag across the ${name.toLowerCase()} column.` : `Box the ${name.toLowerCase()} area.`,
  why: `${short} InkStat keeps this box with the template; reading it is coming soon.`,
  short,
});

export const PARTS: PartSpec[] = [
  // ── Player table ──
  {
    id: 'rows',
    name: 'Player rows',
    group: 'table',
    shape: 'box',
    status: 'strong',
    labels: ['player', 'players', 'name'],
    instruction: 'Draw a box around every player row, from the first name to the last empty row. Leave out the column headings.',
    why: 'InkStat only looks for players inside this box. The running-score grid is full of numbers that look like jersey numbers, so keeping it out stops fake players.',
    short: 'Keeps InkStat out of the headers and running-score grid.',
  },
  {
    id: 'names',
    name: 'Jersey no. + name',
    group: 'table',
    shape: 'band',
    status: 'strong',
    labels: ['player', 'name', 'no', 'pos', 'number'],
    instruction: 'Drag across the player name and jersey number columns.',
    why: 'Tells InkStat which player each row belongs to, and matches rows between reads by jersey number.',
    short: 'Which player each row belongs to.',
  },
  {
    id: 'points',
    name: 'Total points',
    group: 'table',
    shape: 'band',
    status: 'strong',
    labels: ['tp', 'pts', 'points', 'tot', 'total', 'te'],
    instruction: 'Drag across the TP or PTS column only. The band already runs the height of your player rows.',
    why: 'Next to the total are FG, FT and foul marks. If they are in the band, InkStat cannot tell which number is the total.',
    short: 'Read from just this column, points stay with the right player.',
  },
  {
    id: 'fouls',
    name: 'Personal fouls',
    group: 'table',
    shape: 'band',
    status: 'weak',
    variants: [
      { id: 'boxes', name: 'Crossed-off boxes', sub: 'P1–P5 or 1–5, one slashed per foul' },
      { id: 'total', name: 'A written total', sub: 'One number in an F or PF column' },
      { id: 'tally', name: 'Tally marks', sub: 'A stroke per foul, no boxes' },
    ],
    labels: ['fouls', 'foul', 'personal', 'pf', 'f'],
    instruction: 'Drag across the foul boxes, or the F / PF total column if your book has one.',
    why: 'InkStat reads each player’s fouls and flags anyone at 5 or more. Counting crossed-off boxes isn’t reliable yet; a written total is.',
    short: 'Each player’s fouls.',
  },
  planned('techFouls', 'Technical fouls', 'table', 'band', ['t1', 't2', 'tech'], 'T1 / T2 boxes per player.'),
  planned('periodsPlayed', 'Periods played', 'table', 'band', ['qtrs', 'played', 'quarters'], 'Which quarters each player played.'),
  planned('scoringMarks', 'Scoring marks', 'table', 'band', ['1q', '2q', '1st', 'qtr', 'half'], 'Tallies per quarter; gives points when TP is blank.'),
  planned('fieldGoals', 'Field goals', 'table', 'band', ['fg', 'fga', '2s'], 'Field goals made and attempted.'),
  planned('threePointers', '3-pointers', 'table', 'band', ['3pt', '3s', '3fg'], '3-pointers made and attempted.'),
  planned('freeThrows', 'Free throws', 'table', 'band', ['ft', 'fta', 'free'], 'Free throws made and attempted.'),
  // ── Game details ──
  {
    id: 'teamName',
    name: 'Team name',
    group: 'details',
    shape: 'box',
    status: 'strong',
    labels: ['team'],
    instruction: 'Box the handwritten team name, not the printed label.',
    why: 'Read from the whole page, scribbles near the name (like possession arrows) get taken for it. A small box shows InkStat only the name, enlarged.',
    short: 'Read up close, so nearby scribbles aren’t taken for the name.',
  },
  {
    id: 'opponent',
    name: 'Opponent',
    group: 'details',
    shape: 'box',
    status: 'ok',
    labels: ['vs', 'opponent', 'visitor', 'opp'],
    instruction: 'Box the handwritten name of the other team.',
    why: 'Names the other side of the game when only one team’s page is scanned.',
    short: 'The other team.',
  },
  {
    id: 'coach',
    name: 'Coach',
    group: 'details',
    shape: 'box',
    status: 'strong',
    labels: ['coach'],
    instruction: 'Box the handwritten coach’s name.',
    why: 'Shown on the box score and in exports.',
    short: 'Shown on the box score and in exports.',
  },
  {
    id: 'date',
    name: 'Date',
    group: 'details',
    shape: 'box',
    status: 'ok',
    labels: ['date'],
    instruction: 'Box the handwritten date.',
    why: 'Puts the game in the right season and order.',
    short: 'Puts the game in the right season.',
  },
  {
    id: 'location',
    name: 'Played at',
    group: 'details',
    shape: 'box',
    status: 'ok',
    labels: ['place', 'played', 'site', 'location', 'gym'],
    instruction: 'Box where the game was played.',
    why: 'Recorded with the game, and kept separate from the opponent’s name.',
    short: 'Recorded with the game.',
  },
  planned('homeVisitor', 'Home / Visitor', 'details', 'box', ['h', 'v', 'home', 'visitor'], 'Which side this page is.'),
  planned('officials', 'Officials', 'details', 'box', ['referee', 'umpire', 'umpires', 'officials', 'scorer', 'timer'], 'Referees, scorer and timer.'),
  planned('gameNumber', 'Game / event no.', 'details', 'box', ['game', 'event'], 'Tournament or game number.'),
  // ── Score summary ──
  {
    id: 'quarters',
    name: 'Score by period',
    group: 'score',
    shape: 'box',
    status: 'ok',
    labels: ['quarters', 'qtr', 'score', 'periods', 'final'],
    instruction: 'Box the score-by-period boxes, including overtime and the final score.',
    why: 'InkStat checks that player points add up to the final score, and converts running totals to points per period.',
    short: 'Checks player points add up to the final.',
  },
  {
    id: 'halfScore',
    name: 'Half-time score',
    group: 'score',
    shape: 'box',
    status: 'ok',
    labels: ['half'],
    instruction: 'Box the half-time score.',
    why: 'Checks the first two quarters.',
    short: 'Checks the first half.',
  },
  {
    id: 'finalScore',
    name: 'Final score',
    group: 'score',
    shape: 'box',
    status: 'ok',
    labels: ['final', 'total', 'totals'],
    instruction: 'Box the final score.',
    why: 'InkStat checks that player points add up to it.',
    short: 'Checks player points.',
  },
  // ── Team areas ──
  {
    id: 'teamFouls',
    name: 'Team fouls',
    group: 'team',
    shape: 'box',
    status: 'weak',
    labels: ['team', 'fouls'],
    instruction: 'Box the team fouls area: the numbered boxes crossed off as fouls happen.',
    why: 'InkStat counts team fouls for each half or quarter, for bonus tracking. Counting marks isn’t reliable yet.',
    short: 'Team fouls per half or quarter.',
  },
  {
    id: 'timeouts',
    name: 'Timeouts',
    group: 'team',
    shape: 'box',
    status: 'weak',
    labels: ['timeouts', 'time', 'outs'],
    instruction: 'Box the timeouts area, where taken timeouts are written or crossed off.',
    why: 'InkStat counts how many timeouts were used. Counting marks isn’t reliable yet.',
    short: 'How many timeouts were used.',
  },
  planned('runningScore', 'Running score', 'team', 'box', ['running', 'score'], 'The 1–120 tally of baskets.'),
  planned('benchTechs', 'Bench technicals', 'team', 'box', ['coach', 't1', 't2', 't3'], 'Technicals on the coach or bench.'),
  planned('possession', 'Possession arrow', 'team', 'box', ['possession', 'alternate'], 'Alternating possession marks.'),
  planned('teamTotals', 'Team totals', 'team', 'box', ['totals', 'team'], 'The totals row of the summary columns.'),
];

export const partSpec = (id: PartId): PartSpec => PARTS.find((p) => p.id === id)!;

/** Game details: marked together on one wizard step. */
export const DETAIL_PARTS: PartId[] = PARTS.filter((p) => p.group === 'details').map((p) => p.id);
export const REQUIRED_PARTS: PartId[] = ['rows', 'names', 'points'];
/** Parts a new template asks for by default (the ones that read well enough today). */
export const DEFAULT_ENABLED: PartId[] = ['rows', 'names', 'points', 'fouls', 'teamName', 'coach', 'date', 'location', 'quarters', 'timeouts', 'teamFouls'];

export interface ScorebookTemplate {
  version: 3;
  id: string;
  name: string;
  /** Parts the user chose to read, whether or not each is marked yet. */
  enabled: PartId[];
  /** Where each marked part is. Bands (names, points, fouls) span the rows box. */
  parts: Partial<Record<PartId, NormRect | Band>>;
  /** How this book writes each part that has variants (e.g. fouls: 'boxes' | 'total' | 'tally'). */
  variants: Partial<Record<PartId, string>>;
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
  techFouls: { x: 0.54, w: 0.05 },
  periodsPlayed: { x: 0.26, w: 0.05 },
  scoringMarks: { x: 0.31, w: 0.3 },
  fieldGoals: { x: 0.7, w: 0.05 },
  threePointers: { x: 0.75, w: 0.05 },
  freeThrows: { x: 0.8, w: 0.05 },
  opponent: { x: 0.4, y: 0.09, w: 0.25, h: 0.05 },
  homeVisitor: { x: 0.36, y: 0.02, w: 0.04, h: 0.06 },
  officials: { x: 0.4, y: 0.09, w: 0.3, h: 0.05 },
  gameNumber: { x: 0.84, y: 0.09, w: 0.14, h: 0.05 },
  halfScore: { x: 0.78, y: 0.19, w: 0.08, h: 0.06 },
  finalScore: { x: 0.9, y: 0.19, w: 0.08, h: 0.06 },
  runningScore: { x: 0.03, y: 0.1, w: 0.94, h: 0.08 },
  benchTechs: { x: 0.33, y: 0.3, w: 0.15, h: 0.05 },
  possession: { x: 0.03, y: 0.3, w: 0.2, h: 0.05 },
  teamTotals: { x: 0.04, y: 0.94, w: 0.92, h: 0.04 },
};

export function newTemplate(id: string, name: string, photoUri: string | null, now = Date.now()): ScorebookTemplate {
  return {
    version: 3,
    id,
    name,
    enabled: [...DEFAULT_ENABLED],
    parts: {},
    variants: {},
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

/**
 * Bring a stored template up to the current shape. v2 kept one `foulsKind`;
 * v3 keeps a variant per part (the region bank).
 */
export function migrateTemplate(raw: unknown): ScorebookTemplate | null {
  const t = raw as Partial<ScorebookTemplate> & { version?: number; foulsKind?: string };
  if (!t || typeof t !== 'object' || !t.id) return null;
  if (t.version === 3) return t as ScorebookTemplate;
  if (t.version === 2) {
    const { foulsKind, ...rest } = t;
    return { ...(rest as ScorebookTemplate), version: 3, variants: foulsKind ? { fouls: foulsKind } : {} };
  }
  return null;
}

/** The chosen variant of a part, or its default. */
export const variantOf = (t: Pick<ScorebookTemplate, 'variants'>, id: PartId): string | undefined =>
  t.variants?.[id] ?? partSpec(id).variants?.[0].id;

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
  halfScore: 'half_score',
  finalScore: 'final_score',
  timeouts: 'timeouts',
  teamFouls: 'team_fouls',
  quarters: 'quarters',
} as const;

/** Region id for one game detail's own read. */
type DetailId = 'teamName' | 'opponent' | 'coach' | 'location' | 'date';
export const detailRegion = (id: DetailId) => `detail_${DETAIL_FIELDS[id].key}`;

const DETAIL_FIELDS: Record<DetailId, { key: string; label: string }> = {
  teamName: { key: 'team_name', label: 'team name' },
  opponent: { key: 'opponent', label: 'opposing team\u2019s name' },
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
  const foulsVariant = variantOf(t, 'fouls');
  if (rows && has('names') && has('fouls')) {
    extra.push({
      id: REGION.fouls,
      label: 'Player fouls',
      rect: rows,
      columns: [
        { ...(t.parts.names as Band), label: 'jersey number and player name' },
        { ...(t.parts.fouls as Band), label: foulsVariant === 'total' ? 'fouls (F total)' : foulsVariant === 'tally' ? 'foul tally marks' : 'foul boxes' },
      ].sort((a, b) => a.x - b.x),
      joinColumns: true,
      tiles: { targetAspect: 1.2, overlap: 0.1, minRows: 2, maxRows: 10 },
      maxImageSide: 2048,
      maxTokens: 300,
      prompt:
        'These are rows from the player table of a basketball scorebook. Each row is one player. ' +
        (foulsVariant === 'total'
          ? 'For each row with a player written in, give the jersey number and the number in the fouls (F) column. '
          : foulsVariant === 'tally'
            ? 'For each row with a player written in, give the jersey number and how many tally strokes are in the fouls column (0 if none). '
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
  for (const id of ['teamName', 'opponent', 'coach', 'location', 'date'] as const) {
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
  for (const [id, key, label] of [
    ['halfScore', 'half_score', 'half-time score'],
    ['finalScore', 'final_score', 'final score'],
  ] as const) {
    if (!has(id)) continue;
    extra.push({
      id: REGION[id],
      label: partSpec(id).name,
      rect: t.parts[id] as NormRect,
      maxImageSide: 1024,
      maxTokens: 30,
      prompt: `This box is from a basketball scorebook page and holds the ${label}. Copy the number written in it. Use null if it is blank.`,
      schema: { type: 'object', properties: { [key]: nullableInt(label, 300) } },
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
