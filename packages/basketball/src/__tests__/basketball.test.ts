import type { ExtractionRun, RegionResult } from '@brume/ocr-engine';

import {
  emptyTeam,
  gameToCsv,
  mergePlayers,
  normalizeDate,
  readPage,
  seasonFor,
  seasonTotals,
  validateTeam,
  type Game,
  type PlayerLine,
} from '..';

const player = (p: Partial<PlayerLine>): PlayerLine => ({
  number: null,
  name: null,
  fouls: null,
  fg2: null,
  fg3: null,
  ftMade: null,
  ftAttempted: null,
  points: null,
  readNotes: [],
  ...p,
});

const result = (regionId: string, tileIndex: number, data: unknown, warnings: string[] = []): RegionResult => ({
  regionId,
  tileIndex,
  tileCount: 3,
  rect: { x: 0, y: 0, w: 1, h: 1 },
  imageUri: `crop-${regionId}-${tileIndex}`,
  data,
  raw: '',
  warnings,
  attempts: 1,
  durationMs: 1,
});

const raw = (number: string, name: string, pts: number | null, extra: object = {}) => ({
  number,
  name,
  fouls: 1,
  field_goals_2pt: 2,
  field_goals_3pt: 0,
  free_throws_made: 1,
  free_throws_attempted: 2,
  total_points: pts,
  ...extra,
});

describe('readPage', () => {
  const run: ExtractionRun = {
    templateId: 'basketball.scorebook-page',
    templateVersion: 1,
    modelId: 'fake',
    sourceUri: 'page.jpg',
    startedAt: 0,
    finishedAt: 1,
    results: [
      result('summary', 0, {
        team_name: 'Eagles',
        opponent: 'Lakeview',
        date: '11/14/26',
        location: null,
        period_scores: [12, 15, 11, 16],
        final_score: 54,
        timeouts_used: 3,
      }),
      result('players', 0, { players: [raw('3', 'Kim', 5), raw('11', 'Okafor', null)] }, ['$.players[1].fouls: read "1 " as 1']),
      // Overlap: Okafor appears again in the next strip with more filled in.
      result('players', 1, { players: [raw('11', 'Okafor', 5), raw('23', 'Rivera', 5)] }),
      result('players', 2, null),
    ],
  };

  const page = readPage(run);

  it('reads the summary', () => {
    expect(page.team.name).toBe('Eagles');
    expect(page.opponent).toBe('Lakeview');
    expect(page.team.periodScores).toEqual([12, 15, 11, 16]);
    expect(page.team.totalPoints).toBe(54);
  });

  it('merges players seen in overlapping strips', () => {
    expect(page.team.players.map((p) => p.number)).toEqual(['3', '11', '23']);
    expect(page.team.players[1].points).toBe(5);
  });

  it('keeps per-row read notes through the merge', () => {
    expect(page.team.players[1].readNotes).toContain('fouls: read "1 " as 1');
  });

  it('reports strips the model failed on', () => {
    expect(page.failures).toEqual(['players strip 3']);
  });

  it('keeps crops for review', () => {
    expect(page.team.crops.map((c) => c.regionId)).toEqual(['summary', 'players-1', 'players-2', 'players-3']);
  });
});

describe('mergePlayers', () => {
  it('treats "#07" and "7" as the same player, and drops empty rows', () => {
    const merged = mergePlayers([player({ number: '#07', name: 'A' }), player({}), player({ number: '7', fouls: 2, name: 'A' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].fouls).toBe(2);
  });
});

describe('validateTeam', () => {
  it('flags points that do not add up, at the points cell', () => {
    const team = { ...emptyTeam(), totalPoints: 19, players: [player({ number: '23', fg2: 5, fg3: 2, ftMade: 1, ftAttempted: 3, points: 19 })] };
    const issues = validateTeam(team, 'home');
    expect(issues).toContainEqual(expect.objectContaining({ path: 'home.players.0.points', severity: 'warning' }));
    expect(issues.find((i) => i.path === 'home.players.0.points')?.message).toContain('add up to 17');
  });

  it('errors when free throws made exceed attempts', () => {
    const team = { ...emptyTeam(), totalPoints: 3, players: [player({ number: '1', ftMade: 3, ftAttempted: 2, points: 3 })] };
    expect(validateTeam(team, 'away')[0]).toMatchObject({ severity: 'error', path: 'away.players.0.ftMade' });
  });

  it('checks fouls, duplicate numbers, and team totals', () => {
    const team = {
      ...emptyTeam(),
      periodScores: [10, 10, 10, 10],
      totalPoints: 45,
      players: [player({ number: '5', fouls: 6, points: 20 }), player({ number: '5', points: 20 })],
    };
    const paths = validateTeam(team, 'home').map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['home.players.0.fouls', 'home.players.1.number', 'home.totalPoints', 'home.periodScores']),
    );
  });

  it('passes a clean sheet', () => {
    const team = {
      ...emptyTeam(),
      periodScores: [2, 3, 0, 0],
      totalPoints: 5,
      players: [player({ number: '3', fg2: 1, fg3: 1, ftMade: 0, ftAttempted: 0, fouls: 1, points: 5 })],
    };
    expect(validateTeam(team, 'home')).toEqual([]);
  });
});

describe('dates and seasons', () => {
  it('normalizes common scorebook dates', () => {
    expect(normalizeDate('11/14/26')).toBe('2026-11-14');
    expect(normalizeDate('2026-1-5')).toBe('2026-01-05');
    expect(normalizeDate('Nov 14', 2026)).toBeNull();
    expect(normalizeDate('13/40/26')).toBeNull();
  });

  it('puts fall and winter games in the same season', () => {
    expect(seasonFor('2026-11-14')).toBe('2026-27');
    expect(seasonFor('2027-02-01')).toBe('2026-27');
    expect(seasonFor('2027-08-15')).toBe('2027-28');
  });
});

const game = (id: string, players: PlayerLine[]): Game => ({
  id,
  date: '2026-11-14',
  location: null,
  season: '2026-27',
  home: { ...emptyTeam(), name: 'Eagles', players },
  away: { ...emptyTeam(), name: 'Lakeview, North' },
  modelId: null,
  createdAt: 0,
  updatedAt: 0,
});

describe('season totals and export', () => {
  it('rolls up a player across games by team and number', () => {
    const lines = seasonTotals([
      game('a', [player({ number: '23', name: 'Rivera', points: 20, ftMade: 2, ftAttempted: 4 })]),
      game('b', [player({ number: '23', points: 10, ftMade: 1, ftAttempted: 1 })]),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: 'Rivera', games: 2, points: 30, ftMade: 3, ftAttempted: 5 });
  });

  it('escapes CSV fields with commas', () => {
    const csv = gameToCsv(game('a', [player({ number: '3', name: 'Kim', points: 5 })]));
    expect(csv.split('\n')[1]).toBe('2026-11-14,Eagles,"Lakeview, North",3,Kim,,,,,,5');
  });
});
