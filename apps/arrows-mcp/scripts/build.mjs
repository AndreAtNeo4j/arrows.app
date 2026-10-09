import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const R = (p) => resolve(repo, p);

const alias = {
  '@neo4j-arrows/graphics': R('libs/graphics/src/index.ts'),
  '@neo4j-arrows/model': R('libs/model/src/index.ts'),
  '@arrows-code/format-json': R('arrows-code/libs/format-json/src/index.ts'),
  'engine/patch': R('arrows-code/apps/vscode-arrows/src/patch/apply.ts'),
  'engine/patch-types': R('arrows-code/apps/vscode-arrows/src/patch/types.ts'),
  'engine/validator': R('arrows-code/apps/vscode-arrows/src/validator/index.ts'),
  'engine/layout': R('arrows-code/apps/vscode-arrows/src/layout/index.ts'),
  'engine/cypher': R('apps/arrows-ts/src/storage/exportCypher.js'),
  'engine/graphql': R('apps/arrows-ts/src/graphql/exportGraphQL.js'),
};

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  alias,
  external: ['@modelcontextprotocol/sdk', '@napi-rs/canvas', 'jsdom'],
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  define: {
    __VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version),
  },
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: [resolve(here, '../src/server.ts')],
  outfile: resolve(here, '../dist/server.cjs'),
  banner: { js: '#!/usr/bin/env node' },
});
await build({ ...shared, entryPoints: [resolve(here, '../src/test.ts')], outfile: resolve(here, '../dist/test.cjs') });
