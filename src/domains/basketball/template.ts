import type { DocumentTemplate, FieldSchema } from '@brume/ocr-engine';

/**
 * Reads ONE team's page of a standard US basketball scorebook: a header with
 * team/opponent/date, a player table (number, name, foul boxes, field goal and
 * free throw marks by quarter, totals), and a box with score by period.
 *
 * Layouts differ between scorebook brands, so the summary region is the whole
 * page at low resolution (the model finds the boxes), and the player table is
 * read in overlapping strips at high resolution (where accuracy matters).
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
    team_name: { type: 'string', nullable: true, description: "this page's team" },
    opponent: { type: 'string', nullable: true },
    date: { type: 'string', nullable: true, description: 'as written' },
    location: { type: 'string', nullable: true },
    period_scores: {
      type: 'array',
      items: nullableInt('points scored in that period'),
      maxItems: 8,
      description: 'Q1, Q2, Q3, Q4, then any overtimes',
    },
    final_score: nullableInt('team total points', 300),
    timeouts_used: nullableInt('timeouts marked as taken', 10),
  },
};

const playersSchema: FieldSchema = {
  type: 'object',
  properties: {
    players: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        properties: {
          number: { type: 'string', nullable: true, description: 'jersey number' },
          name: { type: 'string', nullable: true },
          fouls: nullableInt('personal fouls marked', 6),
          field_goals_2pt: nullableInt('2-point baskets made', 40),
          field_goals_3pt: nullableInt('3-point baskets made', 20),
          free_throws_made: nullableInt('free throws made', 40),
          free_throws_attempted: nullableInt('free throws attempted', 40),
          total_points: nullableInt('the TOTAL / TP column if filled in', 100),
        },
      },
    },
  },
};

export const SCOREBOOK_PAGE_TEMPLATE: DocumentTemplate = {
  id: 'basketball.scorebook-page',
  name: 'Basketball scorebook (one team page)',
  version: 1,
  systemPrompt:
    'You transcribe handwritten basketball scorebook pages exactly as written. ' +
    'You never invent players or numbers. If a value is blank or you cannot read it, use null.',
  regions: [
    {
      id: 'summary',
      label: 'Team, date and score by period',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      maxImageSide: 1024,
      maxTokens: 300,
      prompt:
        'This is one team\'s page from a basketball scorebook. Find the team name, opponent, date, ' +
        'location, the score for each period (quarters, then overtimes), the final score, and how ' +
        'many timeouts are marked as used. Ignore the player rows.',
      schema: summarySchema,
    },
    {
      id: 'players',
      label: 'Player rows',
      // Header and period-score boxes usually sit at the top and bottom edges.
      rect: { x: 0, y: 0.1, w: 1, h: 0.82 },
      tiles: { rows: 3, overlap: 0.12 },
      maxImageSide: 1280,
      maxTokens: 900,
      prompt:
        'This is part of the player table on a basketball scorebook page. Each row is one player: ' +
        'jersey number, name, foul boxes, then marks for each quarter, then totals columns. ' +
        'Conventions: a "2" or a slash in a scoring box is a 2-point basket, a "3" or a circled mark is a ' +
        '3-pointer; for free throws a filled dot or X is made and an empty circle or O is missed; ' +
        'fouls are ticks, "P", or numbers in the foul boxes. If the row has a totals column ' +
        '(FG, FT, TP / PTS), copy those numbers. Only list rows that have a player written in.',
      schema: playersSchema,
    },
  ],
};
