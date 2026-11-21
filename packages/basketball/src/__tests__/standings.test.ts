import { emptyTeam, type Game } from '../types';
import { formatGamesBehind, formatPct, standings, teamKey } from '../standings';

let n = 0;
function game(date: string, home: string, h: number, away: string, a: number): Game {
  n++;
  return {
    id: `g${n}`,
    date,
    location: null,
    season: '2026-27',
    home: { ...emptyTeam(), name: home, totalPoints: h },
    away: { ...emptyTeam(), name: away, totalPoints: a },
    modelId: null,
    createdAt: n,
    updatedAt: n,
  };
}

describe('standings', () => {
  const games = [
    game('2026-12-01', 'Hawks', 50, 'Owls', 40),
    game('2026-12-04', 'Owls', 45, 'HAWKS', 44),
    game('2026-12-08', 'Hawks', 60, 'Rams', 30),
    game('2026-12-11', 'Rams', 41, 'Owls', 39),
    game('2026-12-15', 'Hawks.', 52, 'Owls', 50),
    game('2026-12-18', 'Rams', 20, 'Owls', 20), // tie: a misread, left out
    { ...game('2026-12-19', 'Rams', 30, 'Owls', 20), away: { ...emptyTeam(), name: null, totalPoints: 20 } }, // unnamed
  ];
  const table = standings(games);

  it('merges spellings of the same team and orders by record', () => {
    expect(table.map((r) => [r.name, r.wins, r.losses])).toEqual([
      ['Hawks.', 3, 1],
      ['Rams', 1, 1],
      ['Owls', 1, 3],
    ]);
  });

  it('works out games behind, last ten, streaks and splits', () => {
    const [hawks, rams, owls] = table;
    expect(hawks.gamesBehind).toBe(0);
    expect(rams.gamesBehind).toBe(1);
    expect(owls.gamesBehind).toBe(2);
    expect(hawks.lastTen).toEqual(['W', 'W', 'L', 'W']);
    expect(hawks.streak).toEqual({ kind: 'W', count: 2 });
    expect(owls.streak).toEqual({ kind: 'L', count: 2 });
    expect(hawks.home).toEqual({ wins: 3, losses: 0 });
    expect(hawks.away).toEqual({ wins: 0, losses: 1 });
    expect(hawks.pointsFor).toBe(50 + 44 + 60 + 52);
    expect(hawks.results[0].opponent).toBe('Owls');
  });

  it('formats', () => {
    expect(formatPct(0.75)).toBe('.750');
    expect(formatPct(1)).toBe('1.000');
    expect(formatGamesBehind(0)).toBe('–');
    expect(formatGamesBehind(1.5)).toBe('1½');
    expect(formatGamesBehind(0.5)).toBe('½');
    expect(teamKey(' Hawks. ')).toBe('hawks');
  });
});
