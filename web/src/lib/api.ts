/**
 * The public scoreboard from the InkStat API: team names, places, dates and scores.
 * Nothing about players, groups or accounts is ever sent here (see server/src/registry.ts).
 */

export type Level = 'varsity' | 'jv' | 'freshman' | 'middle' | 'youth' | 'college' | 'adult' | 'other';
export type Gender = 'boys' | 'girls' | 'men' | 'women' | 'coed';
export type ResultStatus = 'reported' | 'confirmed' | 'disputed';

export interface Team {
  id: string;
  name: string;
  town: string | null;
  state: string | null;
  level: Level;
  gender: Gender;
}

export interface Result {
  id: string;
  date: string;
  /** Scores are null when scorekeepers disagree (disputed). */
  home: { id: string; score: number | null };
  away: { id: string; score: number | null };
  status: ResultStatus;
}

export interface Board {
  sport: string;
  season: string;
  seasons: { season: string; games: number }[];
  teams: Team[];
  results: Result[];
}

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'https://api.inkstat.app';

const cache = new Map<string, Promise<Board>>();

/** One season's scoreboard; `season` empty means the newest season with results. */
export function loadBoard(season: string | null): Promise<Board> {
  const key = season ?? '';
  let p = cache.get(key);
  if (!p) {
    const qs = season ? `?season=${encodeURIComponent(season)}` : '';
    p = fetch(`${API_URL}/v1/public/scoreboard${qs}`, { headers: { accept: 'application/json' } }).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 429 ? 'Too many requests. Try again in a minute.' : `The scoreboard is unavailable (${res.status}).`);
      return (await res.json()) as Board;
    });
    // A failure is not remembered, so Retry really retries.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
