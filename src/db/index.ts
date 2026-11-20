import type { SQLiteDatabase } from 'expo-sqlite';

import type { Game } from '@/domains/basketball';

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
  `);
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
  await db.runAsync('DELETE FROM games WHERE id = ?', id);
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
