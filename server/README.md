# Brume sync API

Optional backup and sync for the Brume app. A single Node service (Hono) that stores games in SQLite on a mounted volume. The app works fully offline without it; when configured, it pushes local changes and pulls everything newer. Conflicts resolve last-writer-wins on each game's `updatedAt`.

The basketball types, validation and season math come from `packages/basketball`, shared with the app, and are bundled into the server at build time.

## Run locally

```sh
cd server
npm install
BRUME_API_KEYS="eagles:$(openssl rand -hex 32)" npm run dev   # http://localhost:8787
npm test
```

Or with Docker, built from the **repo root** so the shared packages are in the build context:

```sh
docker build -f server/Dockerfile -t brume-api .
docker run -p 8787:8787 -v brume-data:/data -e BRUME_API_KEYS="eagles:<key>" brume-api
```

## Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick this repo.
2. In the service's **Variables**, set:

   | Variable | Value |
   | --- | --- |
   | `RAILWAY_DOCKERFILE_PATH` | `server/Dockerfile` |
   | `BRUME_API_KEYS` | `eagles:<64 hex chars>` (comma-separate more spaces) |

   Generate each key with `openssl rand -hex 32`. Each key unlocks one *space* (a team or league); spaces can't see each other's games.
3. **Settings → Volumes → Add volume**, mount path `/data`. The server finds it through `RAILWAY_VOLUME_MOUNT_PATH`.
4. **Settings → Deploy → Healthcheck path**: `/health`.
5. **Settings → Networking → Generate domain**. That URL plus the key go into the app under **Sync**.
6. Optional: **Settings → Build → Watch paths**: `server/**`, `packages/**`, so app-only commits don't redeploy the API.
7. **Backups tab**: turn on a daily schedule. Railway snapshots the whole volume, and SQLite's WAL mode makes those snapshots safe to restore.

Railway notes:
- A service with a volume runs **one replica**, and each redeploy has a few seconds of downtime. That's fine here; the app retries on the next sync.
- The container runs as root because Railway mounts volumes as root.
- Railway supplies `PORT`; the server listens on `::` (IPv4 and IPv6).

## API

All `/v1` routes need `Authorization: Bearer <key>`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | No auth. `{ ok, version }` |
| GET | `/v1/me` | Which space this key belongs to |
| GET | `/v1/games?since=<seq>&limit=<n>` | Change feed, oldest first: `{ changes, cursor, more }`. Deletes appear as `{ deleted: true, game: null }` |
| GET | `/v1/games/:id` | One game plus its cross-check `issues` |
| PUT | `/v1/games/:id` | Create or update. `409` with `current` if the server has a newer `updatedAt` |
| DELETE | `/v1/games/:id?deletedAt=<ms>` | Leaves a tombstone so other devices learn about the delete |
| GET | `/v1/games/:id/export?format=csv\|json` | Box score export |
| GET | `/v1/seasons` | Seasons with game counts |
| GET | `/v1/seasons/:season/stats?team=&format=csv` | Season totals per player |

Page photos never leave the phone; the server strips their file paths on upload.
