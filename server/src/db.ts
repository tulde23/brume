import Database from 'better-sqlite3';

import type { Game } from '@brume/basketball';

export type DB = Database.Database;

/** Append-only list; each entry runs once, in order, tracked by PRAGMA user_version. */
const MIGRATIONS = [
  `
  CREATE TABLE games (
    space      TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    season     TEXT    NOT NULL,
    date       TEXT,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER NOT NULL,
    data       TEXT,
    PRIMARY KEY (space, id)
  );
  CREATE INDEX games_by_seq ON games (space, seq);
  CREATE INDEX games_by_season ON games (space, season, deleted);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  INSERT INTO meta (key, value) VALUES ('seq', 0);
  `,
];

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

interface Row {
  id: string;
  updated_at: number;
  deleted: number;
  seq: number;
  data: string | null;
}

export interface Change {
  id: string;
  deleted: boolean;
  updatedAt: number;
  seq: number;
  game: Game | null;
}

export type PutResult =
  | { status: 'saved' | 'unchanged'; change: Change }
  | { status: 'conflict'; current: Change };

const toChange = (r: Row): Change => ({
  id: r.id,
  deleted: r.deleted === 1,
  updatedAt: r.updated_at,
  seq: r.seq,
  game: r.data ? (JSON.parse(r.data) as Game) : null,
});

/**
 * Games are stored per "space" (one per API key, e.g. a team). Every write
 * takes the next value of a global sequence, so clients can ask for
 * "everything since seq N" without trusting device clocks for ordering.
 * Conflicts resolve last-writer-wins on the client's updatedAt.
 */
export function createStore(db: DB) {
  const getRow = db.prepare<[string, string], Row>(
    'SELECT id, updated_at, deleted, seq, data FROM games WHERE space = ? AND id = ?',
  );
  const nextSeq = db.prepare<[], { value: number }>(
    "UPDATE meta SET value = value + 1 WHERE key = 'seq' RETURNING value",
  );
  const upsert = db.prepare(
    `INSERT INTO games (space, id, season, date, updated_at, deleted, seq, data)
     VALUES (@space, @id, @season, @date, @updatedAt, @deleted, @seq, @data)
     ON CONFLICT (space, id) DO UPDATE SET season = excluded.season, date = excluded.date,
       updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq, data = excluded.data`,
  );
  const changesSince = db.prepare<[string, number, number], Row>(
    'SELECT id, updated_at, deleted, seq, data FROM games WHERE space = ? AND seq > ? ORDER BY seq LIMIT ?',
  );
  const seasonRows = db.prepare<[string], { season: string; games: number }>(
    'SELECT season, COUNT(*) AS games FROM games WHERE space = ? AND deleted = 0 GROUP BY season ORDER BY season DESC',
  );
  const seasonGames = db.prepare<[string, string], { data: string }>(
    'SELECT data FROM games WHERE space = ? AND season = ? AND deleted = 0 ORDER BY date, updated_at',
  );

  return {
    get(space: string, id: string): Change | null {
      const row = getRow.get(space, id);
      return row ? toChange(row) : null;
    },

    put: db.transaction((space: string, game: Game): PutResult => {
      const existing = getRow.get(space, game.id);
      if (existing && existing.updated_at > game.updatedAt) {
        return { status: 'conflict', current: toChange(existing) };
      }
      if (existing && !existing.deleted && existing.updated_at === game.updatedAt) {
        return { status: 'unchanged', change: toChange(existing) };
      }
      const seq = nextSeq.get()!.value;
      upsert.run({
        space,
        id: game.id,
        season: game.season,
        date: game.date,
        updatedAt: game.updatedAt,
        deleted: 0,
        seq,
        data: JSON.stringify(game),
      });
      return { status: 'saved', change: { id: game.id, deleted: false, updatedAt: game.updatedAt, seq, game } };
    }),

    /** Deletes leave a tombstone so other devices learn about them on their next pull. */
    remove: db.transaction((space: string, id: string, deletedAt: number): PutResult => {
      const existing = getRow.get(space, id);
      if (existing && existing.updated_at > deletedAt) {
        return { status: 'conflict', current: toChange(existing) };
      }
      if (existing?.deleted) return { status: 'unchanged', change: toChange(existing) };
      const seq = nextSeq.get()!.value;
      upsert.run({ space, id, season: '', date: null, updatedAt: deletedAt, deleted: 1, seq, data: null });
      return { status: 'saved', change: { id, deleted: true, updatedAt: deletedAt, seq, game: null } };
    }),

    changes(space: string, since: number, limit: number): Change[] {
      return changesSince.all(space, since, limit).map(toChange);
    },

    seasons(space: string) {
      return seasonRows.all(space);
    },

    seasonGames(space: string, season: string): Game[] {
      return seasonGames.all(space, season).map((r) => JSON.parse(r.data) as Game);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
