import { gameToCsv, gameToJson, seasonToCsv, seasonTotals, validateGame } from '@inkstat/basketball';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { spaceFor, type KeyRing } from './auth';
import type { Store } from './db';
import { gameSchema, stripDeviceFiles } from './schema';

type Env = { Variables: { space: string } };

/** Reject timestamps more than a day ahead: a phone with a bad clock would otherwise win every conflict forever. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE = 500;

export function createApp({ store, keys, version = 'dev', log = true }: {
  store: Store;
  keys: KeyRing;
  version?: string;
  log?: boolean;
}) {
  const app = new Hono<Env>();

  app.use(secureHeaders());
  if (log) app.use(logger());

  app.get('/health', (c) => c.json({ ok: true, version }));

  const v1 = new Hono<Env>();

  v1.use(async (c, next) => {
    const space = spaceFor(keys, c.req.header('authorization'));
    if (!space) return c.json({ error: 'Missing or invalid API key' }, 401);
    c.set('space', space);
    await next();
  });

  v1.get('/me', (c) => c.json({ space: c.get('space') }));

  /** Change feed: everything written after `since` (a seq from a previous response), oldest first. */
  v1.get('/games', (c) => {
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(c.req.query('limit') ?? MAX_PAGE) || MAX_PAGE));
    const changes = store.changes(c.get('space'), since, limit + 1);
    const page = changes.slice(0, limit);
    return c.json({
      changes: page,
      cursor: page.length ? page[page.length - 1].seq : since,
      more: changes.length > limit,
    });
  });

  v1.get('/games/:id', (c) => {
    const found = store.get(c.get('space'), c.req.param('id'));
    if (!found || found.deleted) return c.json({ error: 'Not found' }, 404);
    return c.json({ game: found.game, seq: found.seq, issues: validateGame(found.game!) });
  });

  v1.put('/games/:id', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = gameSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid game', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
    }
    const game = stripDeviceFiles(parsed.data);
    if (game.id !== c.req.param('id')) return c.json({ error: 'Body id does not match URL' }, 400);
    if (game.updatedAt > Date.now() + MAX_CLOCK_SKEW_MS) {
      return c.json({ error: "updatedAt is in the future; check the device's clock" }, 400);
    }
    const result = store.put(c.get('space'), game);
    if (result.status === 'conflict') {
      return c.json({ error: 'A newer version exists', current: result.current }, 409);
    }
    // Saved and unchanged both return the stored change; the client only needs the seq.
    return c.json(result.change);
  });

  v1.delete('/games/:id', (c) => {
    const deletedAt = Number(c.req.query('deletedAt') ?? Date.now());
    if (!Number.isFinite(deletedAt) || deletedAt < 0 || deletedAt > Date.now() + MAX_CLOCK_SKEW_MS) {
      return c.json({ error: 'Invalid deletedAt' }, 400);
    }
    const result = store.remove(c.get('space'), c.req.param('id'), deletedAt);
    if (result.status === 'conflict') {
      return c.json({ error: 'The game was edited after this delete', current: result.current }, 409);
    }
    return c.json(result.change);
  });

  v1.get('/games/:id/export', (c) => {
    const found = store.get(c.get('space'), c.req.param('id'));
    if (!found?.game) return c.json({ error: 'Not found' }, 404);
    if (c.req.query('format') === 'csv') {
      c.header('Content-Disposition', `attachment; filename="${found.game.id}.csv"`);
      return c.body(gameToCsv(found.game), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
    }
    return c.body(gameToJson(found.game), 200, { 'Content-Type': 'application/json' });
  });

  v1.get('/seasons', (c) => c.json({ seasons: store.seasons(c.get('space')) }));

  v1.get('/seasons/:season/stats', (c) => {
    const season = c.req.param('season');
    const lines = seasonTotals(store.seasonGames(c.get('space'), season), c.req.query('team') || undefined);
    if (c.req.query('format') === 'csv') {
      c.header('Content-Disposition', `attachment; filename="season-${season}.csv"`);
      return c.body(seasonToCsv(lines), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
    }
    return c.json({ season, players: lines });
  });

  app.route('/v1', v1);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
