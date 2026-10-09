import { execFileSync } from 'node:child_process';
/** Ask a built server what it serves, so the manifest can never drift from the code. */
export function serverRpc(serverDir, requests) {
  const out = execFileSync('/usr/bin/env', ['-i', process.execPath, 'server.cjs'], {
    cwd: serverDir,
    input: requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l));
}

export function readServer(serverDir) {
  const replies = serverRpc(serverDir, [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack', version: '1' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  const serverInfo = replies.find((r) => r.id === 1)?.result?.serverInfo;
  const tools = replies.find((r) => r.id === 2)?.result?.tools;
  if (!serverInfo || !tools?.length) {
    throw new Error(`could not read tools from the built server: ${JSON.stringify(replies).slice(0, 300)}`);
  }
  return { serverInfo, tools };
}

export function buildManifest(serverDir) {
  const { serverInfo, tools } = readServer(serverDir);
  return {
    manifest_version: '0.3',
    name: 'arrows',
    display_name: 'Neo4j Arrows',
    version: serverInfo.version,
    description: 'Create, edit, render, review and export Neo4j arrows.app graph models.',
    long_description:
      'Design Neo4j graph data models in conversation. Build a model from a description, edit it, ' +
      'auto-arrange it, review it for structural problems, see it rendered inline, and export it as ' +
      'Cypher (property-type constraints for a schema model, or instance data), Neo4j GraphQL type ' +
      'definitions, SVG, canonical .arrows JSON, or an arrows.app share link. Uses the same rendering ' +
      'and export engine as arrows.app itself.',
    icon: 'icon.png',
    author: { name: 'Neo4j Labs', url: 'https://arrows.app' },
    homepage: 'https://arrows.app',
    repository: { type: 'git', url: 'https://github.com/neo4j-labs/arrows.app' },
    documentation: 'https://github.com/neo4j-labs/arrows.app/tree/main/apps/arrows-mcp#readme',
    support: 'https://github.com/neo4j-labs/arrows.app/issues',
    license: 'Apache-2.0',
    keywords: ['neo4j', 'graph', 'cypher', 'arrows', 'data-modeling', 'graphql'],
    server: {
      type: 'node',
      entry_point: 'server.cjs',
      mcp_config: { command: 'node', args: ['${__dirname}/server.cjs'], env: {} },
    },
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
    // The bundled Skia canvas is a prebuilt native binary, so the bundle only supports the
    // platform it was packed on; repack on a target platform to publish for it.
    compatibility: {
      claude_desktop: '>=0.10.0',
      platforms: [process.platform],
      runtimes: { node: '>=20.0.0' },
    },
  };
}

