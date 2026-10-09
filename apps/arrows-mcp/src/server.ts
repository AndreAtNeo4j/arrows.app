import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import {
  build,
  edit,
  layout,
  validate,
  toCypher,
  toGraphQL,
  shareUrl,
  normalize,
  LAYOUT_IDS,
  type GraphJson,
  type LayoutId,
  type Diagnostic,
  CYPHER_STYLES,
  CYPHER_KEYWORDS,
} from './engine';
import { renderSvg, pngFromSvg, type RenderOptions } from './render';
import { PATH_OPS, MAX_OPS, type PathOp } from './patchPath';
import { recall, store } from './session';
import { THEME_NAMES } from './style';
import { verificationChecklist } from './checklist';
import { UI_MIME_TYPE, UI_RESOURCE_URI, UI_TOOL_META, UI_VIEW_HTML } from './ui';
import iconPng from '../media/icon.png';
import iconSvg from '../media/arrows_logo.svg';

type Content = TextContent | ImageContent;

// The MCP schema only guarantees `graph` is untyped JSON; the real shape is enforced at runtime
// by readGraph() inside engine.load(), so this assertion just names that trust boundary once.
const asGraph = (g: unknown): GraphJson => g as GraphJson;

/**
 * A tool takes `id` (a handle from an earlier result, held for this session only) or `graph`.
 * The session is in-process, so it is gone after a restart - hence the actionable message rather
 * than a bare lookup failure.
 */
function resolveGraph(args: { id?: string; graph?: unknown }): GraphJson {
  if (args.id) {
    const found = recall(args.id);
    if (found) return found;
    throw new Error(
      `no graph "${args.id}" in this session (the server restarted, or it aged out). Pass the full graph as \`graph\` instead.`,
    );
  }
  if (args.graph) return asGraph(args.graph);
  throw new Error('pass either `id` from an earlier result or `graph`');
}

const idArg = z.string().optional().describe('handle from an earlier result; cheaper than re-sending the graph. Takes precedence over graph if both are given.');

const layoutEnum = z.enum(LAYOUT_IDS as [string, ...string[]]);

/** Shared so arrows_build and arrows_layout cannot drift into describing the algorithms differently. */
const LAYOUT_GUIDANCE =
  'hierarchical for a tree or DAG (layered, reads top-down), radial for a single hub with many ' +
  'neighbours, circular for a small dense cluster, force for a general graph, grid when there are ' +
  'no relationships.';

const styleArg = z
  .record(z.string(), z.string())
  .optional()
  .describe('arrows style keys, e.g. node-color, caption-color, border-width');

const idAndProps = { properties: z.record(z.string(), z.string()).optional(), style: styleArg };

// Generic on purpose: a pointer reaches any field, including ones no named op would have covered.
const pathOpSchema = z.object({
  op: z.enum(PATH_OPS),
  path: z.string().describe('JSON Pointer, e.g. /nodes/n5/properties/name or /style/background-color'),
  value: z.unknown().optional().describe('required for set and insert; ignored by remove'),
});

/** Validated independently so one malformed op doesn't block the rest of the batch. */
function parseOps(raw: unknown[]): { ops: PathOp[]; errors: string[] } {
  const ops: PathOp[] = [];
  const errors: string[] = [];
  for (const op of raw) {
    const result = pathOpSchema.safeParse(op);
    if (result.success) ops.push(result.data as PathOp);
    else errors.push(`invalid op ${JSON.stringify(op)}: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return { ops, errors };
}

// Types stay loose on purpose: engine.build reports a wrong-typed field as a warning (G5), and a
// stricter schema would turn the same input into an MCP protocol error. The names are what the
// model needs to see.
const nodeShape = z.looseObject({
  id: z.unknown().optional().describe('string, your choice; generated if omitted'),
  caption: z.unknown().optional().describe('string; the entity name in an instance model'),
  labels: z.unknown().optional().describe('string[]; the node type, e.g. ["Person"]'),
  properties: z.unknown().optional().describe('{name: string}; type names in a schema model, literals in an instance model'),
});
const relationshipShape = z.looseObject({
  id: z.unknown().optional().describe('string; generated if omitted'),
  fromId: z.unknown().describe('string; id of the source node'),
  toId: z.unknown().describe('string; id of the target node'),
  type: z.unknown().describe('string, UPPER_SNAKE_CASE, e.g. ACTED_IN'),
  properties: z.unknown().optional().describe('{name: string}'),
});

const GRAPH_DESCRIPTION = 'an arrows .arrows JSON graph {nodes, relationships, style} - from a previous tool result or a user-supplied .arrows file';

// Only build names its fields: the other tools take user-supplied files, and a malformed one must
// reach the engine to be reported (G5).
const buildGraphArg = z
  .looseObject({
    nodes: z.array(nodeShape),
    relationships: z.array(relationshipShape).optional(),
    style: z.record(z.string(), z.unknown()).optional(),
  })
  .describe(GRAPH_DESCRIPTION);

const graphArg = z.record(z.string(), z.unknown()).describe(GRAPH_DESCRIPTION);

/** Takes the formats it actually affects, so neither tool can claim to honour it where it does not. */
const backgroundArg = (appliesTo: string) =>
  z
    .enum(['themed', 'transparent'])
    .optional()
    .describe(
      `applies to ${appliesTo}; default "themed". "transparent" drops the backdrop so the diagram ` +
        'takes on whatever is behind it (useful on a dark page), at the cost of the mask boxes that ' +
        'hide a relationship line running behind property text.',
    );

function pngBlock(svg: string, options?: RenderOptions): Content {
  return { type: 'image', data: pngFromSvg(svg, options).toString('base64'), mimeType: 'image/png' };
}

// svg is delivered twice: structuredContent feeds the inline MCP App, the text block is the only
// copy a client that cannot mount the app can render. Raw, not fenced - a code fence shows up as
// visible ``` lines around the diagram.
function graphResult(json: GraphJson, note: string) {
  const svg = renderSvg(json);
  const id = store(json);
  return {
    content: [
      { type: 'text', text: `${note}\n${json.nodes.length} node(s), ${json.relationships.length} relationship(s)\nid: ${id} - pass this as \`id\` instead of re-sending the graph` },
      pngBlock(svg),
      { type: 'text', text: svg },
      { type: 'text', text: '```arrows-json\n' + JSON.stringify(json) + '\n```' },
      { type: 'text', text: verificationChecklist(json) },
    ] as Content[],
    structuredContent: { svg },
  };
}

// Surfaced to the model whenever this server is connected, not only when it is already
// considering a specific tool - a tool's own description only gets weighed once that tool is
// already in view, so the choice to reach for this server at all has to be made here.
const SERVER_INSTRUCTIONS =
  'Whenever asked to model, design, sketch, or diagram a graph data model - nodes and ' +
  'relationships, an entity-relationship diagram, a schema, a knowledge graph - use these tools ' +
  '(arrows_build first, then arrows_edit/arrows_layout/arrows_render/arrows_export as needed) ' +
  'rather than drawing it another way. Never substitute Mermaid, ASCII art, or a text-only ' +
  "description for an actual rendered diagram when this server is available - it is the actual " +
  'diagram, not a placeholder for one. Always end by actually showing the rendered image in the ' +
  'chat: follow the instructions returned with each result (copy the <svg> markup into an ' +
  'image/svg+xml artifact if the diagram is not already visible) - a tool call without a diagram ' +
  'the user can see is not a completed request.';

async function main(): Promise<void> {
  const server = new McpServer(
    {
      name: 'arrows',
      version: __VERSION__,
      title: 'Neo4j Arrows',
      icons: [
        { src: iconPng, mimeType: 'image/png', sizes: ['512x512'] },
        { src: iconSvg, mimeType: 'image/svg+xml', sizes: ['any'] },
      ],
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerResource(
    'Arrows diagram',
    UI_RESOURCE_URI,
    { mimeType: UI_MIME_TYPE },
    async () => ({
      contents: [{ uri: UI_RESOURCE_URI, mimeType: UI_MIME_TYPE, text: UI_VIEW_HTML }],
    }),
  );

  server.registerTool(
    'arrows_build',
    {
      title: 'Build graph model',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Create a graph from .arrows JSON - the same {nodes, relationships, style} shape every ' +
        'tool here returns. A node needs only an id and a caption or labels; a relationship needs ' +
        'fromId and toId (node ids) and a type in UPPER_SNAKE_CASE, like ACTED_IN. Positions, missing ' +
        'ids and layout are filled in for you - do not invent coordinates. ' +
        'Schema model (data model, ER diagram): one node per label, labels: ["Person"], no caption, ' +
        'property values are type names (string, integer, float, boolean, datetime, list<string>). ' +
        'Instance model (example data): caption is the entity name, labels its type, property values ' +
        'are literals. Never mix type names and literals in one graph. Aim for 5-15 nodes; split a ' +
        'larger domain into several diagrams. Example: {"nodes":[{"id":"p","labels":["Person"],' +
        '"properties":{"name":"string"}},{"id":"m","labels":["Movie"],"properties":{"title":"string"}}],' +
        '"relationships":[{"fromId":"p","toId":"m","type":"ACTED_IN"}]}. ' +
        'Returns the .arrows JSON, a PNG, the SVG markup, and a verification checklist.',
      inputSchema: {
        graph: buildGraphArg,
        layout: layoutEnum.optional().describe(`omit to auto-pick from the graph's shape (recommended). ${LAYOUT_GUIDANCE}`),
        theme: z
          .enum([...THEME_NAMES, 'none'] as unknown as [string, ...string[]])
          .optional()
          .describe('visual theme; default Bloom (colour per entity type). "none" leaves the graph unstyled.'),
      },
      outputSchema: { svg: z.string() },
      _meta: UI_TOOL_META,
    },
    async (args) => {
      const result = await build(asGraph(args.graph), args.layout as LayoutId | undefined, args.theme as string | undefined);
      const out = graphResult(result.json, 'Built graph model.');
      if (result.errors.length) out.content.push({ type: 'text', text: `Warnings: ${result.errors.join('; ')}` });
      return out;
    },
  );

  server.registerTool(
    'arrows_edit',
    {
      title: 'Edit graph model',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description:
        'Change a graph with JSON Pointer ops. Three ops cover everything: ' +
        '{"op":"set","path":"/nodes/n5/properties/name","value":"integer"}, ' +
        '{"op":"remove","path":"/nodes/n5"} (its relationships go too), ' +
        '{"op":"insert","path":"/nodes/-","value":{"caption":"Refund"}} (positioned for you - do not ' +
        'invent coordinates). A node or relationship is addressed by id, so /nodes/n5 not /nodes/3. ' +
        'Reachable: caption, labels (/labels/- to add, /labels/<value> to remove), properties, style, ' +
        'position, a relationship type or endpoint, and graph style at /style/<key>. Property and ' +
        'style values must be strings. Ops apply in order; a bad one is reported by index and does ' +
        'not block the rest, so use the returned graph rather than re-sending the batch. ' +
        'Returns the updated JSON, a PNG, the SVG markup, and a verification checklist.',
      inputSchema: {
        id: idArg,
        graph: graphArg.optional(),
        ops: z.array(pathOpSchema).min(1).max(MAX_OPS),
      },
      outputSchema: { svg: z.string() },
      _meta: UI_TOOL_META,
    },
    async (args) => {
      const { ops, errors: parseErrors } = parseOps(args.ops);
      const result = edit(resolveGraph(args), ops);
      const errors = [...parseErrors, ...result.errors];
      const out = graphResult(result.json, 'Applied edits.');
      // Partial success returns a usable graph, so only a batch where nothing applied is an error.
      const nothingApplied = errors.length >= args.ops.length;
      if (errors.length) out.content.push({ type: 'text', text: `${nothingApplied ? 'Errors' : 'Some ops failed'}: ${errors.join('; ')}` });
      return { ...out, isError: nothingApplied };
    },
  );

  server.registerTool(
    'arrows_validate',
    {
      title: 'Validate / review graph model',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Check a graph that did not come from these tools - a user-supplied .arrows file - before ' +
        'rendering it. Reports duplicate ids, missing required fields, unknown style keys, and ' +
        'relationships whose endpoints are missing; those are dropped on load, so they appear in no ' +
        'render or export. A graph returned by arrows_build or arrows_edit is already normalised.',
      inputSchema: { id: idArg, graph: graphArg.optional() },
    },
    async (args) => {
      const diags = validate(resolveGraph(args));
      const location = (d: Diagnostic): string | undefined =>
        d.path ?? (d.anchor && [d.anchor.kind, d.anchor.id, d.anchor.key].filter(Boolean).join(':'));
      const text = diags.length
        ? diags.map((d) => `[${d.severity}] ${d.code}: ${d.message}${location(d) ? ` (${location(d)})` : ''}`).join('\n')
        : 'No issues found.';
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'arrows_layout',
    {
      title: 'Auto-layout graph',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Reposition nodes; labels, properties and relationships are untouched. Use after ' +
        'arrows_edit has added nodes, or when a diagram reads badly. Returns the updated JSON, a ' +
        'PNG, the SVG markup, and a verification checklist.',
      inputSchema: {
        // Named `layout` to match arrows_build. Under any other name zod would strip it and the
        // graph would be silently laid out with the auto-picked algorithm instead.
        id: idArg,
        graph: graphArg.optional(),
        layout: layoutEnum.optional().describe(`omit to auto-pick from the graph's shape (recommended). ${LAYOUT_GUIDANCE}`),
      },
      outputSchema: { svg: z.string() },
      _meta: UI_TOOL_META,
    },
    async (args) => {
      const result = await layout(resolveGraph(args), args.layout as LayoutId | undefined);
      return graphResult(result.json, `Applied ${result.algorithm} layout.`);
    },
  );

  server.registerTool(
    'arrows_render',
    {
      title: 'Render graph as image',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Re-render an existing graph without changing it. arrows_build, arrows_edit and ' +
        'arrows_layout already return a diagram, so only reach for this to change how it is ' +
        'rendered - a transparent background, or the markup without the image. format "png" ' +
        '(default) returns the PNG and the SVG markup; format "svg" omits the PNG. The theme is ' +
        'fixed at build time; call arrows_build again to change it.',
      inputSchema: {
        id: idArg,
        graph: graphArg.optional(),
        format: z.enum(['png', 'svg']).optional().describe('default "png"'),
        background: backgroundArg('both formats'),
      },
      outputSchema: { svg: z.string() },
      _meta: UI_TOOL_META,
    },
    async (args) => {
      const graph = resolveGraph(args);
      const options = { transparent: args.background === 'transparent' };
      const svg = renderSvg(graph, options);
      const guidance: Content = { type: 'text', text: verificationChecklist(graph) };
      const markup: Content = { type: 'text', text: svg };
      const content = args.format === 'svg' ? [markup, guidance] : [pngBlock(svg, options), markup, guidance];
      return { content, structuredContent: { svg } };
    },
  );

  server.registerTool(
    'arrows_export',
    {
      title: 'Export graph model',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Export a graph to another format. format: "cypher" (schema constraints for a type model, or a literal CREATE for instance data - see cypherStyle), "graphql" (Neo4j GraphQL type defs), "svg" (SVG markup), "json" (canonical .arrows JSON), or "url" (arrows.app share link).',
      inputSchema: {
        id: idArg,
        graph: graphArg.optional(),
        format: z
          .enum(['cypher', 'graphql', 'svg', 'json', 'url'])
          .describe('"svg" is the same markup arrows_render returns; "url" is the arrows.app share link'),
        background: backgroundArg('format "svg" only'),
        cypherKeyword: z.enum(CYPHER_KEYWORDS).optional().describe('for format=cypher data style; default CREATE'),
        cypherStyle: z
          .enum(CYPHER_STYLES)
          .optional()
          .describe(
            'for format=cypher. "schema" emits property-type constraints (use when property values are type names like "string"/"integer"); "data" emits a literal CREATE of the graph as instance data; "auto" (default) picks schema when every property value names a type.',
          ),
      },
    },
    async (args) => {
      const graph = resolveGraph(args);
      switch (args.format) {
        case 'cypher':
          return { content: [{ type: 'text', text: toCypher(graph, args.cypherKeyword, args.cypherStyle) }] };
        case 'graphql':
          return { content: [{ type: 'text', text: toGraphQL(graph) }] };
        case 'svg': {
          // Carries the checklist too, or this becomes the one path to a diagram with no
          // do-not-redraw instruction attached.
          const svg = renderSvg(graph, { transparent: args.background === 'transparent' });
          return { content: [{ type: 'text', text: svg }, { type: 'text', text: verificationChecklist(graph) }] };
        }
        case 'json':
          return { content: [{ type: 'text', text: JSON.stringify(normalize(graph), null, 2) }] };
        case 'url': {
          const share = shareUrl(graph);
          const info =
            'This link embeds the entire graph, so it is thousands of characters long - present it as ' +
            'the markdown link above so it stays short on screen, never as a bare url. Nothing is ' +
            'uploaded: the graph travels inside the link itself and arrows.app decodes it locally.';
          const text = [`[Open in arrows.app](${share.url})`, info, share.warning].filter(Boolean).join('\n\n');
          return { content: [{ type: 'text', text }] };
        }
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`arrows-mcp fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
