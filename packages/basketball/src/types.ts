export interface PlayerLine {
  number: string | null;
  name: string | null;
  fouls: number | null;
  fg2: number | null;
  fg3: number | null;
  ftMade: number | null;
  ftAttempted: number | null;
  points: number | null;
  /** Notes from reading this row (e.g. "read '1O' as 10"); shown next to the row. */
  readNotes: string[];
}

export interface TeamSheet {
  name: string | null;
  /** Points per quarter; index 4+ are overtimes. */
  periodScores: (number | null)[];
  totalPoints: number | null;
  timeoutsUsed: number | null;
  players: PlayerLine[];
  /** Page photo and the crops that were read, for side-by-side review. */
  pageUri: string | null;
  crops: { regionId: string; uri: string }[];
}

export interface Game {
  id: string;
  date: string | null; // ISO yyyy-mm-dd when known
  location: string | null;
  season: string;
  home: TeamSheet;
  away: TeamSheet;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type Side = 'home' | 'away';

export interface Issue {
  severity: 'error' | 'warning';
  /** Dotted path to the field, e.g. "home.players.3.points", so the UI can highlight that cell. */
  path: string;
  message: string;
}

export const emptyTeam = (): TeamSheet => ({
  name: null,
  periodScores: [null, null, null, null],
  totalPoints: null,
  timeoutsUsed: null,
  players: [],
  pageUri: null,
  crops: [],
});
