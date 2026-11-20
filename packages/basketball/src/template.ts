import type { DocumentTemplate, FieldSchema } from '@brume/ocr-engine';

/**
 * Reads ONE team's page of a standard US basketball scorebook: a header with
 * team/date/location, a player table (number, name, foul boxes, scoring marks
 * by quarter, totals columns), and a box with the score by period.
 *
 * Layouts differ between scorebook brands, so the summary region is the whole
 * page at low resolution (the model finds the boxes), and the player table is
 * read in overlapping strips at high resolution (where accuracy matters).
 *
 * Output keys are deliberately short: every key is repeated on every player
 * row, and on a phone each output token costs real time.
 */

const nullableInt = (description: string, maximum = 200): FieldSchema => ({
  type: 'integer',
  nullable: true,
  minimum: 0,
  maximum,
  description,
});

const summarySchema: FieldSchema = {
  type: 'object',
  properties: {
    team_name: { type: 'string', nullable: true, description: "this page's team (TEAM / Home / Visitor)" },
    opponent: { type: 'string', nullable: true, description: 'the OTHER team, only if written (vs. / Opponent)' },
    date: { type: 'string', nullable: true, description: 'as written' },
    location: { type: 'string', nullable: true, description: 'Played at / Site / Gym' },
    period_scores: {
      type: 'array',
      items: nullableInt('the number written in that period box'),
      maxItems: 8,
      description: 'Q1, Q2, Q3, Q4, then any overtimes, exactly as written',
    },
    final_score: nullableInt('the Final / Total box', 300),
    timeouts_used: nullableInt('timeouts marked as taken', 10),
  },
};

/** Short keys; assemble.ts maps them back to PlayerLine. */
const playersSchema: FieldSchema = {
  type: 'object',
  properties: {
    players: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          no: { type: 'string', nullable: true, description: 'jersey number' },
          name: { type: 'string', nullable: true },
          tp: nullableInt('TOTAL POINTS column (TP / PTS)', 100),
          f: nullableInt('personal fouls marked', 6),
          p2: nullableInt('2-pt baskets total, only if a 2PT/FG total column is filled in', 40),
          p3: nullableInt('3-pt baskets total, only if a 3PT total column is filled in', 20),
          ftm: nullableInt('free throws made, from the FT column if filled in', 40),
          fta: nullableInt('free throws attempted, from the FT column if filled in', 40),
        },
      },
    },
  },
};

export const SCOREBOOK_PAGE_TEMPLATE: DocumentTemplate = {
  id: 'basketball.scorebook-page',
  name: 'Basketball scorebook (one team page)',
  version: 4,
  systemPrompt:
    'You transcribe handwritten basketball scorebook pages exactly as written. ' +
    'You never invent players or numbers. If a value is blank or you cannot read it, use null.',
  regions: [
    {
      id: 'summary',
      label: 'Team, date and score by period',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      maxImageSide: 1024,
      maxTokens: 250,
      prompt:
        "This is one team's page from a basketball scorebook. Find the team name, the opponent " +
        '(only if written; "Played at" is the location, not the opponent), the date, the location, the ' +
        'numbers in the score-by-period boxes (quarters, then overtimes), the Final box, and how many ' +
        'timeouts are marked as used. Copy period numbers exactly as written, even if they look like ' +
        'running totals. A slashed zero (Ø) is 0. Ignore the player rows.',
      schema: summarySchema,
    },
    {
      id: 'players',
      label: 'Player rows',
      // Header and period-score boxes usually sit near the top; most of a page is the player table.
      rect: { x: 0, y: 0.1, w: 1, h: 0.82 },
      // Five full-width strips at up to 2048px keep each row tall enough to read.
      // (Tried in v3: sending only the name and totals columns as separate images. A 2B model
      // could not keep rows aligned across images, so TP accuracy fell from 6/11 to 1/11 on the
      // Stars sheet. The engine still supports `columns` for larger models.)
      tiles: { rows: 5, overlap: 0.15 },
      maxImageSide: 2048,
      maxTokens: 600,
      prompt:
        'This is part of the player table on a basketball scorebook page. Each row is one player: ' +
        'jersey number, name, foul boxes, scoring marks by quarter, then totals columns at the right. ' +
        'For each row with a player written in, give the number, the name, the TOTAL POINTS column ' +
        '(TP or PTS), and the number of fouls marked (crossed-out P1, P2... boxes, ticks, or numbers). ' +
        'Fill p2, p3, ftm and fta only from totals columns that are actually filled in; otherwise null. ' +
        'Use null for any blank cell; do not write 0 unless a 0 is written. ' +
        'Skip rows with no player, and anything that is not the player table (like a running-score grid).',
      schema: playersSchema,
    },
  ],
};
