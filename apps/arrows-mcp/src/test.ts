import { parse } from 'graphql';
import { Base64 } from 'js-base64';
import { build, edit, layout, validate, toCypher, toGraphQL, shareUrl, normalize, LAYOUT_IDS, type PathOp, type GraphJson } from './engine';
import { chooseLayout, layoutScore } from './autoLayout';
import { verificationChecklist } from './checklist';
import { renderSvg, renderPng } from './render';

const results: string[] = [];
const check = async (name: string, fn: () => unknown | Promise<unknown>): Promise<void> => {
  try {
    await fn();
    results.push(`OK   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
};
const assert = (ok: unknown, msg: string): void => {
  if (!ok) throw new Error(msg);
};
const isPng = (b: Buffer): boolean =>
  b.length > 100 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
const node = (over: Record<string, unknown> = {}) => ({
  id: 'a', caption: 'A', labels: ['L'], properties: {}, position: { x: 0, y: 0 }, style: {}, ...over,
});
const graphOf = (...nodes: unknown[]) => ({ nodes, relationships: [], style: {} });
const empty = { nodes: [], relationships: [], style: {} };

async function main(): Promise<void> {
  const model = await build({
    nodes: [
      { id: 'n0', caption: 'Person', labels: ['Person'], properties: { name: 'string', born: 'integer' } },
      { id: 'n1', caption: 'Movie', labels: ['Movie'], properties: { title: 'string' } },
    ],
    relationships: [{ fromId: 'n0', toId: 'n1', type: 'ACTED_IN', properties: { roles: 'string' } }],
  });

  await check('build assigns ids, positions and no errors', () => {
    assert(model.errors.length === 0, model.errors.join('; '));
    assert(model.json.nodes.length === 2 && model.json.relationships.length === 1, 'wrong counts');
    const moved = model.json.nodes.some((n) => {
      const p = (n as { position: { x: number; y: number } }).position;
      return p.x !== 0 || p.y !== 0;
    });
    assert(moved, 'layout left every node at origin');
  });

  await check('G2 canonical JSON is deterministic', () => {
    const a = JSON.stringify(normalize(model.json));
    const b = JSON.stringify(normalize(model.json));
    const c = JSON.stringify(normalize(model.json));
    assert(a === b && b === c, 'unstable output');
  });

  await check('edit applies label and property', () => {
    const out = edit(model.json, [
      { op: 'insert', path: '/nodes/n0/labels/-', value: 'Employee' },
      { op: 'set', path: '/nodes/n1/properties/released', value: 'integer' },
    ]);
    assert(out.errors.length === 0, out.errors.join('; '));
    const n0 = out.json.nodes.find((n) => (n as { id: string }).id === 'n0') as { labels: string[] };
    assert(n0.labels.includes('Employee'), 'label missing');
  });

  await check('G5 dangling relationship is reported, not thrown', () => {
    const out = edit(model.json, [
      { op: 'insert', path: '/relationships/-', value: { fromId: 'ghost', toId: 'n0', type: 'X' } },
    ]);
    assert(out.errors.length > 0, 'expected an error');
  });

  await check('G5 missing-id op is reported', () => {
    assert(edit(empty, [{ op: 'set', path: '/nodes/nope/caption', value: 'X' }]).errors.length > 0, 'expected an error');
  });

  await check('G10 every layout preserves counts and data', async () => {
    const signature = (g: { nodes: unknown[]; relationships: unknown[] }) =>
      JSON.stringify([
        g.nodes.map((n) => { const { position, ...rest } = n as Record<string, unknown>; return rest; }),
        g.relationships,
      ]);
    for (const id of LAYOUT_IDS) {
      const out = await layout(model.json, id);
      assert(out.json.nodes.length === 2, `${id} lost nodes`);
      assert(signature(out.json) === signature(model.json), `${id} altered non-position data`);
    }
  });

  await check('validate returns diagnostics for a clean and an empty graph', () => {
    assert(Array.isArray(validate(model.json)), 'not an array');
    assert(Array.isArray(validate(empty)), 'empty graph not handled');
  });

  const instance = await build({
    nodes: [
      { id: 'n0', caption: 'Alice', labels: ['Person'], properties: { name: "'Alice'", born: '1979' } },
      { id: 'n1', caption: 'Matrix', labels: ['Movie'], properties: { title: "'The Matrix'" } },
    ],
    relationships: [{ fromId: 'n0', toId: 'n1', type: 'ACTED_IN', properties: { roles: "'Trinity'" } }],
  });

  await check('G8 instance data exports a literal CREATE/MATCH/MERGE', () => {
    for (const keyword of ['CREATE', 'MATCH', 'MERGE'] as const) {
      const cypher = toCypher(instance.json, keyword);
      assert(cypher.includes(keyword), `${keyword} missing`);
      const depth = [...cypher].reduce((d, ch) => d + (ch === '(' ? 1 : ch === ')' ? -1 : 0), 0);
      assert(depth === 0, `${keyword} has unbalanced parens`);
      for (const token of ['Person', 'Movie', 'ACTED_IN', 'Alice']) {
        assert(cypher.includes(token), `${keyword} is missing ${token}`);
      }
      assert(!/CREATE CONSTRAINT/.test(cypher), `${keyword} wrongly switched to schema output`);
    }
  });

  await check('G8 a schema model exports property-type constraints, not literal types', () => {
    const cypher = toCypher(model.json);
    assert(/CREATE CONSTRAINT/.test(cypher), 'no constraints emitted');
    assert(/FOR \(n:Person\) REQUIRE n\.name IS :: STRING;/.test(cypher), `missing Person.name constraint:\n${cypher}`);
    assert(/REQUIRE n\.born IS :: INTEGER;/.test(cypher), 'missing INTEGER mapping');
    assert(/\(\)-\[r:ACTED_IN\]-\(\) REQUIRE r\.roles IS :: STRING;/.test(cypher), 'missing relationship constraint');
    // the literal-value bug this replaced: a type name must never be stored as data
    assert(!/name: "string"/.test(cypher), 'still emitting the type name as a literal value');
  });

  await check('G8 explicit style overrides the auto choice', () => {
    assert(/name: "string"/.test(toCypher(model.json, 'CREATE', 'data')), 'style=data should emit literals');
    const onInstance = toCypher(instance.json, 'CREATE', 'schema');
    assert(!/CREATE CONSTRAINT/.test(onInstance), 'instance values are not types, so nothing to constrain');
  });

  await check('G9 GraphQL parses as SDL and errors on a property-less node', () => {
    const sdl = toGraphQL(model.json);
    const doc = parse(sdl);
    const types = doc.definitions
      .filter((d) => d.kind === 'ObjectTypeDefinition')
      .map((d) => (d as { name: { value: string } }).name.value);
    assert(types.includes('Person') && types.includes('Movie'), `missing types: ${types.join(',')}`);
    // parse() accepted the old broken "integer"/"string" scalars, so check the field types
    // resolve: every named type must be a real scalar or a type declared in this document.
    const SCALARS = new Set(['String','Int','Float','Boolean','ID','BigInt','DateTime','Date','LocalDateTime','Time','LocalTime','Duration','Point']);
    const declared = new Set(
      doc.definitions
        .filter((d) => d.kind.endsWith('TypeDefinition'))
        .map((d) => (d as { name: { value: string } }).name.value),
    );
    const named = (t: { kind: string; type?: unknown; name?: { value: string } }): string =>
      t.kind === 'NamedType' ? (t.name as { value: string }).value : named(t.type as never);
    for (const def of doc.definitions) {
      for (const field of ((def as { fields?: unknown[] }).fields ?? []) as { name: { value: string }; type: never }[]) {
        const type = named(field.type);
        assert(SCALARS.has(type) || declared.has(type), `field ${field.name.value} has unresolvable type "${type}"`);
      }
    }
    let threw = false;
    try {
      toGraphQL(graphOf(node({ properties: {} })));
    } catch {
      threw = true;
    }
    assert(threw, 'expected a clear error for a property-less node');
  });

  await check('G3 share URL round-trips, including + / = payloads', async () => {
    const roundTrip = (graph: unknown): { nodes: unknown[] } => {
      const { url } = shareUrl(graph as GraphJson);
      const payload = /#\/import\/json=(.*)$/.exec(url)?.[1];
      assert(payload, 'no payload in url');
      return JSON.parse(Base64.decode(payload as string));
    };
    assert(roundTrip(model.json).nodes.length === 2, 'baseline did not round-trip');
    // the payload is minified and default style keys are dropped, but non-default styling survives
    const payload = Buffer.from(/json=(.*)$/.exec(shareUrl(model.json).url)![1], 'base64').toString('utf8');
    assert(!payload.includes('\n'), 'share url payload is still pretty-printed');
    assert(!/"caption-position"/.test(payload), 'a default style key was not dropped from the payload');
    const themed = await build({ nodes: [{ caption: 'A', properties: { x: 'string' } }] });
    const themedPayload = Buffer.from(/json=(.*)$/.exec(shareUrl(themed.json).url)![1], 'base64').toString('utf8');
    assert(/"node-color"/.test(themedPayload), 'non-default styling was lost from the payload');
    // Force +, / and = into the base64 body - percent-encoding it would break arrows.app import.
    const forced = graphOf(node({ properties: { blob: Buffer.from([0xfb, 0xff, 0xbf, 0xfb, 0xef]).toString('latin1') } }));
    const { url } = shareUrl(forced);
    const body = /json=(.*)$/.exec(url)?.[1] as string;
    assert(/[+/=]/.test(body), 'test did not force special chars');
    assert(roundTrip(forced).nodes.length === 1, 'special-char payload did not round-trip');
  });

  await check('G12 unicode survives round-trip and renders', () => {
    const g = graphOf(node({ caption: '人物 😀', labels: ['Персона'], properties: { 名前: '山田', emoji: '🎬' } }));
    const back = normalize(g).nodes[0] as { caption: string; labels: string[]; properties: Record<string, string> };
    assert(back.caption === '人物 😀', `caption lost: ${back.caption}`);
    assert(back.labels[0] === 'Персона', 'label lost');
    assert(back.properties['名前'] === '山田', 'property lost');
    assert(renderSvg(g).includes('😀'), 'emoji missing from svg');
  });

  await check('G6 render yields valid SVG and PNG', () => {
    const svg = renderSvg(model.json);
    assert(svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>'), 'malformed svg');
    assert(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'missing xmlns');
    assert(/<svg[^>]*viewBox="/.test(svg), 'missing viewBox');
    assert(svg.includes('Person'), 'caption missing from svg');
    assert(isPng(renderPng(model.json)), 'invalid png');
  });

  await check('G6 empty graph renders and exports', () => {
    assert(renderSvg(empty).includes('<svg'), 'no svg');
    assert(isPng(renderPng(empty)), 'no png');
    toCypher(empty, 'CREATE');
  });

  await check('G6 a normal render keeps its real dimensions', () => {
    const g = {
      nodes: [node(), node({ id: 'b', caption: 'B', position: { x: 300, y: 200 } })],
      relationships: [{ id: 'r', fromId: 'a', toId: 'b', type: 'R', properties: {}, style: {} }],
      style: {},
    };
    const m = /<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(renderSvg(g));
    assert(m, 'no root dimensions');
    assert(parseInt(m![1], 10) > 50 && parseInt(m![2], 10) > 50, `dimensions clobbered: ${m![1]}x${m![2]}`);
  });

  await check('partial graph without style is accepted', () => {
    normalize({ nodes: [node()], relationships: [] });
  });

  await check('G7 property keys cannot pollute Object.prototype', () => {
    edit(graphOf(node()), [{ op: 'set', path: '/nodes/a/properties/__proto__', value: 'polluted' }]);
    edit(graphOf(node()), [{ op: 'set', path: '/style/constructor', value: 'polluted' }]);
    assert((({} as Record<string, unknown>).polluted) === undefined, 'Object.prototype was polluted');
  });

  await check('G11 a relationship endpoint that is not a node id is dropped, not misrouted', async () => {
    const dup = await build({
      nodes: [
        { id: 'p1', caption: 'Person', labels: ['Person'] },
        { id: 'p2', caption: 'Person', labels: ['Person'] },
      ],
      relationships: [{ fromId: 'Person', toId: 'p2', type: 'KNOWS' }],
    });
    assert(dup.errors.some((e) => /dropped/.test(e)), 'no drop warning for an unresolved endpoint');
    assert(dup.json.relationships.length === 0, 'a relationship with an invalid endpoint was created anyway');
  });

  // Last: these provoke a native Skia abort when unguarded, which would kill the process
  // before earlier results could be printed.
  await check('G1 a 1e6-char property value renders a bounded PNG', () => {
    assert(isPng(renderPng(graphOf(node({ properties: { big: 'x'.repeat(1_000_000) } })))), 'invalid png');
  });

  await check('G1 a 1e6-char caption renders a bounded PNG', () => {
    assert(isPng(renderPng(graphOf(node({ caption: 'y'.repeat(1_000_000) })))), 'invalid png');
  });

  await check('G1 extreme node positions render a bounded PNG', () => {
    const g = {
      nodes: [node({ position: { x: -1e30, y: -1e30 } }), node({ id: 'b', caption: 'B', position: { x: 1e30, y: 1e30 } })],
      relationships: [], style: {},
    };
    assert(isPng(renderPng(g)), 'invalid png');
  });

  await check('a mixed type/literal model never stores a type name as data', () => {
    const mixed = graphOf(node({ properties: { name: 'string', nickname: 'Bob' } }));
    const cypher = toCypher(mixed);
    assert(!/name: "string"/.test(cypher), `auto mode stored a type name as data:\n${cypher}`);
    assert(/unrecognised type "Bob"/.test(cypher), `unknown type was not surfaced:\n${cypher}`);
  });

  await check('literal values with quotes produce escaped, balanced Cypher', () => {
    const g = graphOf(node({ properties: { bio: 'She said "hi" to me' } }));
    const cypher = toCypher(g, 'CREATE', 'data');
    assert(cypher.includes('\\"'), `inner quotes were not escaped:\n${cypher}`);
    const unescaped = cypher.replace(/\\./g, '');
    assert(((unescaped.match(/"/g) ?? []).length % 2) === 0, `unbalanced quotes:\n${cypher}`);
  });

  await check('a hostile label cannot break out of its Cypher identifier', () => {
    const evil = 'A`) DETACH DELETE n //';
    const escaped = '`A``) DETACH DELETE n //`';
    const data = toCypher(graphOf(node({ labels: [evil], properties: { x: "'v'" } })), 'CREATE', 'data');
    assert(data.includes(escaped), `label not safely escaped (data style):\n${data}`);
    const schema = toCypher(graphOf(node({ labels: [evil], properties: { x: 'string' } })), 'CREATE', 'schema');
    assert(schema.includes(escaped), `label not safely escaped (schema style):\n${schema}`);
    for (const out of [data, schema]) {
      assert(((out.match(/`/g) ?? []).length % 2) === 0, `unbalanced backticks:\n${out}`);
    }
  });

  await check('validate actually reports duplicate ids and dangling relationships', () => {
    const broken = {
      nodes: [
        { id: 'n0', caption: 'A', labels: ['L'], properties: {}, position: { x: 0, y: 0 }, style: {} },
        { id: 'n0', caption: 'B', labels: ['L'], properties: {}, position: { x: 10, y: 10 }, style: {} },
      ],
      relationships: [{ id: 'r0', fromId: 'n0', toId: 'ghost', type: 'X', properties: {}, style: {} }],
      style: {},
    };
    const diags = validate(broken);
    const codes = diags.map((d) => d.code);
    assert(codes.some((c) => /duplicate-id/.test(c)), `duplicate id not reported: ${codes.join(',')}`);
    assert(codes.some((c) => /ref-integrity|orphan-relationship/.test(c)), `dangling relationship not reported: ${codes.join(',')}`);
    // structural diagnostics locate themselves via `anchor`, not `path` - both must survive the merge
    const dup = diags.find((d) => /duplicate-id/.test(d.code));
    assert(dup?.anchor?.id, `duplicate-id diagnostic lost its anchor: ${JSON.stringify(dup)}`);
  });

  await check('every layout actually moves nodes to finite positions', async () => {
    const stacked = {
      nodes: [node(), node({ id: 'b', caption: 'B' }), node({ id: 'c', caption: 'C' })],
      relationships: [{ id: 'r', fromId: 'a', toId: 'b', type: 'R', properties: {}, style: {} }],
      style: {},
    };
    for (const id of LAYOUT_IDS) {
      const out = await layout(stacked, id);
      const points = out.json.nodes.map((n) => (n as { position: { x: number; y: number } }).position);
      assert(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `${id} produced non-finite positions`);
      assert(new Set(points.map((p) => `${p.x},${p.y}`)).size === points.length, `${id} left nodes stacked on one point`);
    }
  });

  await check('G2 logically equal graphs canonicalize identically regardless of key order', () => {
    const a = { nodes: [node({ properties: { b: '2', a: '1' } })], relationships: [], style: {} };
    const b = { nodes: [{ style: {}, position: { y: 0, x: 0 }, properties: { a: '1', b: '2' }, labels: ['L'], caption: 'A', id: 'a' }], relationships: [], style: {} };
    assert(JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)), 'key order changed canonical output');
  });

  await check('an outlier coordinate does not render every real node sub-pixel', () => {
    const g = {
      nodes: [node(), node({ id: 'b', caption: 'B', position: { x: 1e30, y: 1e30 } })],
      relationships: [], style: {},
    };
    const vb = /viewBox="([^"]*)"/.exec(renderSvg(g))?.[1]?.trim().split(/\s+/).map(Number);
    assert(vb?.length === 4, 'no viewBox');
    assert(vb![2] < 200_000 && vb![3] < 200_000, `viewBox exploded, real nodes invisible: ${vb!.join(' ')}`);
  });

  await check('the rendered SVG shows relationship types', () => {
    const g = {
      nodes: [node(), node({ id: 'b', caption: 'B', position: { x: 400, y: 0 } })],
      relationships: [{ id: 'r', fromId: 'a', toId: 'b', type: 'ACTED_IN', properties: {}, style: {} }],
      style: {},
    };
    assert(renderSvg(g).includes('ACTED_IN'), 'relationship type is missing from the diagram');
  });

  await check('an unreachable path is reported by op index and the graph survives', () => {
    const start = graphOf(node());
    const out = edit(start, [
      { op: 'set', path: '/nodes/a/caption', value: 'Kept' },
      { op: 'set', path: '/wombats/a/caption', value: 'Z' },
      { op: 'set', path: 'nodes/a/caption', value: 'Z' },
    ]);
    assert(out.errors.some((e) => /op 1 .*unknown collection "wombats"/.test(e)), `unhelpful error: ${out.errors.join('; ')}`);
    assert(out.errors.some((e) => /op 2 .*must start with/.test(e)), `malformed pointer not named: ${out.errors.join('; ')}`);
    assert(out.json.nodes.length === 1, 'the graph was lost when one op failed');
    assert((out.json.nodes[0] as { caption: string }).caption === 'Kept', 'the good op in the batch did not apply');
  });

  await check('a relationship type needing quotes is escaped', () => {
    const g = {
      nodes: [node(), node({ id: 'b', caption: 'B' })],
      relationships: [{ id: 'r', fromId: 'a', toId: 'b', type: 'HAS CHILD', properties: {}, style: {} }],
      style: {},
    };
    const cypher = toCypher(g, 'CREATE', 'data');
    assert(/\[:`HAS CHILD`\]/.test(cypher), `relationship type not escaped:\n${cypher}`);
  });

  await check('a mixed type/literal model warns instead of silently storing type names', () => {
    const mixed = {
      nodes: [node({ properties: { age: 'integer' } }), node({ id: 'b', caption: 'B', properties: { title: "'The Matrix'" } })],
      relationships: [], style: {},
    };
    const cypher = toCypher(mixed);
    assert(/warning:.*age/s.test(cypher), `no warning for a mixed model:\n${cypher}`);
  });

  await check('a caption-only schema model still gets node constraints', async () => {
    const built = await build({ nodes: [{ caption: 'Customer', properties: { email: 'string' } }] });
    const cypher = toCypher(built.json);
    assert(/FOR \(n:Customer\) REQUIRE n\.email IS :: STRING;/.test(cypher), `no node constraint:\n${cypher}`);
  });

  await check('build applies a theme, distinct colours and padding', async () => {
    const themed = await build({
      nodes: [{ id: 'n0', caption: 'Customer', properties: { a: 'string' } }, { id: 'n1', caption: 'Order', properties: { b: 'string' } }],
      relationships: [{ fromId: 'n0', toId: 'n1', type: 'PLACED' }],
    });
    const style = themed.json.style as Record<string, unknown>;
    assert(style['node-color'] && style['background-color'], 'no theme applied to the graph');
    const colours = themed.json.nodes.map((n) => (n as { style: Record<string, string> }).style['node-color']);
    assert(new Set(colours).size === 2, `entity types share a colour: ${colours.join(',')}`);
    const svg = renderSvg(themed.json);
    const box = /viewBox="([^"]*)"/.exec(svg)![1].trim().split(/\s+/).map(Number);
    assert(box[0] < 0 && box[1] < 0, `no padding, captions will clip: ${box.join(' ')}`);
    assert(/<rect x="-?\d/.test(svg), 'background not anchored to the padded viewBox');
  });

  await check('an added node is not stacked on an existing one', () => {
    const start = graphOf(node());
    const out = edit(start, [{ op: 'insert', path: '/nodes/-', value: { id: 'b', caption: 'B' } }]);
    const [a, b] = out.json.nodes.map((n) => (n as { position: { x: number; y: number } }).position);
    assert(a.x !== b.x || a.y !== b.y, 'new node landed on top of the existing one');
  });

  await check('build auto-layout routes no relationship through an unrelated node (e-commerce schema)', async () => {
    const ids = ['Customer', 'Order', 'Product', 'Category', 'Address', 'Supplier', 'Review'];
    const rels = [['Customer', 'Order', 'PLACED'], ['Order', 'Product', 'CONTAINS'], ['Product', 'Category', 'IN_CATEGORY'],
      ['Customer', 'Address', 'LIVES_AT'], ['Order', 'Address', 'SHIPS_TO'], ['Supplier', 'Product', 'SUPPLIES'],
      ['Customer', 'Review', 'WROTE'], ['Review', 'Product', 'REVIEWS']];
    const out = await build({
      nodes: ids.map((id) => ({ id, labels: [id], properties: { name: 'string' } })),
      relationships: rels.map(([fromId, toId, type]) => ({ fromId, toId, type })),
    });
    const { hard } = layoutScore(out.json as Parameters<typeof layoutScore>[0]);
    assert(hard === 0, `${hard} hidden-content defects: an edge or label crosses a node, or nodes overlap`);
  });

  await check('hierarchical keeps a layer-skipping edge clear of the node in the layer it crosses', async () => {
    const out = await build({
      nodes: [{ id: 'a', caption: 'A' }, { id: 'b', caption: 'B' }, { id: 'c', caption: 'C' }],
      relationships: [{ fromId: 'a', toId: 'b', type: 'X' }, { fromId: 'b', toId: 'c', type: 'X' }, { fromId: 'a', toId: 'c', type: 'X' }],
    }, 'hierarchical');
    const at = (id: string) => (out.json.nodes as { id: string; position: { x: number; y: number } }[]).find((n) => n.id === id)!.position;
    const [a, b, c] = [at('a'), at('b'), at('c')];
    const t = (b.y - a.y) / (c.y - a.y);
    const gap = Math.abs(b.x - (a.x + t * (c.x - a.x)));
    assert(gap > 150, `node B sits ${Math.round(gap)}px from the A-C edge`);
  });

  await check('chooseLayout picks radial for a hub-and-spoke shape', () => {
    const hub = {
      nodes: [{ id: 'h' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      relationships: [
        { fromId: 'h', toId: 'a' }, { fromId: 'h', toId: 'b' },
        { fromId: 'h', toId: 'c' }, { fromId: 'h', toId: 'd' },
      ],
    };
    assert(chooseLayout(hub) === 'radial', `expected radial, got ${chooseLayout(hub)}`);
  });

  await check('chooseLayout picks hierarchical for a tree/DAG shape', () => {
    const tree = {
      nodes: [{ id: 'doc' }, { id: 's1' }, { id: 's2' }, { id: 'w1' }, { id: 'w2' }],
      relationships: [
        { fromId: 'doc', toId: 's1' }, { fromId: 'doc', toId: 's2' },
        { fromId: 's1', toId: 'w1' }, { fromId: 's2', toId: 'w2' },
      ],
    };
    assert(chooseLayout(tree) === 'hierarchical', `expected hierarchical, got ${chooseLayout(tree)}`);
  });

  await check('chooseLayout picks circular for a small dense cycle', () => {
    const ring = {
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      relationships: [
        { fromId: 'a', toId: 'b' }, { fromId: 'b', toId: 'c' },
        { fromId: 'c', toId: 'd' }, { fromId: 'd', toId: 'a' },
      ],
    };
    assert(chooseLayout(ring) === 'circular', `expected circular, got ${chooseLayout(ring)}`);
  });

  await check('chooseLayout picks force for a larger cyclic graph and grid for no relationships', () => {
    const ids = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
    const bigRing = { nodes: ids, relationships: ids.map((n, i) => ({ fromId: n.id, toId: ids[(i + 1) % ids.length].id })) };
    assert(chooseLayout(bigRing) === 'force', `expected force, got ${chooseLayout(bigRing)}`);
    assert(chooseLayout({ nodes: [{ id: 'a' }], relationships: [] }) === 'grid', 'expected grid for no relationships');
  });

  await check('build auto-picks a layout and arranges a hub without an explicit layout arg', async () => {
    const hub = await build({
      nodes: [{ id: 'n0', caption: 'Customer' }, { id: 'n1', caption: 'Order' }, { id: 'n2', caption: 'Address' }, { id: 'n3', caption: 'Payment' }],
      relationships: [
        { fromId: 'n0', toId: 'n1', type: 'PLACED' },
        { fromId: 'n0', toId: 'n2', type: 'HAS_ADDRESS' },
        { fromId: 'n0', toId: 'n3', type: 'HAS_PAYMENT' },
      ],
    });
    assert(hub.errors.length === 0, hub.errors.join('; '));
    const positions = hub.json.nodes.map((n) => (n as { position: { x: number; y: number } }).position);
    assert(new Set(positions.map((p) => `${p.x},${p.y}`)).size === 4, 'nodes were not distinctly arranged');
  });

  await check('arrows_build restores the share url in its own default output shape', () => {
    const share = shareUrl({ nodes: [{ id: 'a', caption: 'A', labels: [], properties: {}, position: { x: 0, y: 0 }, style: {} }], relationships: [], style: {} });
    assert(share.url.startsWith('https://arrows.app/#/import/json='), 'share url shape changed');
  });

  await check('verification checklist lists distinct captions and relationship types', () => {
    const g = {
      nodes: [node(), node({ id: 'b', caption: 'B' }), node({ id: 'c', caption: 'B' })],
      relationships: [
        { id: 'r0', fromId: 'a', toId: 'b', type: 'R1', properties: {}, style: {} },
        { id: 'r1', fromId: 'b', toId: 'c', type: 'R1', properties: {}, style: {} },
        { id: 'r2', fromId: 'a', toId: 'c', type: 'R2', properties: {}, style: {} },
      ],
      style: {},
    };
    const text = verificationChecklist(g);
    assert(text.includes('A') && text.includes('B'), `missing a caption: ${text}`);
    assert((text.match(/\bB\b/g) ?? []).length === 1, `duplicate caption not deduped: ${text}`);
    assert(text.includes('R1') && text.includes('R2'), `missing a relationship type: ${text}`);
    assert((text.match(/\bR1\b/g) ?? []).length === 1, `duplicate relationship type not deduped: ${text}`);
  });

  await check('verification checklist caps a large list instead of dumping every node', () => {
    const many = graphOf(...Array.from({ length: 30 }, (_, i) => node({ id: `n${i}`, caption: `N${i}` })));
    const text = verificationChecklist(many);
    assert(/\+10 more/.test(text), `expected a capped "+N more" suffix:\n${text}`);
  });



  await check('a caption that duplicates its label is not drawn twice', async () => {
    const dup = await build({ nodes: [{ caption: 'Document', labels: ['Document'], properties: { id: 'string' } }] });
    const n = dup.json.nodes[0] as { caption: string; labels: string[] };
    assert(n.labels.includes('Document'), 'the label must survive - GraphQL export requires one');
    assert(n.caption === '', `caption still echoes the label, so it renders twice: ${JSON.stringify(n)}`);
    const svg = renderSvg(dup.json);
    assert((svg.match(/>Document</g) ?? []).length <= 1, 'the name is still painted twice in the svg');
  });

  await check('the svg is minified without touching inherited attributes or text', async () => {
    const g = await build({
      // property values that contain the very patterns the minifier rewrites in attributes
      nodes: [
        { id: 'n0', caption: 'Person', properties: { name: 'string', ratio: 'x="0"', pi: 'k="3.14159"' } },
        { id: 'n1', caption: 'Movie', properties: { title: 'string', released: 'integer' } },
      ],
      relationships: [{ fromId: 'n0', toId: 'n1', type: 'ACTED_IN' }],
    }, 'grid');
    const svg = renderSvg(g.json);
    const attrsOnly = svg.replace(/>[^<]*</g, '><');
    assert(!/="[^"]*\d\.\d{4}/.test(attrsOnly), 'full-precision floats survived minification');
    assert(!/transform="(?:translate\(0 0\)|rotate\(0\))"/.test(attrsOnly), 'identity transforms survived minification');
    // The renderer sets text-anchor on the <g> wrapping property text, so an explicit "start" on
    // the <text> is what keeps that text left-aligned; dropping it as a "default" moves the text.
    assert(/<g[^>]*text-anchor="(?:middle|end)"/.test(svg), 'no ancestor sets text-anchor - this guard would be vacuous');
    assert(/<text[^>]*text-anchor="start"/.test(svg), 'an inherited-attribute override was stripped as if it were a default');
    // Rewriting inside a caption would silently corrupt what the diagram says.
    assert(svg.includes('>k="3.14159"<'), 'the minifier rounded a number inside text content');
    assert(svg.includes('>x="0"<'), 'the minifier dropped an attribute-looking value inside text content');
  });

  await check('a self-relationship loop is stroked, not flooded with black', async () => {
    const g = await build(
      {
        nodes: [{ id: 'n0', caption: 'Category', properties: { name: 'string' } }, { id: 'n1', caption: 'Other' }],
        relationships: [
          { fromId: 'n0', toId: 'n0', type: 'SUBCATEGORY_OF' },
          { fromId: 'n0', toId: 'n1', type: 'PLAIN' },
        ],
      },
      'grid',
    );
    const svg = renderSvg(g.json);
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    assert(paths.length >= 2, `expected a path per relationship, got ${paths.length}`);
    // SVG's initial fill is black, so a path enclosing area - a self-loop, or a rectilinear
    // arrow - renders as a solid black wedge unless fill is switched off.
    for (const path of paths) assert(/fill="none"/.test(path), `a stroked path would be filled black: ${path.slice(0, 90)}`);
  });

  await check('a property box matches the themed background instead of hardcoded white', async () => {
    const g = await build({ nodes: [{ caption: 'Person', properties: { name: 'string' } }] }, 'grid', 'Bloom');
    const background = (g.json.style as Record<string, string>)['background-color'];
    assert(background && background !== '#ffffff', `this check needs a non-white theme, got ${background}`);
    const svg = renderSvg(g.json);
    assert(!/fill="white"/.test(svg), 'a property box is still painted white over the themed canvas');
    assert(svg.includes(`fill="${background}"`), `no element adopted the background colour ${background}`);
  });

  await check('a transparent render drops the backdrop and the mask boxes', async () => {
    const g = await build({ nodes: [{ id: 'n0', caption: 'Person', properties: { name: 'string' } }, { id: 'n1', caption: 'Pet' }], relationships: [{ fromId: 'n0', toId: 'n1', type: 'OWNS' }] }, 'grid', 'Bloom');
    const background = (g.json.style as Record<string, string>)['background-color'];
    const opaque = renderSvg(g.json);
    const clear = renderSvg(g.json, { transparent: true });
    assert(opaque.includes(`fill="${background}"`), 'the themed render lost its backdrop');
    assert(!clear.includes(`fill="${background}"`), `a ${background} fill survived the transparent render`);
    // Node circles keep their own colour - only the mask groups are cleared.
    assert(/<g[^>]*fill="#[0-9A-Fa-f]{6}"[^>]*><circle/.test(clear), 'node fills were cleared too');
    assert(clear.startsWith('<svg') && /<\/svg>$/.test(clear), 'transparent render is not a well-formed svg');
  });

  await check('added nodes stack downwards, not off to the right', async () => {
    const base = await build({ nodes: [{ id: 'n0', caption: 'A' }, { id: 'n1', caption: 'B' }], relationships: [{ fromId: 'n0', toId: 'n1', type: 'R' }] }, 'grid');
    const grown = edit(base.json, [
      { op: 'insert', path: '/nodes/-', value: { id: 'x', caption: 'X' } },
      { op: 'insert', path: '/nodes/-', value: { id: 'y', caption: 'Y' } },
      { op: 'insert', path: '/nodes/-', value: { id: 'z', caption: 'Z' } },
    ]);
    const added = (grown.json.nodes as { id: string; position: { x: number; y: number } }[]).filter((n) => ['x', 'y', 'z'].includes(n.id));
    assert(added.length === 3, `expected 3 added nodes, got ${added.length}`);
    assert(new Set(added.map((n) => n.position.x)).size === 1, `added nodes spread horizontally: ${JSON.stringify(added.map((n) => n.position))}`);
    assert(new Set(added.map((n) => n.position.y)).size === 3, 'added nodes landed on top of each other');
  });

  await check('layout auto-picks when no algorithm is given', async () => {
    const g = await build({ nodes: [{ id: 'n0', caption: 'A' }, { id: 'n1', caption: 'B' }, { id: 'n2', caption: 'C' }], relationships: [{ fromId: 'n0', toId: 'n1', type: 'R' }, { fromId: 'n0', toId: 'n2', type: 'R' }] }, 'grid');
    const auto = await layout(g.json);
    assert(LAYOUT_IDS.includes(auto.algorithm), `auto-pick returned an unknown algorithm: ${auto.algorithm}`);
    assert(auto.json.nodes.length === 3, 'auto layout lost a node');
    const explicit = await layout(g.json, 'circular');
    assert(explicit.algorithm === 'circular', `explicit algorithm was overridden: ${explicit.algorithm}`);
  });

  await check('a transparent png keeps its alpha instead of a white plate', async () => {
    const g = await build({ nodes: [{ caption: 'A' }] }, 'grid');
    // A PNG's IHDR colour type byte is at offset 25; 6 is RGBA, 2 is RGB.
    const clear = renderPng(g.json, { transparent: true });
    const opaque = renderPng(g.json);
    assert(clear.length > 0 && opaque.length > 0, 'png render produced nothing');
    assert(!clear.equals(opaque), 'background:transparent had no effect on the png at all');
  });

  await check('the checklist survives a graph that never went through the reader', () => {
    // arrows_render hands the caller's raw graph straight in, so neither array is guaranteed.
    assert(verificationChecklist({ nodes: [], relationships: [] }).length > 0, 'empty graph broke the checklist');
    assert(verificationChecklist({} as never).length > 0, 'a graph with no arrays broke the checklist');
  });

  // The whole point of the redesign: three generic ops must reach everything the 16 named ops did.
  // Any row that cannot be expressed is a hole, so this fails loudly rather than being argued away.
  await check('the 3 path ops cover every one of the 16 named ops they replaced', () => {
    const base = () => ({
      nodes: [
        { id: 'a', caption: 'A', labels: ['L', 'M'], properties: { p: 'string' }, position: { x: 0, y: 0 }, style: { 'node-color': '#111111' } },
        { id: 'b', caption: 'B', labels: ['L'], properties: {}, position: { x: 300, y: 0 }, style: {} },
      ],
      relationships: [{ id: 'r', fromId: 'a', toId: 'b', type: 'OLD', properties: { q: 'string' }, style: {} }],
      style: { 'background-color': '#F2F2F2' },
    });
    const nodeOf = (g: GraphJson, id: string) => g.nodes.find((n) => (n as { id: string }).id === id) as Record<string, never>;
    const relOf = (g: GraphJson, id: string) => g.relationships.find((r) => (r as { id: string }).id === id) as Record<string, never>;

    const table: [string, PathOp[], (g: GraphJson) => boolean][] = [
      ['addNode', [{ op: 'insert', path: '/nodes/-', value: { id: 'c', caption: 'C' } }], (g) => g.nodes.length === 3 && !!nodeOf(g, 'c')],
      ['removeNode (+cascade)', [{ op: 'remove', path: '/nodes/a' }], (g) => g.nodes.length === 1 && g.relationships.length === 0],
      ['setPos', [{ op: 'set', path: '/nodes/a/position', value: { x: 9, y: 8 } }], (g) => JSON.stringify(nodeOf(g, 'a').position) === '{"x":9,"y":8}'],
      ['movePos', [{ op: 'set', path: '/nodes/b/position/x', value: 310 }], (g) => (nodeOf(g, 'b').position as unknown as { x: number }).x === 310],
      ['setCaption', [{ op: 'set', path: '/nodes/a/caption', value: 'Renamed' }], (g) => nodeOf(g, 'a').caption === ('Renamed' as never)],
      ['addLabel', [{ op: 'insert', path: '/nodes/b/labels/-', value: 'New' }], (g) => (nodeOf(g, 'b').labels as unknown as string[]).includes('New')],
      ['removeLabel (by value)', [{ op: 'remove', path: '/nodes/a/labels/M' }], (g) => !(nodeOf(g, 'a').labels as unknown as string[]).includes('M')],
      ['renameLabel (batched)', [{ op: 'set', path: '/nodes/a/labels/0', value: 'X' }, { op: 'set', path: '/nodes/b/labels/0', value: 'X' }],
        (g) => (nodeOf(g, 'a').labels as unknown as string[])[0] === 'X' && (nodeOf(g, 'b').labels as unknown as string[])[0] === 'X'],
      ['setProperty', [{ op: 'set', path: '/nodes/a/properties/p', value: 'integer' }], (g) => (nodeOf(g, 'a').properties as unknown as Record<string, string>).p === 'integer'],
      ['removeProperty', [{ op: 'remove', path: '/nodes/a/properties/p' }], (g) => !('p' in (nodeOf(g, 'a').properties as unknown as object))],
      ['setStyle (entity)', [{ op: 'set', path: '/nodes/a/style/node-color', value: '#222222' }], (g) => (nodeOf(g, 'a').style as unknown as Record<string, string>)['node-color'] === '#222222'],
      ['setStyle (graph, id null)', [{ op: 'set', path: '/style/background-color', value: '#000000' }], (g) => (g.style as Record<string, string>)['background-color'] === '#000000'],
      ['addRelationship', [{ op: 'insert', path: '/relationships/-', value: { id: 'r2', fromId: 'b', toId: 'a', type: 'NEW' } }], (g) => g.relationships.length === 2],
      ['removeRelationship', [{ op: 'remove', path: '/relationships/r' }], (g) => g.relationships.length === 0 && g.nodes.length === 2],
      ['setRelType', [{ op: 'set', path: '/relationships/r/type', value: 'NEW' }], (g) => relOf(g, 'r').type === ('NEW' as never)],
      ['renameRelType (batched)', [{ op: 'set', path: '/relationships/r/type', value: 'NEW' }], (g) => relOf(g, 'r').type === ('NEW' as never)],
      // Beyond the old 16: these paths had no named op at all.
      ['(new) remove a style key', [{ op: 'remove', path: '/nodes/a/style/node-color' }], (g) => !('node-color' in (nodeOf(g, 'a').style as unknown as object))],
      ['(new) repoint a relationship', [{ op: 'set', path: '/relationships/r/toId', value: 'a' }], (g) => relOf(g, 'r').toId === ('a' as never)],
      ['(new) remove a graph style key', [{ op: 'remove', path: '/style/background-color' }], (g) => !('background-color' in (g.style ?? {}))],
    ];

    const holes: string[] = [];
    for (const [name, ops, ok] of table) {
      const out = edit(base(), ops);
      if (out.errors.length) holes.push(`${name}: ${out.errors.join('; ')}`);
      else if (!ok(out.json)) holes.push(`${name}: applied without error but did not take effect`);
    }
    assert(holes.length === 0, `${holes.length}/${table.length} operations are not expressible:\n  ${holes.join('\n  ')}`);
  });

  await check('an inserted node is auto-positioned and does not overlap', () => {
    const out = edit(
      { nodes: [{ id: 'a', caption: 'A', labels: [], properties: {}, position: { x: 0, y: 0 }, style: {} }], relationships: [], style: {} },
      [{ op: 'insert', path: '/nodes/-', value: { caption: 'B' } }, { op: 'insert', path: '/nodes/-', value: { caption: 'C' } }],
    );
    assert(out.errors.length === 0, out.errors.join('; '));
    const seen = new Set(out.json.nodes.map((n) => JSON.stringify((n as { position: unknown }).position)));
    assert(seen.size === 3, `nodes share a position: ${[...seen].join(' ')}`);
    assert(out.json.nodes.every((n) => typeof (n as { id: string }).id === 'string'), 'an inserted node got no id');
  });

  await check('a property or style value must be a string', () => {
    for (const path of ['/nodes/a/properties/p', '/nodes/a/style/radius', '/style/background-color']) {
      const out = edit(graphOf(node()), [{ op: 'set', path, value: 42 }]);
      assert(out.errors.some((e) => /must be a string/.test(e)), `${path} accepted a number: ${out.errors.join('; ')}`);
    }
  });

  await check('an id is immutable and a whole collection cannot be replaced', () => {
    assert(edit(graphOf(node()), [{ op: 'set', path: '/nodes/a/id', value: 'z' }]).errors.length > 0, 'id was mutable');
    assert(edit(graphOf(node()), [{ op: 'set', path: '/nodes', value: [] }]).errors.length > 0, 'the collection was replaceable');
  });

  await check('build renames a colliding explicit id instead of accepting a duplicate', async () => {
    const g = await build({ nodes: [{ id: 'x', caption: 'A' }, { id: 'x', caption: 'B' }] });
    assert(g.json.nodes.length === 2, 'a node was dropped instead of renamed');
    const ids = g.json.nodes.map((n) => (n as { id: string }).id);
    assert(new Set(ids).size === 2, `two nodes still share an id: ${ids.join(',')}`);
    assert(g.errors.some((e) => /already used/.test(e)), 'no warning for the id collision');
  });

  await check('build drops a non-string properties/style value instead of corrupting it via spread', async () => {
    const g = await build({ nodes: [{ id: 'a', caption: 'A', properties: 'oops' }, { id: 'b', caption: 'B', style: ['x'] }] }, 'grid', 'none');
    const a = g.json.nodes.find((n) => (n as { id: string }).id === 'a') as { properties: unknown };
    const b = g.json.nodes.find((n) => (n as { id: string }).id === 'b') as { style: unknown };
    // theme:'none' skips applyTheme, so nothing legitimate adds keys after the coercion runs
    assert(JSON.stringify(a.properties) === '{}', `a string value was spread into numeric keys: ${JSON.stringify(a.properties)}`);
    assert(JSON.stringify(b.style) === '{}', `an array value was spread into numeric keys: ${JSON.stringify(b.style)}`);
    assert(g.errors.some((e) => /properties ignored/.test(e)) && g.errors.some((e) => /style ignored/.test(e)), 'no warning for either dropped value');
  });

  await check('insert rejects a non-string properties/style value instead of merging it unfiltered', () => {
    const start = graphOf(node());
    const out = edit(start, [{ op: 'insert', path: '/nodes/-', value: { caption: 'B', properties: 'oops' } }]);
    assert(out.errors.length > 0, 'a malformed properties value on insert was silently accepted');
    assert(out.json.nodes.length === 1, 'a node was added despite the malformed value');
  });

  await check('a whole-entity set validates properties/style the same way a single-key set does', () => {
    const start = graphOf(node());
    const out = edit(start, [{ op: 'set', path: '/nodes/a', value: { caption: 'A', properties: { p: 42 } } }]);
    assert(out.errors.some((e) => /must be a string/.test(e)), 'a numeric property value survived a whole-entity set');
  });

  await check('a numeric path segment matching no id is rejected, not treated as an array index', () => {
    const start = { nodes: [node({ id: 'a' }), node({ id: 'b', caption: 'B' })], relationships: [], style: {} };
    const out = edit(start, [{ op: 'set', path: '/nodes/0/caption', value: 'Hijacked' }]);
    assert(out.errors.length > 0, 'array position 0 was silently addressable despite no node with id "0"');
    assert(!out.json.nodes.some((n) => (n as { caption: string }).caption === 'Hijacked'), 'a node was renamed by array position');
  });

  await check('removing or setting an id is rejected with the same, correct reason either way', () => {
    const start = graphOf(node());
    const removed = edit(start, [{ op: 'remove', path: '/nodes/a/id' }]);
    const set = edit(start, [{ op: 'set', path: '/nodes/a/id', value: 'z' }]);
    assert(removed.errors.some((e) => /immutable/.test(e)), `remove-id gave a misleading reason: ${removed.errors.join('; ')}`);
    assert(set.errors.some((e) => /immutable/.test(e)), `set-id gave a misleading reason: ${set.errors.join('; ')}`);
  });

  await check('a non-finite position is rejected on set, but insert auto-places instead of storing it', () => {
    const start = graphOf(node());
    const setBad = edit(start, [{ op: 'set', path: '/nodes/a/position', value: { x: Infinity, y: 0 } }]);
    assert(setBad.errors.length > 0, 'a non-finite position was accepted by set');
    const inserted = edit(start, [{ op: 'insert', path: '/nodes/-', value: { caption: 'B', position: { x: Infinity, y: NaN } } }]);
    assert(inserted.errors.length === 0, inserted.errors.join('; '));
    const b = inserted.json.nodes.find((n) => (n as { caption: string }).caption === 'B') as { position: { x: number; y: number } };
    assert(Number.isFinite(b.position.x) && Number.isFinite(b.position.y), 'a non-finite position was stored instead of auto-placed');
  });

  await check('an oversized op batch is rejected up front', () => {
    const ops = Array.from({ length: 201 }, () => ({ op: 'set' as const, path: '/nodes/a/caption', value: 'x' }));
    let threw = false;
    try {
      edit(graphOf(node()), ops);
    } catch {
      threw = true;
    }
    assert(threw, 'a 201-op batch was accepted with no limit');
  });

  await check('build truncates an oversized caption instead of rendering it at exponential cost', async () => {
    const g = await build({ nodes: [{ caption: 'x'.repeat(2000) }] });
    const n = g.json.nodes[0] as { caption: string };
    assert(n.caption.length <= 120, `caption was not truncated: ${n.caption.length} chars`);
    assert(g.errors.some((e) => /caption truncated/.test(e)), 'no warning for the truncated caption');
  });

  await check('edit rejects an oversized caption on set, insert, and whole-entity set', () => {
    const long = 'x'.repeat(2000);
    const start = graphOf(node());
    const onField = edit(start, [{ op: 'set', path: '/nodes/a/caption', value: long }]);
    assert(onField.errors.some((e) => /caption exceeds/.test(e)), 'set /caption accepted an oversized value');
    const onInsert = edit(start, [{ op: 'insert', path: '/nodes/-', value: { caption: long } }]);
    assert(onInsert.errors.some((e) => /caption exceeds/.test(e)), 'insert accepted an oversized caption');
    assert(onInsert.json.nodes.length === 1, 'a node was added despite the oversized caption');
    const onWholeSet = edit(start, [{ op: 'set', path: '/nodes/a', value: { caption: long } }]);
    assert(onWholeSet.errors.some((e) => /caption exceeds/.test(e)), 'a whole-entity set let an oversized caption through unfiltered');
  });

  await check('cypher export identifies a caption-only, label-less, property-less node - not a bare ()', async () => {
    const g = await build({
      nodes: [{ caption: 'Customer' }, { caption: 'Order' }],
      relationships: [{ from: 'Customer', to: 'Order', type: 'PLACES' }],
    });
    const cypher = toCypher(g.json, 'CREATE', 'data');
    assert(cypher.includes('(:Customer)') && cypher.includes('(:Order)'), `nodes lost their identity: ${cypher}`);
    assert(!/\(\)/.test(cypher), `a bare, anonymous node survived: ${cypher}`);
  });

  await check('cypher export still prefers an explicit label over the caption when both are given', async () => {
    const g = await build({ nodes: [{ caption: 'Alice', labels: ['Person'] }] });
    const cypher = toCypher(g.json, 'CREATE', 'data');
    assert(cypher.includes('(:Person)'), `explicit label was not used: ${cypher}`);
    assert(!cypher.includes('(:Alice)'), `caption leaked in ahead of the explicit label: ${cypher}`);
  });

  await check('graphql export uses a caption-only node as its type name instead of refusing', async () => {
    const g = await build({ nodes: [{ caption: 'Customer', properties: { name: 'string' } }] });
    const sdl = toGraphQL(g.json);
    assert(/type Customer\b/.test(sdl), `caption was not used as the GraphQL type: ${sdl}`);
  });

  await check('graphql export rejects a caption that is not a legal GraphQL name, rather than emitting unparseable SDL', async () => {
    const g = await build({ nodes: [{ caption: '田中', properties: { name: 'string' } }] });
    let threw = false;
    try {
      toGraphQL(g.json);
    } catch (e) {
      threw = true;
      assert(/is not a valid GraphQL name/.test(e instanceof Error ? e.message : String(e)), `unclear reason: ${e}`);
    }
    assert(threw, 'a non-ASCII caption produced SDL instead of a clear error - GraphQL has no way to escape it');
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
