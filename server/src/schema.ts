import { z } from 'zod';

import type { Game } from '@brume/basketball';

const stat = z.number().int().min(0).max(1000).nullable();
const text = (max: number) => z.string().max(max).nullable();

const player = z.object({
  number: text(10),
  name: text(80),
  fouls: stat,
  fg2: stat,
  fg3: stat,
  ftMade: stat,
  ftAttempted: stat,
  points: stat,
  readNotes: z.array(z.string().max(300)).max(50),
});

const team = z.object({
  name: text(80),
  periodScores: z.array(stat).max(12),
  totalPoints: stat,
  timeoutsUsed: stat,
  players: z.array(player).max(40),
  pageUri: text(2000),
  crops: z.array(z.object({ regionId: z.string().max(60), uri: z.string().max(2000) })).max(20),
});

export const gameSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,40}$/i, 'id must be 6-40 letters or digits'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-mm-dd').nullable(),
  location: text(120),
  season: z.string().regex(/^\d{4}-\d{2}$/, 'season must look like 2026-27'),
  home: team,
  away: team,
  modelId: text(80),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

// Compile-time guard: the wire schema and the shared Game type must not drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesGame: Same<z.infer<typeof gameSchema>, Game> = true;
void _schemaMatchesGame;

/** Page photos and crops are file paths on the phone that took them; meaningless anywhere else. */
export function stripDeviceFiles(game: Game): Game {
  return {
    ...game,
    home: { ...game.home, pageUri: null, crops: [] },
    away: { ...game.away, pageUri: null, crops: [] },
  };
}
