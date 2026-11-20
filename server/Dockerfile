# Brume sync API. Build from the REPO ROOT so the shared packages are in context:
#   docker build -f server/Dockerfile -t brume-api .
# On Railway, set the service variable RAILWAY_DOCKERFILE_PATH=server/Dockerfile.

# --- toolchain: better-sqlite3 compiles its native addon at install time ---
FROM node:24-bookworm-slim AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# --- build: install dev deps, run tests, bundle server + shared packages ---
FROM toolchain AS build
WORKDIR /repo
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY packages/ocr-engine/package.json packages/ocr-engine/
COPY packages/ocr-engine/src packages/ocr-engine/src
COPY packages/basketball/package.json packages/basketball/
COPY packages/basketball/src packages/basketball/src
COPY server/ server/
RUN cd server && npm test && npm run build

# --- deps: production node_modules only (better-sqlite3 and its native binary) ---
FROM toolchain AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# --- runtime ---
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /repo/server/dist ./dist
COPY server/package.json ./
# Railway mounts volumes as root, so the process runs as root to write the database.
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
