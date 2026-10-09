import assert from 'node:assert';
import { parse } from 'graphql';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(here, '../dist/server.cjs');

const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(transport);

const parseGraph = (res) => {
  const block = res.content.find((c) => c.type === 'text' && c.text.includes('```arrows-json'));
  assert.ok(block, 'response carries arrows-json');
  const json = block.text.replace(/```arrows-json\n/, '').replace(/\n```$/, '');
  return JSON.parse(json);
};
const hasImage = (res) => res.content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 100);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
assert.deepEqual(names, ['arrows_build', 'arrows_edit', 'arrows_export', 'arrows_layout', 'arrows_render', 'arrows_validate']);
console.log('tools:', names.join(', '));
const buildSchema = tools.tools.find((t) => t.name === 'arrows_build').inputSchema;
assert.ok(buildSchema.properties.graph.properties?.nodes, 'arrows_build graph schema must show nodes to the model');
assert.ok(buildSchema.properties.graph.properties.relationships, 'arrows_build graph schema must show relationships');
for (const name of ['arrows_validate', 'arrows_render', 'arrows_export']) {
  assert.equal(tools.tools.find((t) => t.name === name).annotations?.readOnlyHint, true, `${name} must declare readOnlyHint`);
}

// Surfaced once per connection, not per tool - this is what makes the model reach for this
// server at all for a graph-modelling request, rather than only weighing it once a tool is
// already under consideration.
const instructions = client.getInstructions();
assert.ok(instructions && instructions.length > 0, 'server sent no instructions on initialize');
assert.ok(/arrows_build/.test(instructions), 'instructions do not name the entry-point tool');
assert.ok(/mermaid/i.test(instructions), 'instructions do not rule out substituting another diagramming tool');
assert.ok(/image\/svg\+xml/.test(instructions), 'instructions do not say how to actually show the diagram');
console.log('server instructions: present,', instructions.length, 'chars');

// MCP Apps (SEP-1865): Claude Desktop renders a ui:// resource inline even though it drops
// image content blocks, so every visual tool must point at the view and ship it an svg.
const UI_URI = 'ui://arrows/diagram.html';
for (const name of ['arrows_build', 'arrows_edit', 'arrows_layout', 'arrows_render']) {
  const tool = tools.tools.find((t) => t.name === name);
  assert.equal(tool._meta?.ui?.resourceUri, UI_URI, `${name} is missing _meta.ui.resourceUri`);
  assert.equal(tool._meta?.['ui/resourceUri'], UI_URI, `${name} is missing the flat ui/resourceUri form`);
  // every official MCP Apps example that ships structuredContent also declares outputSchema
  assert.equal(tool.outputSchema?.properties?.svg?.type, 'string', `${name} is missing outputSchema.svg`);
}
const uiResource = (await client.listResources()).resources.find((r) => r.uri === UI_URI);
assert.ok(uiResource, 'the ui:// view resource is not listed');
assert.equal(uiResource.mimeType, 'text/html;profile=mcp-app', `wrong view mimeType: ${uiResource.mimeType}`);
const view = (await client.readResource({ uri: UI_URI })).contents[0];
assert.ok(view.text.startsWith('<!DOCTYPE html>'), 'view is not an HTML5 document');
// the host holds the iframe hidden until initialized, and a zero height keeps it collapsed
assert.ok(view.text.includes('ui/notifications/initialized'), 'view never announces initialized - it would stay hidden');
assert.ok(view.text.includes('ui/notifications/size-changed'), 'view never reports its size - it would stay collapsed');
assert.ok(!/(src|href)="https?:/.test(view.text), 'view references an external URL, which the sandbox CSP blocks');
// the host may never send tool-result (anthropics/claude-ai-mcp#165), so the view must be able
// to accept every delivery shape and, failing all of them, fetch the render itself
assert.ok(view.text.includes('structuredContent'), 'view cannot read the primary delivery shape');
assert.ok(view.text.includes('"tools/call"'), 'view has no self-fetch fallback for the #165 host bug');
assert.ok(view.text.includes('ui/notifications/tool-input'), 'view never records the args it would need to self-fetch');
console.log('mcp apps: 4 tools wired to', UI_URI, '| view', view.text.length, 'chars');

const built = await client.callTool({
  name: 'arrows_build',
  arguments: {
    graph: {
      nodes: [
        { id: 'n0', caption: 'Person', labels: ['Person'], properties: { name: 'string' } },
        { id: 'n1', caption: 'Movie', labels: ['Movie'], properties: { title: 'string', released: 'integer' } },
      ],
      relationships: [{ fromId: 'n0', toId: 'n1', type: 'ACTED_IN', properties: { roles: 'string' } }],
    },
  },
});
assert.ok(hasImage(built), 'build returns inline image');
assert.ok(typeof built.structuredContent?.svg === 'string' && built.structuredContent.svg.startsWith('<svg'), 'build must ship the svg the inline view paints');

// A client that cannot mount the ui:// app can only show the diagram by re-emitting the markup,
// so the svg has to be readable as text, not just as structuredContent.
const svgBlock = built.content.find((c) => c.type === 'text' && c.text.startsWith('<svg'));
assert.ok(svgBlock, 'build must expose the svg as a text block for the artifact fallback');
assert.equal(svgBlock.text, built.structuredContent.svg, 'the svg text block and structuredContent must be the same markup');
// Unfenced on purpose: a code fence renders as visible ``` lines around the diagram.
assert.ok(!built.content.some((c) => c.type === 'text' && c.text.includes('```svg')), 'the svg is wrapped in a code fence again');
// Minified: full-precision floats are gone, but inherited attributes that merely look like
// defaults are not - an explicit text-anchor="start" overrides an ancestor's "middle"/"end".
// Scoped to tags, since a caption is free to contain a long decimal of its own.
const attrsOnly = (svg) => svg.replace(/>[^<]*</g, '><');
assert.ok(!/="[^"]*\d\.\d{4}/.test(attrsOnly(built.structuredContent.svg)), 'svg still carries full-precision floats');
assert.ok(/text-anchor="start"/.test(built.structuredContent.svg), 'minifier stripped an inherited text-anchor, which changes where text sits');

let graph = parseGraph(built);
assert.equal(graph.nodes.length, 2);
// the link embeds the whole graph, so build must not spend thousands of characters on it
assert.ok(!JSON.stringify(built).includes('import/json='), 'build must not include the share url by default');
const checklist = built.content.find((c) => c.type === 'text' && c.text.includes('It contains:'));
assert.ok(checklist, 'build returns a verification checklist');
// The svg block is only useful if the caller is told to re-emit it instead of drawing its own.
assert.ok(/copy the <svg> markup above into an image\/svg\+xml artifact/.test(checklist.text), 'checklist does not tell the caller how to show the diagram');
assert.ok(/substitute mermaid/.test(checklist.text), 'checklist does not rule out substituting another diagram tool');
assert.ok(checklist.text.includes('Person') && checklist.text.includes('Movie'), `checklist missing captions: ${checklist.text}`);
assert.ok(checklist.text.includes('ACTED_IN'), `checklist missing relationship type: ${checklist.text}`);
console.log('build: ok (image + json + checklist, no url)');

const edited = await client.callTool({
  name: 'arrows_edit',
  arguments: { graph, ops: [
    { op: 'insert', path: '/nodes/-', value: { id: 'n2', caption: 'Genre', labels: ['Genre'], properties: { name: 'string' } } },
    { op: 'insert', path: '/relationships/-', value: { id: 'r1', fromId: 'n1', toId: 'n2', type: 'IN_GENRE' } },
  ] },
});
assert.equal(edited.isError ?? false, false, 'edit no error');
graph = parseGraph(edited);
assert.equal(graph.nodes.length, 3, 'node added via edit');
assert.ok(hasImage(edited), 'edit returns image');
console.log('edit: ok (3 nodes now)');

const editErr = await client.callTool({ name: 'arrows_edit', arguments: { graph, ops: [{ op: 'insert', path: '/relationships/-', value: { fromId: 'ghost', toId: 'n0', type: 'X' } }] } });
assert.equal(editErr.isError, true, 'dangling edit flagged isError');
console.log('edit error path: ok (isError=true)');

// a wrong-typed field is rejected with a clear message, but a good op in the same batch still applies
const badField = await client.callTool({
  name: 'arrows_edit',
  arguments: { graph, ops: [{ op: 'set', path: '/nodes/n0/caption', value: 'Renamed' }, { op: 'set', path: '/nodes/n1/position/x', value: 'not-a-number' }] },
});
assert.equal(badField.isError ?? false, false, 'a batch where some ops applied is not an error');
const badFieldText = badField.content.find((c) => c.type === 'text' && c.text.startsWith('Some ops failed:'));
assert.ok(/op 1 .*position\/x must be a finite number/.test(badFieldText?.text ?? ''), `no clear message for the bad op: ${badFieldText?.text}`);
assert.equal(parseGraph(badField).nodes.find((n) => n.id === 'n0').caption, 'Renamed', 'the good op in the same batch did not apply');
console.log('edit validation: ok (bad field named, good op in the same batch still applied)');

// a structural diagnostic must surface a location, not just severity/code/message
const dupIdGraph = { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[0] }] };
const dupVal = await client.callTool({ name: 'arrows_validate', arguments: { graph: dupIdGraph } });
assert.ok(/\(.*n0.*\)/.test(dupVal.content[0].text), `duplicate-id diagnostic has no location: ${dupVal.content[0].text}`);
console.log('validate: ok (structural diagnostic includes a location)');

const val = await client.callTool({ name: 'arrows_validate', arguments: { graph } });
assert.ok(val.content[0].type === 'text', 'validate text');
console.log('validate:', val.content[0].text.slice(0, 60).replace(/\n/g, ' '));

for (const algorithm of ['force', 'hierarchical', 'radial', 'circular', 'grid']) {
  const laid = await client.callTool({ name: 'arrows_layout', arguments: { graph, layout: algorithm } });
  assert.ok(hasImage(laid), `layout ${algorithm} image`);
  assert.equal(parseGraph(laid).nodes.length, 3, `layout ${algorithm} preserves nodes`);
}
// zod strips an unknown key silently, so a misnamed param yields the auto-picked layout with no
// error - which is why this one must keep the same name arrows_build uses.
const layoutParam = tools.tools.find((t) => t.name === 'arrows_layout').inputSchema.properties;
assert.ok(layoutParam.layout, 'arrows_layout must name its param `layout`, as arrows_build does');
assert.ok(!layoutParam.algorithm, 'two names for one concept: a caller using the other one is silently ignored');

// layout is optional so an edited graph can be re-arranged without a blind guess
const autoLaid = await client.callTool({ name: 'arrows_layout', arguments: { graph } });
assert.equal(autoLaid.isError ?? false, false, 'layout without an algorithm errored');
assert.ok(hasImage(autoLaid), 'auto layout returns an image');
assert.match(autoLaid.content[0].text, /Applied \w+ layout/, `auto layout does not name what it picked: ${autoLaid.content[0].text}`);
assert.equal(parseGraph(autoLaid).nodes.length, 3, 'auto layout preserves nodes');
console.log('layout: all 5 + auto-pick ok');

const svg = await client.callTool({ name: 'arrows_render', arguments: { graph, format: 'svg' } });
assert.ok(svg.content[0].text.startsWith('<svg'), 'render svg');
const png = await client.callTool({ name: 'arrows_render', arguments: { graph } });
assert.ok(hasImage(png), 'render png');
// every visual tool carries the do-not-redraw guard, not just the ones that change the graph
for (const [name, res] of [['svg', svg], ['png', png]]) {
  assert.ok(
    res.content.some((c) => c.type === 'text' && c.text.includes('It contains:')),
    `arrows_render format ${name} returns no verification checklist`,
  );
}
assert.ok(png.content.some((c) => c.type === 'text' && c.text.startsWith('<svg')), 'render png omits the svg needed to show it in chat');
// a transparent render must actually differ, and must not smuggle the backdrop back in
const clear = await client.callTool({ name: 'arrows_render', arguments: { graph, format: 'svg', background: 'transparent' } });
assert.ok(clear.content[0].text.startsWith('<svg'), 'transparent render svg');
assert.notEqual(clear.content[0].text, svg.content[0].text, 'background=transparent changed nothing');
console.log('render: svg + png + checklist + transparent ok');

const exportOf = async (g, format, extra = {}) =>
  (await client.callTool({ name: 'arrows_export', arguments: { graph: g, format, ...extra } })).content[0].text;

// this graph's property values are type names, so cypher must be schema DDL, never literal data
const schemaCypher = await exportOf(graph, 'cypher');
assert.ok(/CREATE CONSTRAINT/.test(schemaCypher), `expected constraints: ${schemaCypher.slice(0, 120)}`);
assert.ok(/IS :: (STRING|INTEGER|FLOAT)/.test(schemaCypher), `expected a type constraint: ${schemaCypher.slice(0, 120)}`);
assert.ok(!/\{\s*\w+:\s*"string"/.test(schemaCypher), `type name stored as data: ${schemaCypher.slice(0, 120)}`);

const dataCypher = await exportOf(graph, 'cypher', { cypherStyle: 'data' });
assert.ok(!/CREATE CONSTRAINT/.test(dataCypher), 'style=data must not emit constraints');
assert.ok(/CREATE \(/.test(dataCypher), `expected a literal CREATE: ${dataCypher.slice(0, 120)}`);

const sdl = await exportOf(graph, 'graphql');
parse(sdl);
assert.ok(!/:\s*(string|integer|float)\b/.test(sdl), `raw type names leaked into SDL: ${sdl.slice(0, 160)}`);

assert.ok((await exportOf(graph, 'svg')).startsWith('<svg'), 'svg export');
assert.ok((await exportOf(graph, 'json')).trim().startsWith('{'), 'json export');
const urlExport = await exportOf(graph, 'url');
assert.ok(/^\[Open in arrows\.app\]\(https:\/\/arrows\.app\S+\)/.test(urlExport), `url export is not a markdown link: ${urlExport.slice(0, 60)}`);
assert.ok(/embeds the entire graph/.test(urlExport), 'url export is missing its info message');
assert.ok(!/import\/json=[^)]*\n/.test(urlExport), 'url payload is not minified');
console.log('export: schema cypher + data cypher + graphql(parsed) + svg/json/url ok');

// G4: identical arguments must give identical output, and two graphs must not bleed together
const args = { graph: { nodes: [{ caption: 'X', labels: ['X'], properties: { a: 'string' } }] }, layout: 'grid' };
const first = parseGraph(await client.callTool({ name: 'arrows_build', arguments: args }));
const second = parseGraph(await client.callTool({ name: 'arrows_build', arguments: args }));
assert.deepEqual(second, first, 'identical arguments produced different output');
const other = { graph: { nodes: [{ caption: 'Y', labels: ['Y'], properties: { b: 'integer' } }] }, layout: 'grid' };
parseGraph(await client.callTool({ name: 'arrows_build', arguments: other }));
const third = parseGraph(await client.callTool({ name: 'arrows_build', arguments: args }));
assert.deepEqual(third, first, 'a prior call leaked into a later one');
console.log('G4 stateless: repeat + interleaved calls identical');

// The backdrop rect is the one attribute built by string concatenation instead of the DOM, and
// background-color is caller-controlled via setStyle {id:null} or a hand-written graph.
const hostile = {
  nodes: [{ id: 'a', position: { x: 0, y: 0 }, caption: 'A', labels: [], properties: {}, style: {} }],
  relationships: [],
  style: { 'background-color': 'red"/><script>alert(1)</script><rect fill="' },
};
const injected = await client.callTool({ name: 'arrows_render', arguments: { graph: hostile, format: 'svg' } });
const injectedSvg = injected.content[0].text;
assert.ok(!injectedSvg.includes('<script>'), `markup injected through background-color: ${injectedSvg.slice(0, 200)}`);
assert.ok(injectedSvg.includes('&lt;script&gt;') || injectedSvg.includes('&quot;'), 'the hostile value was neither escaped nor rejected');

// a style colour that is not a string must not crash the transparent path
for (const bad of [true, 42, { a: 1 }, ['x'], '']) {
  const res = await client.callTool({
    name: 'arrows_render',
    arguments: { graph: { ...hostile, style: { 'background-color': bad } }, format: 'svg', background: 'transparent' },
  });
  assert.equal(res.isError ?? false, false, `background-color ${JSON.stringify(bad)} broke the transparent render: ${res.content[0]?.text}`);
}

// a wrong-typed nodes/relationships must not crash the checklist
for (const shape of [{ nodes: { not: 'an array' }, relationships: [] }, { nodes: [], relationships: 'nope' }, {}]) {
  const res = await client.callTool({ name: 'arrows_render', arguments: { graph: shape, format: 'svg' } });
  assert.equal(res.isError ?? false, false, `graph shape ${JSON.stringify(shape)} crashed arrows_render: ${res.content[0]?.text}`);
}
console.log('hostile input: injection escaped, non-string colours and wrong-typed arrays survive');

// The session handle is the point of the redesign: an edit should not need the graph re-sent.
const handle = /id: (g\d+)/.exec(built.content[0].text)?.[1];
assert.ok(handle, `build did not report a session id: ${built.content[0].text}`);
const byId = await client.callTool({ name: 'arrows_edit', arguments: { id: handle, ops: [{ op: 'set', path: '/nodes/n0/caption', value: 'Human' }] } });
assert.equal(byId.isError ?? false, false, `editing by id failed: ${JSON.stringify(byId.content).slice(0, 200)}`);
assert.ok(parseGraph(byId).nodes.some((n) => n.caption === 'Human'), 'the edit by id did not apply');
const stale = await client.callTool({ name: 'arrows_edit', arguments: { id: 'g999', ops: [{ op: 'set', path: '/nodes/n0/caption', value: 'X' }] } });
assert.equal(stale.isError, true, 'an unknown id should error');
assert.ok(/Pass the full graph as `graph` instead/.test(JSON.stringify(stale.content)), `unhelpful stale-id message: ${JSON.stringify(stale.content).slice(0, 200)}`);
const neither = await client.callTool({ name: 'arrows_render', arguments: { format: 'svg' } });
assert.equal(neither.isError, true, 'a call with neither id nor graph should error');
// two graphs in one session must not bleed together
const soloBuild = await client.callTool({ name: 'arrows_build', arguments: { graph: { nodes: [{ caption: 'Solo' }] }, layout: 'grid' } });
const otherId = /id: (g\d+)/.exec(soloBuild.content[0].text)[1];
assert.notEqual(otherId, handle, 'a second build reused the first handle');
const back = await client.callTool({ name: 'arrows_render', arguments: { id: handle, format: 'svg' } });
assert.ok(!back.content[0].text.includes('>Solo<'), 'the second graph leaked into the first handle');
console.log('session: id round-trip, stale id, missing args, no cross-talk');

// build() must not accept two nodes with the same id - the second becomes unaddressable by id
const dupIds = await client.callTool({ name: 'arrows_build', arguments: { graph: {
  nodes: [{ id: 'x', caption: 'A' }, { id: 'x', caption: 'B' }],
} } });
const dupGraph = parseGraph(dupIds);
assert.equal(dupGraph.nodes.length, 2, 'a duplicate-id node was dropped instead of renamed');
assert.equal(new Set(dupGraph.nodes.map((n) => n.id)).size, 2, 'two nodes still share an id after build');

// a non-string properties/style value must not corrupt the map via object spread
const badShape = await client.callTool({ name: 'arrows_build', arguments: { graph: {
  nodes: [{ id: 'a', caption: 'A', properties: 'oops' }, { id: 'b', caption: 'B', style: ['not', 'a', 'map'] }],
} } });
const badGraph = parseGraph(badShape);
const nodeA = badGraph.nodes.find((n) => n.id === 'a');
assert.deepEqual(nodeA.properties, {}, `a non-object properties value corrupted the node: ${JSON.stringify(nodeA.properties)}`);
assert.ok(/properties ignored/.test(JSON.stringify(badShape.content)), 'no warning for the dropped properties value');

// insert must reject the same bad shapes an edit "set" would, not merge them unfiltered
const built2 = await client.callTool({ name: 'arrows_build', arguments: { graph: { nodes: [{ id: 'a', caption: 'A' }] } } });
const insertBad = await client.callTool({ name: 'arrows_edit', arguments: {
  graph: parseGraph(built2),
  ops: [{ op: 'insert', path: '/nodes/-', value: { caption: 'B', properties: 'oops' } }],
} });
assert.equal(insertBad.isError, true, 'insert accepted a non-object properties value');

// a numeric path segment that matches no id must not silently edit array position instead
const numericPath = await client.callTool({ name: 'arrows_edit', arguments: {
  graph: parseGraph(built2),
  ops: [{ op: 'set', path: '/nodes/0/caption', value: 'Hijacked' }],
} });
assert.equal(numericPath.isError, true, 'a bare array index was accepted as a node address');
assert.ok(!JSON.stringify(numericPath.content).includes('Hijacked'), 'a numeric path silently renamed a node by position');

// a non-finite position on insert is treated the same as no position: auto-placed, not stored -
// there is no "auto place me" sentinel otherwise, so this must not require an error round-trip
const nonFinite = await client.callTool({ name: 'arrows_edit', arguments: {
  graph: parseGraph(built2),
  ops: [{ op: 'insert', path: '/nodes/-', value: { caption: 'B', position: { x: Infinity, y: NaN } } }],
} });
assert.equal(nonFinite.isError ?? false, false, 'insert with a non-finite position should auto-place, not error');
const placed = parseGraph(nonFinite).nodes.find((n) => n.caption === 'B');
assert.ok(Number.isFinite(placed.position.x) && Number.isFinite(placed.position.y), 'a non-finite position was stored instead of auto-placed');

// but setting an EXISTING node's position to non-finite has no such fallback and must be rejected
const nonFiniteSet = await client.callTool({ name: 'arrows_edit', arguments: {
  graph: parseGraph(built2),
  ops: [{ op: 'set', path: '/nodes/a/position', value: { x: Infinity, y: 0 } }],
} });
assert.equal(nonFiniteSet.isError, true, 'setting an existing position to a non-finite value was accepted');

// a batch larger than the cap must be rejected outright, not processed synchronously - zod may
// reject it at the protocol layer (a thrown call) rather than as an isError result, either is fine
const tooManyOps = Array.from({ length: 201 }, () => ({ op: 'set', path: '/nodes/a/caption', value: 'x' }));
let cappedRejected = false;
try {
  const capped = await client.callTool({ name: 'arrows_edit', arguments: { graph: parseGraph(built2), ops: tooManyOps } });
  cappedRejected = capped.isError === true;
} catch {
  cappedRejected = true;
}
assert.ok(cappedRejected, 'an oversized op batch was not rejected');
console.log('hardening: duplicate ids renamed, malformed properties rejected everywhere, no positional addressing, op batch capped');

// caption length must be bounded everywhere it can be set - an uncapped caption previously fed a
// superlinear-cost word-wrap layout search (~27s for one 800-char caption); confirmed dead by timing.
const captionDosT0 = Date.now();
const captionDos = await client.callTool({ name: 'arrows_build', arguments: { graph: { nodes: [{ caption: 'x'.repeat(5000) }] } } });
const captionDosMs = Date.now() - captionDosT0;
assert.equal(captionDos.isError ?? false, false, 'an oversized caption was rejected outright instead of truncated');
assert.ok(captionDosMs < 5000, `a 5000-char caption took ${captionDosMs}ms - the render-cost guard did not engage`);
const captionDosGraph = parseGraph(captionDos);
assert.ok(captionDosGraph.nodes[0].caption.length <= 120, `caption was not truncated: ${captionDosGraph.nodes[0].caption.length} chars`);
const captionEditReject = await client.callTool({ name: 'arrows_edit', arguments: {
  graph: captionDosGraph,
  ops: [{ op: 'insert', path: '/nodes/-', value: { caption: 'y'.repeat(5000) } }],
} });
assert.equal(captionEditReject.isError, true, 'edit accepted an oversized caption via insert');
console.log(`caption cap: build truncates (${captionDosMs}ms for 5000 chars), edit rejects`);

// Regression for a real live session: a model that builds with captions only (no labels, no
// properties - the natural first thing to try) got a content-free `CREATE ()-[:X]->()` out of
// cypher export, and GraphQL export refused outright. Both now fall back to the caption.
const captionOnly = await client.callTool({ name: 'arrows_build', arguments: { graph: {
  nodes: [{ caption: 'Customer' }, { caption: 'Order' }],
  relationships: [{ fromId: 'n0', toId: 'n1', type: 'PLACES' }],
} } });
const captionOnlyId = /id: (g\d+)/.exec(captionOnly.content[0].text)[1];
const captionOnlyCypher = await client.callTool({ name: 'arrows_export', arguments: { id: captionOnlyId, format: 'cypher', cypherStyle: 'data' } });
assert.ok(captionOnlyCypher.content[0].text.includes('(:Customer)'), `caption-only cypher export lost node identity: ${captionOnlyCypher.content[0].text}`);
console.log('caption-only export fallback: cypher identifies nodes by caption when no label is set');

await client.close();
console.log('\nE2E PASS');
