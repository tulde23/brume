// Bundle the server and the shared @inkstat packages into one file.
// better-sqlite3 stays external because it ships a native binary.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here('./src/index.ts')],
  outfile: here('./dist/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['better-sqlite3'],
  alias: {
    '@inkstat/basketball': here('../packages/basketball/src/index.ts'),
    '@inkstat/ocr-engine': here('../packages/ocr-engine/src/index.ts'),
    '@inkstat/track': here('../packages/track/src/index.ts'),
  },
  logLevel: 'info',
});
