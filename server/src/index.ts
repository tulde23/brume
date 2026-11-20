import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { createApp } from './app';
import { parseKeys } from './auth';
import { createStore, openDb } from './db';

// On Railway the volume's mount path is provided; locally it falls back to ./data.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? process.env.DATA_DIR ?? './data';
const port = Number(process.env.PORT ?? 8787);

const keys = parseKeys(process.env.INKSTAT_API_KEYS);
if (keys.size === 0) {
  console.error('INKSTAT_API_KEYS is not set. Example: INKSTAT_API_KEYS="eagles:$(openssl rand -hex 32)"');
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'inkstat.db'));
const app = createApp({
  store: createStore(db),
  keys,
  version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
});

// "::" listens on IPv4 and IPv6, which Railway's private network needs.
const server = serve({ fetch: app.fetch, port, hostname: '::' }, (info) => {
  console.log(`inkstat api listening on :${info.port}, data in ${dataDir}, ${keys.size} space(s)`);
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
