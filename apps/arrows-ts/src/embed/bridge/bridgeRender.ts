import { renderSvgDom } from '@neo4j-arrows/graphics';
import { apply, findLayout, validate, type LayoutId, type PatchOp } from '@neo4j-arrows/graph-logic';
import { presentGraphFromState } from './shouldEmit';
// @ts-expect-error JS module without local typings.
import { exportCypher } from '../../storage/exportCypher';

// 'svg'/'graphql'/'cypher' render the embed's current graph to text. The graph-op
// kinds run shared graph-logic on the graph the host sends (so a non-JS host can
// use them too) and return the result: validate -> diagnostics, layout/rename -> new graph.
export type RequestKind = 'svg' | 'graphql' | 'cypher' | 'validate' | 'layout' | 'rename';
export type RequestHandler = (state: unknown, payload?: unknown) => string | Promise<string>;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderSvg(state: unknown): string {
  const s = state as { cachedImages?: Record<string, unknown> };
  const graph = presentGraphFromState(state) as Parameters<typeof renderSvgDom>[0];
  const cachedImages = (s.cachedImages ?? {}) as Parameters<typeof renderSvgDom>[1];
  const svgEl = renderSvgDom(graph, cachedImages);
  let svg = new XMLSerializer().serializeToString(svgEl);
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const bg = (graph.style as Record<string, unknown> | undefined)?.['background-color'];
  if (typeof bg === 'string' && bg.trim().length > 0 && bg !== 'transparent' && bg !== 'none') {
    svg = svg.replace(
      /<svg\b([^>]*)>/,
      `<svg$1><rect width="100%" height="100%" fill="${escapeAttr(bg)}"/>`
    );
  }
  return svg;
}

async function renderGraphQL(state: unknown): Promise<string> {
  // @ts-expect-error JS module without local typings.
  const mod = await import('../../graphql/exportGraphQL');
  const exportGraphQL = (mod.default ?? mod) as (g: unknown) => string;
  return exportGraphQL(presentGraphFromState(state));
}

function renderCypher(state: unknown, payload?: unknown): string {
  const keyword =
    (payload as { keyword?: 'CREATE' | 'MERGE' | 'MATCH' } | undefined)?.keyword ?? 'CREATE';
  return exportCypher(presentGraphFromState(state), keyword, { includeStyling: false }) as string;
}

function runValidate(_state: unknown, payload?: unknown): string {
  const graph = (payload as { graph?: unknown } | undefined)?.graph;
  return JSON.stringify(validate(graph as Parameters<typeof validate>[0]));
}

async function runLayout(_state: unknown, payload?: unknown): Promise<string> {
  const { graph, algorithm } = (payload ?? {}) as { graph?: unknown; algorithm?: LayoutId };
  const chosen = findLayout(algorithm ?? 'force') ?? findLayout('force');
  if (!chosen || graph == null) throw new Error('layout: missing graph');
  return JSON.stringify(await chosen.run(graph as Parameters<typeof chosen.run>[0]), null, 2);
}

function runRename(_state: unknown, payload?: unknown): string {
  const { graph, op } = (payload ?? {}) as { graph?: unknown; op?: PatchOp };
  if (graph == null || op == null) throw new Error('rename: missing graph or op');
  const { graph: next, errors } = apply(graph as Parameters<typeof apply>[0], op);
  if (errors.length > 0) throw new Error(errors[0].message);
  return JSON.stringify(next, null, 2);
}

export const requestHandlers: Record<RequestKind, RequestHandler> = {
  svg: renderSvg,
  graphql: renderGraphQL,
  cypher: renderCypher,
  validate: runValidate,
  layout: runLayout,
  rename: runRename,
};
