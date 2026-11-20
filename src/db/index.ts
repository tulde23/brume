import type { SQLiteDatabase } from 'expo-sqlite';

import type { Game } from '@brume/basketball';

export const DB_NAME = 'brume.db';

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY NOT NULL,
      season TEXT NOT NULL,
      date TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_by_season ON games (season, date);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    -- Deletes waiting to be sent to the sync server.
    CREATE TABLE IF NOT EXISTS tombstones (
      id TEXT PRIMARY KEY NOT NULL,
      deleted_at INTEGER NOT NULL
    );
  `);
}

export async function gamesUpdatedSince(db: SQLiteDatabase, since: number): Promise<Game[]> {
  const rows = await db.getAllAsync<{ data: string }>(
    'SELECT data FROM games WHERE updated_at > ? ORDER BY updated_at',
    since,
  );
  return rows.map((r) => JSON.parse(r.data) as Game);
}

export async function listTombstones(db: SQLiteDatabase): Promise<{ id: string; deletedAt: number }[]> {
  const rows = await db.getAllAsync<{ id: string; deleted_at: number }>('SELECT id, deleted_at FROM tombstones');
  return rows.map((r) => ({ id: r.id, deletedAt: r.deleted_at }));
}

export async function clearTombstone(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM tombstones WHERE id = ?', id);
}

/** Apply a delete that came from the server, without queueing it to be sent back. */
export async function deleteGameFromSync(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM games WHERE id = ?', id);
}

export async function saveGame(db: SQLiteDatabase, game: Game): Promise<void> {
  await db.runAsync(
    `INSERT INTO games (id, season, date, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET season = excluded.season, date = excluded.date,
       data = excluded.data, updated_at = excluded.updated_at`,
    game.id,
    game.season,
    game.date,
    JSON.stringify(game),
    game.createdAt,
    game.updatedAt,
  );
}

export async function getGame(db: SQLiteDatabase, id: string): Promise<Game | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM games WHERE id = ?', id);
  return row ? (JSON.parse(row.data) as Game) : null;
}

export async function listGames(db: SQLiteDatabase, season?: string): Promise<Game[]> {
  const rows = season
    ? await db.getAllAsync<{ data: string }>(
        'SELECT data FROM games WHERE season = ? ORDER BY date DESC, created_at DESC',
        season,
      )
    : await db.getAllAsync<{ data: string }>('SELECT data FROM games ORDER BY date DESC, created_at DESC');
  return rows.map((r) => JSON.parse(r.data) as Game);
}

export async function listSeasons(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ season: string }>(
    'SELECT DISTINCT season FROM games ORDER BY season DESC',
  );
  return rows.map((r) => r.season);
}

export async function deleteGame(db: SQLiteDatabase, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM games WHERE id = ?', id);
    await db.runAsync(
      'INSERT INTO tombstones (id, deleted_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at',
      id,
      Date.now(),
    );
  });
}

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}
