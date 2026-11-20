import { scoreReading } from '../bench';
import { emptyTeam, type PlayerLine } from '../types';

const p = (number: string, points: number | null, fouls: number | null = null): PlayerLine => ({
  number, name: 'x', points, fouls, fg2: null, fg3: null, ftMade: null, ftAttempted: null, readNotes: [],
});

describe('scoreReading', () => {
  it('scores only the fields the truth gives, matching players by number', () => {
    const team = { ...emptyTeam(), name: 'Stars ', totalPoints: 50, periodScores: [15, 11, 13, 11], players: [p('5', 4, 2), p('06', 2, null), p('7', 9, 0)] };
    const s = scoreReading(
      {
        id: 'stars',
        layout: 'x',
        teamName: 'STARS',
        final: 50,
        periods: [15, 11, 13, 11],
        players: [
          { no: '5', points: 4, fouls: 2 },
          { no: '6', points: 2, fouls: 0 },
          { no: '7', points: 8, fouls: 0 },
          { no: '8', points: 2 },
        ],
      },
      { team, opponent: null, date: null, location: null, failures: [], notes: [] },
    );
    expect(s.checks.every((c) => c.ok)).toBe(true);
    expect(s.playersFound).toBe(3);
    expect(s.playersExpected).toBe(4);
    expect([s.pointsRight, s.pointsChecked]).toEqual([2, 4]);
    // A blank foul cell for a player who has none counts as right.
    expect([s.foulsRight, s.foulsChecked]).toEqual([3, 3]);
  });
});
