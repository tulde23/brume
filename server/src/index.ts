import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { createApp } from './app';
import { createAccounts } from './auth/accounts';
import { createAppleClient, createProtector } from './auth/apple';
import { createIdentityVerifier } from './auth/identity';
import { parseKeys } from './auth/keys';
import { createDocs, createStore, openDb } from './db';
import { createGroups } from './groups';
import { createRegistry } from './registry';

// On Railway the volume's mount path is provided; locally it falls back to ./data.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? process.env.DATA_DIR ?? './data';
const port = Number(process.env.PORT ?? 8787);

const env = process.env;
// Legacy shared-key spaces (the first sync build); optional now that people sign in.
const keys = parseKeys(env.INKSTAT_API_KEYS);
if (!env.INKSTAT_AUTH_KEY || env.INKSTAT_AUTH_KEY.length < 32) {
  console.error('INKSTAT_AUTH_KEY is not set. Generate one: openssl rand -hex 32');
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'inkstat.db'));
const identities = createIdentityVerifier({ googleClientIds: env.GOOGLE_CLIENT_IDS, appleClientIds: env.APPLE_CLIENT_IDS });
const apple = createAppleClient({
  clientId: env.APPLE_CLIENT_IDS?.split(',')[0]?.trim(),
  teamId: env.APPLE_TEAM_ID,
  keyId: env.APPLE_KEY_ID,
  privateKey: env.APPLE_PRIVATE_KEY,
});
const accounts = createAccounts({ db, identities, apple, protector: createProtector(env.INKSTAT_DATA_KEY), signingKey: env.INKSTAT_AUTH_KEY });
const app = createApp({
  store: createStore(db),
  docs: createDocs(db),
  keys,
  accounts,
  groups: createGroups(db),
  registry: createRegistry(db),
  version: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
});
for (const p of ['Google', 'Apple'] as const) {
  if (!identities.isConfigured(p)) console.log(`Sign in with ${p} is off (no client ids).`);
}
setInterval(() => accounts.prune(), 3600_000).unref();

// "::" listens on IPv4 and IPv6, which Railway's private network needs.
const server = serve({ fetch: app.fetch, port, hostname: '::' }, (info) => {
  console.log(`inkstat api listening on :${info.port}, data in ${dataDir}, ${keys.size} legacy space(s)`);
});

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
