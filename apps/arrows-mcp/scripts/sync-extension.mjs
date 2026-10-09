import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { buildManifest, serverRpc } from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const installed = resolve(
  homedir(),
  'Library/Application Support/Claude/Claude Extensions/local.mcpb.neo4j-labs.arrows',
);

if (!existsSync(installed)) {
  throw new Error(`extension not installed yet - run \`npm run pack\` and open dist/arrows.mcpb once:\n  ${installed}`);
}
if (!existsSync(resolve(app, 'dist/server.cjs'))) {
  throw new Error('dist/server.cjs missing - run `npm run build` first');
}

// The installed extension is an unpacked copy of the bundle, so refreshing these files
// updates it in place; only a dependency change requires a repack + reinstall.
const wanted = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8')).dependencies;
const current = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8')).dependencies;
if (JSON.stringify(wanted) !== JSON.stringify(current)) {
  throw new Error('dependencies changed - run `npm run pack` and reinstall dist/arrows.mcpb instead');
}

copyFileSync(resolve(app, 'dist/server.cjs'), resolve(installed, 'server.cjs'));
copyFileSync(resolve(app, 'media/icon.png'), resolve(installed, 'icon.png'));
copyFileSync(resolve(app, 'README.md'), resolve(installed, 'README.md'));
writeFileSync(
  resolve(installed, 'manifest.json'),
  JSON.stringify(buildManifest(resolve(app, 'dist')), null, 2) + '\n',
);

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sync', version: '1' } },
};
const info = serverRpc(installed, [init]).find((r) => r.id === 1)?.result?.serverInfo;
if (info?.name !== 'arrows') throw new Error('installed copy failed to start');

console.log(`synced -> ${info.title} v${info.version}, ${info.icons?.length ?? 0} icon(s)`);
console.log('restart Claude Desktop (or toggle the extension off/on in Settings) to pick it up');
