import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildManifest, serverRpc } from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const stage = resolve(app, 'dist/extension');
const bundle = resolve(app, 'dist/arrows.mcpb');
const pkg = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8'));

if (!existsSync(resolve(app, 'dist/server.cjs'))) {
  throw new Error('dist/server.cjs missing - run `npm run build` first');
}

const manifest = buildManifest(resolve(app, 'dist'));

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

writeFileSync(resolve(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
cpSync(resolve(app, 'media/icon.png'), resolve(stage, 'icon.png'));
cpSync(resolve(app, 'dist/server.cjs'), resolve(stage, 'server.cjs'));
cpSync(resolve(app, 'README.md'), resolve(stage, 'README.md'));

// Production-only dependency closure, resolved by npm rather than copied from the dev tree.
// Native canvas ships per-platform optional deps, so optional deps must be installed.
writeFileSync(
  resolve(stage, 'package.json'),
  JSON.stringify(
    { name: 'arrows-mcp-extension', version: pkg.version, private: true, dependencies: pkg.dependencies },
    null,
    2,
  ) + '\n',
);
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
  cwd: stage,
  stdio: 'inherit',
});

rmSync(bundle, { force: true });
execFileSync('zip', ['-qry', bundle, '.'], { cwd: stage });

// The bundle is only real if it runs from its own dependencies with no ambient environment,
// AND can rasterize - that is the call that loads the bundled native Skia binary.
const graph = {
  nodes: [{ id: 'n0', caption: 'A', labels: ['L'], properties: {}, position: { x: 0, y: 0 }, style: {} }],
  relationships: [],
  style: {},
};
const verify = serverRpc(stage, [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack-verify', version: '1' } },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'arrows_render', arguments: { graph } } },
]);
const info = verify.find((r) => r.id === 1)?.result?.serverInfo;
if (info?.name !== 'arrows' || !info?.icons?.length) {
  throw new Error(`bundle failed standalone handshake: ${JSON.stringify(verify).slice(0, 300)}`);
}
const image = verify.find((r) => r.id === 2)?.result?.content?.find((c) => c.type === 'image');
if (!image || Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  throw new Error('bundle could not rasterize a PNG - the native canvas binary did not load');
}

const size = execFileSync('du', ['-h', bundle], { encoding: 'utf8' }).split('\t')[0].trim();
console.log(`packed ${bundle} (${size}) - verified standalone: ${info.title}, ${info.icons.length} icon(s), ${manifest.tools.length} tools`);
