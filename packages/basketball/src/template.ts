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
    team_name: {
      type: 'string',
      nullable: true,
      description: 'the handwritten name after "TEAM:" (not the printed word TEAM)',
    },
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

/**
 * Short keys, and only what a box score needs most. Output tokens are ~75% of
 * reading time, so each extra field per row is expensive. (v4 also asked for
 * 2PT/3PT/FT totals; scorebooks rarely fill those in, so they were mostly null.)
 * assemble.ts maps these back to PlayerLine.
 */
const playersSchema: FieldSchema = {
  type: 'object',
  properties: {
    players: {
      type: 'array',
      // A strip covers ~1/5 of the page: up to ~8 rows on a dense book. The cap stops a runaway
      // list (e.g. numbers from a running-score grid) before it burns the output budget.
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          no: { type: 'string', nullable: true, description: 'jersey number' },
          name: { type: 'string', nullable: true },
          tp: nullableInt('TOTAL POINTS column (TP / PTS)', 100),
          f: nullableInt('fouls: the F total, or crossed-out P1, P2... boxes', 6),
        },
      },
    },
  },
};

export const SCOREBOOK_PAGE_TEMPLATE: DocumentTemplate = {
  id: 'basketball.scorebook-page',
  name: 'Basketball scorebook (one team page)',
  version: 5,
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
      tiles: { rows: 5, overlap: 0.15 },
      // Cut out the quarter-by-quarter marks and join names | totals into one image, so the
      // TP column is not squeezed away when a model (Gemini Nano) resizes to a square.
      // History on the Stars sheet: v3 sent these as SEPARATE images and a 2B model lost row
      // alignment (TP 1/11); joining keeps every row on one line. Where images cannot be
      // joined (no native module), the engine falls back to full-width strips.
      columns: [
        { x: 0, w: 0.34, label: 'jersey number and player name' },
        { x: 0.68, w: 0.32, label: 'totals columns (FG, FT, F, TP or PTS)' },
      ],
      joinColumns: true,
      maxImageSide: 2048,
      maxTokens: 300,
      prompt:
        'This is part of the player table on a basketball scorebook page. Each row is one player. ' +
        'For each row with a player written in, give the jersey number, the name, the TOTAL POINTS ' +
        'column (TP or PTS), and the fouls (the F total, or crossed-out P1, P2... boxes). ' +
        'Use null for any blank cell; do not write 0 unless a 0 is written. ' +
        'Skip rows with no player, and anything that is not the player table (like a running-score grid).',
      schema: playersSchema,
    },
  ],
};
