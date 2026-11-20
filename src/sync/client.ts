import type { Game } from '@brume/basketball';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  clearTombstone,
  deleteGameFromSync,
  gamesUpdatedSince,
  getGame,
  getSetting,
  listTombstones,
  saveGame,
  setSetting,
} from '@/db';

/**
 * Optional sync with the Brume API. The phone stays the source of truth while
 * offline; a sync pushes local changes, then pulls everything newer from the
 * server. Conflicts are last-writer-wins on updatedAt, decided by the server.
 */

const KEYS = {
  url: 'sync.url',
  apiKey: 'sync.apiKey',
  cursor: 'sync.cursor',
  pushedAt: 'sync.pushedAt',
  lastSync: 'sync.lastSync',
} as const;

export interface SyncConfig {
  url: string;
  apiKey: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: number;
}

interface Change {
  id: string;
  deleted: boolean;
  updatedAt: number;
  seq: number;
  game: Game | null;
}

export async function getSyncConfig(db: SQLiteDatabase): Promise<SyncConfig | null> {
  const [url, apiKey] = await Promise.all([getSetting(db, KEYS.url), getSetting(db, KEYS.apiKey)]);
  return url && apiKey ? { url, apiKey } : null;
}

export async function setSyncConfig(db: SQLiteDatabase, config: SyncConfig): Promise<void> {
  const url = config.url.trim().replace(/\/+$/, '');
  const previous = await getSetting(db, KEYS.url);
  await setSetting(db, KEYS.url, url);
  await setSetting(db, KEYS.apiKey, config.apiKey.trim());
  if (previous !== url) {
    // A different server: start its change feed from the beginning and re-send everything.
    await setSetting(db, KEYS.cursor, '0');
    await setSetting(db, KEYS.pushedAt, '0');
  }
}

export async function lastSyncedAt(db: SQLiteDatabase): Promise<number | null> {
  const v = await getSetting(db, KEYS.lastSync);
  return v ? Number(v) : null;
}

class SyncError extends Error {}

async function request(config: SyncConfig, method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SyncError(`Could not reach ${config.url}. Check the address and your connection.`);
  }
  if (res.status === 401) throw new SyncError('The server rejected the API key.');
  return res;
}

/** Check the address and key without changing anything. Returns the server's name for this key. */
export async function testConnection(config: SyncConfig): Promise<string> {
  const res = await request(config, 'GET', '/v1/me');
  if (!res.ok) throw new SyncError(`Server answered ${res.status}`);
  return ((await res.json()) as { space: string }).space;
}

/** Keep this phone's photo paths when replacing a game with the server's copy. */
function mergeLocalFiles(incoming: Game, local: Game | null): Game {
  if (!local) return incoming;
  return {
    ...incoming,
    home: { ...incoming.home, pageUri: local.home.pageUri, crops: local.home.crops },
    away: { ...incoming.away, pageUri: local.away.pageUri, crops: local.away.crops },
  };
}

export async function syncNow(db: SQLiteDatabase): Promise<SyncResult> {
  const config = await getSyncConfig(db);
  if (!config) throw new SyncError('Set the server address and API key first.');
  const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0 };
  const startedAt = Date.now();

  // 1. Push local edits made since the last push.
  const pushedAt = Number((await getSetting(db, KEYS.pushedAt)) ?? 0);
  for (const game of await gamesUpdatedSince(db, pushedAt)) {
    const res = await request(config, 'PUT', `/v1/games/${game.id}`, game);
    if (res.status === 409) {
      // Someone saved a newer version; take it.
      const { current } = (await res.json()) as { current: Change };
      result.conflicts++;
      if (current.deleted) await deleteGameFromSync(db, game.id);
      else if (current.game) await saveGame(db, mergeLocalFiles(current.game, game));
    } else if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
      throw new SyncError(`Could not upload a game: ${detail.issues?.[0] ?? detail.error ?? res.status}`);
    } else {
      result.pushed++;
    }
  }

  // 2. Push local deletes.
  for (const t of await listTombstones(db)) {
    const res = await request(config, 'DELETE', `/v1/games/${t.id}?deletedAt=${t.deletedAt}`);
    if (res.status === 409) {
      const { current } = (await res.json()) as { current: Change };
      result.conflicts++;
      if (current.game) await saveGame(db, current.game);
    } else if (!res.ok) {
      throw new SyncError(`Could not send a delete: ${res.status}`);
    }
    await clearTombstone(db, t.id);
  }
  await setSetting(db, KEYS.pushedAt, String(startedAt));

  // 3. Pull everything the server has seen since our cursor.
  let cursor = Number((await getSetting(db, KEYS.cursor)) ?? 0);
  for (;;) {
    const res = await request(config, 'GET', `/v1/games?since=${cursor}`);
    if (!res.ok) throw new SyncError(`Could not download changes: ${res.status}`);
    const page = (await res.json()) as { changes: Change[]; cursor: number; more: boolean };
    for (const change of page.changes) {
      const local = await getGame(db, change.id);
      if (change.deleted) {
        if (local && local.updatedAt <= change.updatedAt) {
          await deleteGameFromSync(db, change.id);
          result.deleted++;
        }
      } else if (change.game && (!local || local.updatedAt < change.updatedAt)) {
        await saveGame(db, mergeLocalFiles(change.game, local));
        result.pulled++;
      }
    }
    cursor = page.cursor;
    await setSetting(db, KEYS.cursor, String(cursor));
    if (!page.more) break;
  }

  await setSetting(db, KEYS.lastSync, String(Date.now()));
  return result;
}

export { SyncError };
