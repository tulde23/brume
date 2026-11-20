import { gameToCsv, gameToJson, seasonFor, seasonToCsv, seasonTotals, validateGame } from '@inkstat/basketball';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';

import type { Accounts, User } from './auth/accounts';
import { spaceFor, type KeyRing } from './auth/keys';
import type { Docs, Store } from './db';
import { ApiError } from './errors';
import { groupSpace, type Groups } from './groups';
import { FAVICON_SVG, HOME_HTML } from './home';
import { clientAddress, rateLimit } from './rateLimit';
import type { Registry } from './registry';
import { gameSchema, stripDeviceFiles, templateSchema } from './schema';
import { sanitizeLayout, SPORTS } from './sanitize';

type Env = { Variables: { space: string; user: User } };
type C = Context<Env>;

/** Reject timestamps more than a day ahead: a phone with a bad clock would otherwise win every conflict forever. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE = 500;

const sport = z.enum(SPORTS as [string, ...string[]]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-mm-dd');
const score = z.number().int().min(0).max(999);

const schemas = {
  social: z.object({
    provider: z.enum(['Apple', 'Google']),
    idToken: z.string().min(20).max(8192),
    nonce: z.string().max(200).nullish(),
    displayName: z.string().max(120).nullish(),
    authorizationCode: z.string().max(2000).nullish(),
  }),
  refresh: z.object({ refreshToken: z.string().min(20).max(200) }),
  me: z.object({ displayName: z.string().trim().min(1).max(60) }),
  group: z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(['league', 'school', 'team']) }),
  groupName: z.object({ name: z.string().trim().min(1).max(80) }),
  join: z.object({ code: z.string().trim().min(6).max(12) }),
  role: z.object({ role: z.enum(['owner', 'member']) }),
  teamRef: z.object({ teamId: z.string().uuid() }),
  team: z.object({
    sport,
    name: z.string().trim().min(2).max(80),
    school: z.string().trim().max(120).nullish(),
    town: z.string().trim().max(80).nullish(),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, 'state must be a 2-letter code').nullish(),
    level: z.enum(['varsity', 'jv', 'freshman', 'middle', 'youth', 'college', 'adult', 'other']),
    gender: z.enum(['boys', 'girls', 'men', 'women', 'coed']),
  }),
  alias: z.object({ alias: z.string().trim().min(2).max(80) }),
  merge: z.object({ intoId: z.string().uuid() }),
  templateRef: z.object({ templateId: z.string().uuid() }),
  result: z.object({
    sport,
    date: isoDate,
    homeId: z.string().uuid(),
    awayId: z.string().uuid(),
    homeScore: score,
    awayScore: score,
    periods: z.object({ home: z.array(score.nullable()).max(12), away: z.array(score.nullable()).max(12) }).nullish(),
  }),
  roster: z.object({
    players: z.array(z.object({ number: z.string().trim().max(10).nullable(), name: z.string().trim().max(80).nullable() })).max(60),
  }),
};

async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.badRequest('InvalidRequest', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

const bearer = (c: C) => c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
const looksLikeJwt = (t: string) => t.split('.').length === 3;

export function createApp({
  store,
  docs,
  keys,
  accounts,
  groups,
  registry,
  version = 'dev',
  log = true,
}: {
  store: Store;
  docs: Docs;
  keys: KeyRing;
  accounts: Accounts;
  groups: Groups;
  registry: Registry;
  version?: string;
  log?: boolean;
}) {
  const app = new Hono<Env>();

  app.use(secureHeaders());
  if (log) app.use(logger());
  app.use('/v1/*', bodyLimit({ maxSize: 512 * 1024, onError: () => { throw new ApiError(413, 'TooLarge', 'That request is too large.'); } }));

  app.get('/health', (c) => c.json({ ok: true, version }));
  // A browser at the root sees the logo, nothing more.
  app.get('/', (c) => {
    c.header('Cache-Control', 'public, max-age=3600');
    return c.html(HOME_HTML);
  });
  app.get('/favicon.svg', (c) => c.body(FAVICON_SVG, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }));
  app.get('/favicon.ico', (c) => c.redirect('/favicon.svg', 301));

  const v1 = new Hono<Env>();

  // ---------------------------------------------------------------- auth (anonymous)

  const byAddress = rateLimit<Env>(30, 60_000, (c) => `ip:${clientAddress(c.req.header('x-forwarded-for'))}`);

  v1.post('/auth/social', byAddress, async (c) => {
    const req = await body(c, schemas.social);
    return c.json(await accounts.socialSignIn(req));
  });
  v1.post('/auth/refresh', byAddress, async (c) => {
    const { refreshToken } = await body(c, schemas.refresh);
    return c.json(await accounts.refresh(refreshToken));
  });
  v1.post('/auth/logout', byAddress, async (c) => {
    const { refreshToken } = await body(c, schemas.refresh);
    accounts.logout(refreshToken);
    return c.body(null, 204);
  });
  /** Apple's server-to-server notifications: `{ "payload": "<signed JWT>" }`. */
  v1.post('/auth/apple/notifications', byAddress, async (c) => {
    const { payload } = await body(c, z.object({ payload: z.string().min(20).max(8192) }));
    await accounts.appleNotification(payload);
    return c.body(null, 200);
  });

  // ---------------------------------------------------------------- signed-in routes

  const signedIn = async (c: C, next: () => Promise<void>) => {
    const token = bearer(c);
    if (!token || !looksLikeJwt(token)) throw ApiError.unauthorized();
    c.set('user', await accounts.authenticate(token));
    await next();
  };
  const writes = rateLimit<Env>(240, 60_000, (c) => `user:${c.get('user')?.id}`);

  const me = new Hono<Env>();
  me.use(signedIn);
  me.get('/', (c) => {
    const u = c.get('user');
    return c.json({ user: u, providers: accounts.providers(u.id), groups: groups.list(u.id) });
  });
  me.patch('/', async (c) => c.json({ user: accounts.rename(c.get('user').id, (await body(c, schemas.me)).displayName) }));
  me.post('/sign-out-everywhere', (c) => {
    accounts.signOutEverywhere(c.get('user').id);
    return c.body(null, 204);
  });
  me.delete('/', async (c) => {
    const id = c.get('user').id;
    await accounts.deleteAccount(id);
    // Their own synced games and templates go with the account. Games shared into a group stay with the group.
    store.purge(`u:${id}`);
    docs.purge(`u:${id}`);
    return c.body(null, 204);
  });
  // ---------------------------------------------------------------- games (sync feed)

  /**
   * The same sync API for a legacy key's space and for a group's games. Each handler
   * resolves its space itself, so no middleware leaks onto sibling routes when mounted.
   */
  const gamesRoutes = (r: Hono<Env>, prefix: string, spaceOf: (c: C) => string | Promise<string>) => {
    const resolve = async (c: C, next: () => Promise<void>) => {
      if (!c.get('space')) c.set('space', await spaceOf(c));
      await next();
    };
    for (const path of ['/games', '/games/*', '/seasons', '/seasons/*']) r.use(`${prefix}${path}`, resolve);
    r.get(`${prefix}/games`, (c) => {
      const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
      const limit = Math.min(MAX_PAGE, Math.max(1, Number(c.req.query('limit') ?? MAX_PAGE) || MAX_PAGE));
      const changes = store.changes(c.get('space'), since, limit + 1);
      const page = changes.slice(0, limit);
      return c.json({ changes: page, cursor: page.length ? page[page.length - 1].seq : since, more: changes.length > limit });
    });
    r.get(`${prefix}/games/:id`, (c) => {
      const found = store.get(c.get('space'), c.req.param('id'));
      if (!found || found.deleted) return c.json({ error: 'Not found' }, 404);
      return c.json({ game: found.game, seq: found.seq, issues: validateGame(found.game!) });
    });
    r.put(`${prefix}/games/:id`, async (c) => {
      const raw = await c.req.json().catch(() => undefined);
      const parsed = gameSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'Invalid game', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
      }
      const game = stripDeviceFiles(parsed.data);
      if (game.id !== c.req.param('id')) return c.json({ error: 'Body id does not match URL' }, 400);
      if (game.updatedAt > Date.now() + MAX_CLOCK_SKEW_MS) {
        return c.json({ error: "updatedAt is in the future; check the device's clock" }, 400);
      }
      const result = store.put(c.get('space'), game);
      if (result.status === 'conflict') return c.json({ error: 'A newer version exists', current: result.current }, 409);
      return c.json(result.change);
    });
    r.delete(`${prefix}/games/:id`, (c) => {
      const deletedAt = Number(c.req.query('deletedAt') ?? Date.now());
      if (!Number.isFinite(deletedAt) || deletedAt < 0 || deletedAt > Date.now() + MAX_CLOCK_SKEW_MS) {
        return c.json({ error: 'Invalid deletedAt' }, 400);
      }
      const result = store.remove(c.get('space'), c.req.param('id'), deletedAt);
      if (result.status === 'conflict') return c.json({ error: 'The game was edited after this delete', current: result.current }, 409);
      return c.json(result.change);
    });
    r.get(`${prefix}/games/:id/export`, (c) => {
      const found = store.get(c.get('space'), c.req.param('id'));
      if (!found?.game) return c.json({ error: 'Not found' }, 404);
      if (c.req.query('format') === 'csv') {
        c.header('Content-Disposition', `attachment; filename="${found.game.id}.csv"`);
        return c.body(gameToCsv(found.game), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
      }
      return c.body(gameToJson(found.game), 200, { 'Content-Type': 'application/json' });
    });
    r.get(`${prefix}/seasons`, (c) => c.json({ seasons: store.seasons(c.get('space')) }));
    r.get(`${prefix}/seasons/:season/stats`, (c) => {
      const season = c.req.param('season');
      const lines = seasonTotals(store.seasonGames(c.get('space'), season), c.req.query('team') || undefined);
      if (c.req.query('format') === 'csv') {
        c.header('Content-Disposition', `attachment; filename="season-${season}.csv"`);
        return c.body(seasonToCsv(lines), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
      }
      return c.json({ season, players: lines });
    });
  };

  // ---------------------------------------------------------------- personal sync

  /** Each account's own space: its games and templates follow it across devices. */
  const personal = (c: C) => `u:${c.get('user').id}`;
  gamesRoutes(me, '', personal);

  me.get('/templates', (c) => {
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(c.req.query('limit') ?? MAX_PAGE) || MAX_PAGE));
    const changes = docs.changes(personal(c), 'templates', since, limit + 1);
    const page = changes.slice(0, limit);
    return c.json({ changes: page, cursor: page.length ? page[page.length - 1].seq : since, more: changes.length > limit });
  });
  me.put('/templates/:id', async (c) => {
    const t = await body(c, templateSchema);
    if (t.id !== c.req.param('id')) throw ApiError.badRequest('IdMismatch', 'Body id does not match URL.');
    if (t.updatedAt > Date.now() + MAX_CLOCK_SKEW_MS) throw ApiError.badRequest('ClockSkew', "updatedAt is in the future; check the device's clock.");
    // The photo is a file on the phone that made it; meaningless anywhere else.
    const result = docs.put(personal(c), 'templates', t.id, t.updatedAt, { ...t, photoUri: null });
    if (result.status === 'conflict') return c.json({ code: 'Conflict', error: 'A newer version exists', current: result.current }, 409);
    return c.json(result.change);
  });
  me.delete('/templates/:id', (c) => {
    const deletedAt = Number(c.req.query('deletedAt') ?? Date.now());
    if (!Number.isFinite(deletedAt) || deletedAt < 0 || deletedAt > Date.now() + MAX_CLOCK_SKEW_MS) {
      throw ApiError.badRequest('InvalidRequest', 'Invalid deletedAt.');
    }
    const result = docs.remove(personal(c), 'templates', c.req.param('id'), deletedAt);
    if (result.status === 'conflict') return c.json({ code: 'Conflict', error: 'The template was edited after this delete', current: result.current }, 409);
    return c.json(result.change);
  });
  v1.route('/me', me);

  // ---------------------------------------------------------------- groups

  const g = new Hono<Env>();
  g.use(signedIn);
  g.use(async (c, next) => (c.req.method === 'GET' ? next() : writes(c, next)));
  g.get('/', (c) => c.json({ groups: groups.list(c.get('user').id) }));
  g.post('/', async (c) => {
    const { name, kind } = await body(c, schemas.group);
    return c.json({ group: groups.create(c.get('user').id, name, kind) }, 201);
  });
  g.post('/join', async (c) => c.json({ group: groups.join(c.get('user').id, (await body(c, schemas.join)).code) }));
  g.get('/:gid', (c) => {
    const u = c.get('user').id;
    const gid = c.req.param('gid');
    groups.require(gid, u);
    return c.json({ group: groups.list(u).find((x) => x.id === gid), members: groups.members(gid, u) });
  });
  g.patch('/:gid', async (c) => {
    groups.rename(c.req.param('gid'), c.get('user').id, (await body(c, schemas.groupName)).name);
    return c.body(null, 204);
  });
  g.post('/:gid/invite-code', (c) => c.json({ inviteCode: groups.rotateCode(c.req.param('gid'), c.get('user').id) }));
  g.post('/:gid/members/:uid/role', async (c) => {
    groups.setRole(c.req.param('gid'), c.get('user').id, c.req.param('uid'), (await body(c, schemas.role)).role);
    return c.body(null, 204);
  });
  g.delete('/:gid/members/:uid', (c) => {
    groups.removeMember(c.req.param('gid'), c.get('user').id, c.req.param('uid'));
    return c.body(null, 204);
  });

  g.get('/:gid/teams', (c) => {
    groups.require(c.req.param('gid'), c.get('user').id);
    return c.json({ teams: registry.groupTeams(c.req.param('gid')) });
  });
  g.post('/:gid/teams', async (c) => {
    groups.require(c.req.param('gid'), c.get('user').id);
    registry.addGroupTeam(c.req.param('gid'), (await body(c, schemas.teamRef)).teamId, c.get('user').id);
    return c.body(null, 204);
  });
  g.delete('/:gid/teams/:tid', (c) => {
    groups.require(c.req.param('gid'), c.get('user').id, 'owner');
    registry.removeGroupTeam(c.req.param('gid'), c.req.param('tid'));
    return c.body(null, 204);
  });
  g.get('/:gid/standings', (c) => {
    const gid = c.req.param('gid');
    groups.require(gid, c.get('user').id);
    const season = c.req.query('season') || seasonFor(null);
    const results = registry.groupResults(gid, season);
    const teams = registry.groupTeams(gid).map((t) => t.id);
    return c.json({ season, standings: registry.standings(teams, results), results });
  });
  g.get('/:gid/rosters/:tid', (c) => {
    groups.require(c.req.param('gid'), c.get('user').id);
    const season = c.req.query('season') || seasonFor(null);
    return c.json({ season, ...registry.roster(c.req.param('gid'), c.req.param('tid'), season) });
  });
  g.put('/:gid/rosters/:tid', async (c) => {
    groups.require(c.req.param('gid'), c.get('user').id);
    const season = c.req.query('season') || seasonFor(null);
    registry.putRoster(c.req.param('gid'), c.req.param('tid'), season, (await body(c, schemas.roster)).players, c.get('user').id);
    return c.body(null, 204);
  });

  gamesRoutes(g, '/:gid', (c) => {
    const gid = c.req.param('gid')!;
    groups.require(gid, c.get('user').id);
    return groupSpace(gid);
  });
  v1.route('/groups', g);

  // ---------------------------------------------------------------- registry

  // Each registry area is its own sub-app, so its sign-in check covers only its prefix.
  const area = () => {
    const a = new Hono<Env>();
    a.use(signedIn);
    a.use(async (c, next) => (c.req.method === 'GET' ? next() : writes(c, next)));
    return a;
  };
  const teams = area();
  const templates = area();
  const results = area();

  teams.get('/', (c) => {
    const s = sport.safeParse(c.req.query('sport') ?? 'basketball');
    if (!s.success) throw ApiError.badRequest('InvalidRequest', 'Unknown sport.');
    const teams = registry.search(s.data, c.req.query('q') ?? '', {
      level: c.req.query('level'),
      gender: c.req.query('gender'),
      state: c.req.query('state'),
    });
    return c.json({ teams });
  });
  teams.post('/', async (c) => {
    const result = registry.upsertTeam(await body(c, schemas.team), c.get('user').id);
    return c.json(result, result.created ? 201 : 200);
  });
  teams.get('/:id', (c) => {
    const team = registry.get(c.req.param('id'));
    return c.json({ team, templates: registry.templatesFor(team.id) });
  });
  teams.post('/:id/aliases', async (c) => c.json({ team: registry.addAlias(c.req.param('id'), (await body(c, schemas.alias)).alias) }));
  teams.post('/:id/merge', async (c) =>
    c.json(registry.voteMerge(c.req.param('id'), (await body(c, schemas.merge)).intoId, c.get('user').id)),
  );
  teams.get('/:id/results', (c) => {
    const season = c.req.query('season') || seasonFor(null);
    const results = registry.teamResults(c.req.param('id'), season);
    const id = registry.get(c.req.param('id')).id;
    const [row] = registry.standings([id], results);
    return c.json({ season, record: { w: row.w, l: row.l, pf: row.pf, pa: row.pa, disputed: row.disputed }, results });
  });
  teams.get('/:id/templates', (c) => c.json({ templates: registry.templatesFor(c.req.param('id')) }));
  teams.post('/:id/templates', async (c) => {
    registry.useTemplate(c.req.param('id'), (await body(c, schemas.templateRef)).templateId, c.get('user').id);
    return c.body(null, 204);
  });

  templates.post('/', async (c) => {
    const { layout, droppedAnchors } = sanitizeLayout(await c.req.json().catch(() => undefined));
    const t = registry.addTemplate(layout.sport, layout.name, layout, c.get('user').id);
    return c.json({ ...t, droppedAnchors }, 201);
  });
  templates.get('/:id', (c) => c.json({ template: registry.template(c.req.param('id')) }));

  results.post('/', async (c) => c.json({ result: registry.report(await body(c, schemas.result), c.get('user').id) }));
  results.get('/:id', (c) => {
    const r = registry.result(c.req.param('id'));
    if (!r) throw ApiError.notFound('Result');
    return c.json({ result: r });
  });
  /** Withdraws the caller's own report; the result goes when nobody reports it. */
  results.delete('/:id', (c) => {
    registry.retract(c.req.param('id'), c.get('user').id);
    return c.body(null, 204);
  });
  v1.route('/teams', teams);
  v1.route('/templates', templates);
  v1.route('/results', results);

  // ---------------------------------------------------------------- legacy key spaces

  // Routes directly on v1 (no `use`), so nothing here touches the signed-in areas.
  const legacySpace = (c: C) => {
    const token = bearer(c);
    const space = token && !looksLikeJwt(token) ? spaceFor(keys, `Bearer ${token}`) : null;
    if (!space) throw ApiError.unauthorized('Missing or invalid API key');
    return space;
  };
  v1.get('/space', (c) => c.json({ space: legacySpace(c) }));
  gamesRoutes(v1, '', legacySpace);

  app.route('/v1', v1);

  app.notFound((c) => c.json({ code: 'NotFound', error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ code: err.code, error: err.message }, err.status);
    console.error(err);
    return c.json({ code: 'Internal', error: 'Internal error' }, 500);
  });

  return app;
}
