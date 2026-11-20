import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyTeam, type Game } from '@inkstat/basketball';

import { json, makeServer } from './helpers';

const game = (id: string, updatedAt: number): Game => ({
  id,
  date: '2026-12-01',
  location: 'Henley',
  season: '2026-27',
  home: { ...emptyTeam(), name: 'Stars', totalPoints: 50, pageUri: 'file:///phone/page.jpg' },
  away: { ...emptyTeam(), name: 'Comets', totalPoints: 46 },
  modelId: null,
  createdAt: 1,
  updatedAt,
});

const template = (id: string, updatedAt: number) => ({
  version: 3,
  sport: 'basketball',
  id,
  name: 'Stars home book',
  enabled: ['rows', 'names', 'points'],
  parts: { rows: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 }, names: { x: 0.1, w: 0.2 } },
  variants: {},
  photoUri: 'file:///phone/template.jpg',
  anchors: [{ text: 'player', x: 0.1, y: 0.18 }],
  test: null,
  createdAt: 1,
  updatedAt,
});

describe('personal sync', () => {
  it("syncs a signed-in scorekeeper's games across devices, and keeps accounts apart", async () => {
    const s = await makeServer();
    const phone = await s.signIn('dana');
    const tablet = await s.signIn('dana');
    const other = await s.signIn('miles');

    assert.equal((await s.call('PUT', '/v1/me/games/game0001', game('game0001', 10), phone.accessToken)).status, 200);
    const feed = await json(await s.call('GET', '/v1/me/games?since=0', undefined, tablet.accessToken));
    assert.equal(feed.changes.length, 1);
    assert.equal(feed.changes[0].game.home.pageUri, null, 'photo paths stay on the phone');
    assert.equal((await json(await s.call('GET', '/v1/me/games', undefined, other.accessToken))).changes.length, 0);

    // Older edit loses; delete leaves a tombstone in the feed.
    assert.equal((await s.call('PUT', '/v1/me/games/game0001', game('game0001', 5), tablet.accessToken)).status, 409);
    await s.call('DELETE', '/v1/me/games/game0001?deletedAt=20', undefined, tablet.accessToken);
    const after = await json(await s.call('GET', `/v1/me/games?since=${feed.cursor}`, undefined, phone.accessToken));
    assert.equal(after.changes[0].deleted, true);
  });

  it('syncs templates without their photo, last writer wins', async () => {
    const s = await makeServer();
    const a = await s.signIn('dana');
    const put = await s.call('PUT', '/v1/me/templates/tpl1', template('tpl1', 10), a.accessToken);
    assert.equal(put.status, 200);
    const feed = await json(await s.call('GET', '/v1/me/templates', undefined, a.accessToken));
    assert.equal(feed.changes[0].data.photoUri, null);
    assert.equal(feed.changes[0].data.anchors[0].text, 'player');
    const stale = await s.call('PUT', '/v1/me/templates/tpl1', template('tpl1', 9), a.accessToken);
    assert.equal(stale.status, 409);
    assert.equal((await json(stale)).current.updatedAt, 10);
    assert.equal((await s.call('PUT', '/v1/me/templates/tpl2', { ...template('tpl2', 1), version: 2 }, a.accessToken)).status, 400);
  });

  it("deletes the account's own synced data with the account", async () => {
    const s = await makeServer();
    const a = await s.signIn('dana');
    await s.call('PUT', '/v1/me/games/game0001', game('game0001', 10), a.accessToken);
    await s.call('PUT', '/v1/me/templates/tpl1', template('tpl1', 10), a.accessToken);
    await s.call('DELETE', '/v1/me', undefined, a.accessToken);
    const left = s.db.prepare("SELECT (SELECT COUNT(*) FROM games WHERE space LIKE 'u:%') + (SELECT COUNT(*) FROM docs) AS n").get() as { n: number };
    assert.equal(left.n, 0);
  });
});
