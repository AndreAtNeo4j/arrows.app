import { readGraph, writeGraph } from '@arrows-code/format-json';
import { styleAttributeGroups, type Graph } from '@neo4j-arrows/model';
import { applyPathOps, stringArray, stringRecord, MAX_CAPTION, type PathOp } from './patchPath';
export type { PathOp };
import { validate as checkStructural } from 'engine/validator';
import { LAYOUTS, findLayout, type GraphIn, type LayoutId } from 'engine/layout';
export type { LayoutId };
import { exportCypher } from 'engine/cypher';
import exportGraphQL from 'engine/graphql';
import { isSchemaModel, parseType, toConstraints, withGraphqlScalars } from './schema';
import { applyTheme } from './style';
import { pickLayout } from './autoLayout';

// anchor locates a structural diagnostic, path locates a parse one; kept separate, not merged.
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  anchor?: { kind: 'node' | 'relationship' | 'graph' | 'property' | 'style'; id?: string; key?: string };
}

export interface GraphJson {
  nodes: unknown[];
  relationships: unknown[];
  style?: Record<string, unknown>;
}

/** What a model realistically sends to build a new graph: relationships are easy to forget. */
export interface BuildInput {
  nodes: unknown[];
  relationships?: unknown[];
  style?: Record<string, unknown>;
}

function toJson(graph: Graph): GraphJson {
  return JSON.parse(writeGraph(graph)) as GraphJson;
}

function load(input: GraphJson): { graph: Graph; diagnostics: Diagnostic[] } {
  return readGraph(JSON.stringify(input));
}

/** Round-trips a graph through the canonical .arrows format; same graph in, same graph out. */
export function normalize(input: GraphJson): GraphJson {
  return toJson(load(input).graph);
}

const MAX_ENTITIES = 500;

/** Coerces to a string-only map, dropping the whole map with a warning rather than corrupting it. */
function safeStringRecord(value: unknown, what: string, errors: string[]): Record<string, string> {
  try {
    return stringRecord(value, what, {});
  } catch (e) {
    errors.push(`${what} ignored: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
}

function safeStringArray(value: unknown, what: string, errors: string[]): string[] {
  try {
    return stringArray(value, what, []);
  } catch (e) {
    errors.push(`${what} ignored: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Truncated, not dropped: unlike a malformed properties/style map, a caption is meant to be seen,
 * so keeping most of it beats erasing it. The cap itself is a render-cost guard - see MAX_CAPTION.
 */
function safeCaption(value: unknown, what: string, errors: string[]): string {
  if (typeof value !== 'string') return '';
  if (value.length <= MAX_CAPTION) return value;
  errors.push(`${what} truncated: exceeds ${MAX_CAPTION} characters`);
  return value.slice(0, MAX_CAPTION);
}

/**
 * Takes .arrows JSON as-is and fills in only what a model should not have to write: ids, and
 * positions, which the layout computes. Same shape the tools return and the edit ops address, so
 * there is one format to know rather than a separate build spec.
 */
export async function build(
  input: BuildInput,
  layoutId?: LayoutId,
  theme?: string,
): Promise<{ json: GraphJson; errors: string[] }> {
  const errors: string[] = [];
  const nodesIn = Array.isArray(input.nodes) ? (input.nodes as Record<string, unknown>[]) : [];
  const relsIn = Array.isArray(input.relationships) ? (input.relationships as Record<string, unknown>[]) : [];
  if (nodesIn.length > MAX_ENTITIES) throw new Error(`${nodesIn.length} nodes exceeds the limit of ${MAX_ENTITIES}`);
  if (relsIn.length > MAX_ENTITIES) throw new Error(`${relsIn.length} relationships exceeds the limit of ${MAX_ENTITIES}`);

  const ids = new Set<string>();
  const nodes = nodesIn.map((n, i) => {
    const labels = safeStringArray(n.labels, `node ${i} labels`, errors);
    const caption = safeCaption(n.caption, `node ${i} caption`, errors);
    let id = typeof n.id === 'string' && n.id !== '' ? n.id : `n${i}`;
    if (ids.has(id)) {
      const original = id;
      for (let j = 0; ids.has(id); j++) id = `${original}-${j}`;
      errors.push(`node id "${original}" was already used; this node was renamed to "${id}"`);
    }
    ids.add(id);
    return {
      ...n,
      id,
      // A caption identical to a label would be drawn twice.
      caption: labels.includes(caption) ? '' : caption,
      labels,
      properties: safeStringRecord(n.properties, `node ${id} properties`, errors),
      style: safeStringRecord(n.style, `node ${id} style`, errors),
      position: n.position ?? { x: 0, y: 0 },
    };
  });

  const relIds = new Set<string>();
  const relationships = relsIn
    .map((r, i): Record<string, unknown> => {
      let id = typeof r.id === 'string' && r.id !== '' ? r.id : `r${i}`;
      if (relIds.has(id)) {
        const original = id;
        for (let j = 0; relIds.has(id); j++) id = `${original}-${j}`;
        errors.push(`relationship id "${original}" was already used; this relationship was renamed to "${id}"`);
      }
      relIds.add(id);
      return {
        ...r,
        id,
        properties: safeStringRecord(r.properties, `relationship ${id} properties`, errors),
        style: safeStringRecord(r.style, `relationship ${id} style`, errors),
      };
    })
    .filter((r) => {
      const missing = (['fromId', 'toId'] as const).filter((end) => !ids.has(r[end] as string));
      if (missing.length) {
        errors.push(`relationship "${r.id}" dropped: ${missing.map((e) => `${e} "${r[e]}"`).join(' and ')} is not a node in this graph`);
        return false;
      }
      if (typeof r.type !== 'string' || r.type === '') {
        errors.push(`relationship "${r.id}" dropped: it needs a type`);
        return false;
      }
      return true;
    });

  const { graph } = load({ ...input, nodes, relationships } as GraphJson);
  const styled = applyTheme(graph, theme);
  const laidOut = layoutId ? await runLayout(styled, layoutId) : (await pickLayout(styled, runLayout)).graph;
  return { json: toJson(laidOut), errors };
}

/** Applies ops in order; one bad op is reported in `errors`, the rest still apply. */
export function edit(input: GraphJson, ops: PathOp[]): { json: GraphJson; errors: string[] } {
  // Normalise first so ops address the canonical shape, and again after so the result round-trips.
  const { json, errors } = applyPathOps(normalize(input), ops);
  return { json: normalize(json), errors };
}

async function runLayout(graph: Graph, layoutId: LayoutId): Promise<Graph> {
  const descriptor = findLayout(layoutId);
  if (!descriptor) throw new Error(`unknown layout: ${layoutId}`);
  // GraphIn is layout's own structural type (id/fromId/toId only); bridges to/from the richer Graph.
  return (await descriptor.run(graph as unknown as GraphIn)) as unknown as Graph;
}

/** Repositions nodes only; labels, properties, and relationships are unchanged. */
export async function layout(
  input: GraphJson,
  layoutId?: LayoutId,
): Promise<{ json: GraphJson; algorithm: LayoutId }> {
  const { graph } = load(input);
  // Same auto-pick build uses, so re-laying out an edited graph does not force a blind choice.
  const { graph: laidOut, algorithm } = layoutId
    ? { graph: await runLayout(graph, layoutId), algorithm: layoutId }
    : await pickLayout(graph, runLayout);
  return { json: toJson(laidOut), algorithm };
}

export function validate(input: GraphJson): Diagnostic[] {
  const { graph, diagnostics } = load(input);
  const structural: Diagnostic[] = checkStructural(graph);
  return [...diagnostics, ...structural];
}

export const CYPHER_STYLES = ['auto', 'data', 'schema'] as const;
type CypherStyle = (typeof CYPHER_STYLES)[number];

export const CYPHER_KEYWORDS = ['CREATE', 'MATCH', 'MERGE'] as const;
type CypherKeyword = (typeof CYPHER_KEYWORDS)[number];

/** "auto" emits schema constraints when every property value names a type, else literal data. */
export function toCypher(
  input: GraphJson,
  keyword: CypherKeyword = 'CREATE',
  style: CypherStyle = 'auto',
): string {
  const { graph } = load(input);
  const schema = style === 'schema' || (style === 'auto' && isSchemaModel(graph));
  if (schema) return toConstraints(graph);
  const data = exportCypher(graph, keyword, { includeStyling: false });
  const typed = [...graph.nodes, ...graph.relationships].flatMap((e) =>
    Object.entries((e.properties ?? {}) as Record<string, unknown>)
      .filter(([, v]) => parseType(v))
      .map(([k]) => k),
  );
  return typed.length
    ? `// warning: ${typed.join(', ')} look like type names but are exported as literal data.\n` +
        `// This model mixes types and values; use cypherStyle "schema" for a type model.\n${data}`
    : data;
}

/** Property values are coerced to real GraphQL scalars; an unrecognised one is noted, not thrown. */
export function toGraphQL(input: GraphJson): string {
  const { graph } = load(input);
  const { graph: scalars, notes } = withGraphqlScalars(graph);
  // exportGraphQL is an untyped .js module; this names its real signature at the one call site.
  const sdl = (exportGraphQL as unknown as (g: Graph) => string)(scalars);
  return notes.length ? `${notes.join('\n')}\n${sdl}` : sdl;
}

const ARROWS_APP_URL_WARN_BYTES = 20_000;

const STYLE_DEFAULTS: Record<string, unknown> = Object.fromEntries(
  styleAttributeGroups.flatMap((g) => g.attributes.map((a) => [a.key, a.defaultValue])),
);

// arrows.app re-applies its own defaults on import, so a default-valued key is dead URL weight.
const withoutDefaultStyles = (style: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(style).filter(([k, v]) => JSON.stringify(STYLE_DEFAULTS[k]) !== JSON.stringify(v)),
  );

/** Above ARROWS_APP_URL_WARN_BYTES the url is still returned, with `warning` set - never thrown. */
export function shareUrl(input: GraphJson): { url: string; warning?: string } {
  const { graph } = load(input);
  const canonical = JSON.parse(writeGraph(graph)) as {
    nodes: { style?: Record<string, unknown> }[];
    relationships: unknown[];
    style?: Record<string, unknown>;
  };
  const json = JSON.stringify({
    ...canonical,
    style: withoutDefaultStyles(canonical.style),
    nodes: canonical.nodes.map((n) => ({ ...n, style: withoutDefaultStyles(n.style) })),
  });
  // arrows.app reads location.hash raw and Base64-decodes it directly, so the
  // base64 body must NOT be percent-encoded (matches the web app's ExportUrlPanel).
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const url = `https://arrows.app/#/import/json=${b64}`;
  const warning =
    json.length > ARROWS_APP_URL_WARN_BYTES
      ? `graph is ${Math.round(json.length / 1024)} KB; some browsers may reject the URL`
      : undefined;
  return { url, ...(warning ? { warning } : {}) };
}

export const LAYOUT_IDS = LAYOUTS.map((l) => l.id);
