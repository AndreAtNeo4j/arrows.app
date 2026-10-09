import type { LayoutId } from 'engine/layout';

interface MinimalGraph {
  nodes: { id: string }[];
  relationships: { fromId: string; toId: string }[];
}

/** Picks the layout matching the graph's shape; see arrows-code's layout/index.ts for each intent. */
export function chooseLayout(graph: MinimalGraph): LayoutId {
  const { nodes, relationships } = graph;
  if (relationships.length === 0) return 'grid';

  const degree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const r of relationships) {
    bump(degree, r.fromId);
    bump(degree, r.toId);
    bump(inDegree, r.toId);
  }

  const totalDegree = relationships.length * 2;
  const maxDegree = Math.max(0, ...degree.values());
  if (maxDegree >= 3 && maxDegree / totalDegree >= 0.4) return 'radial';

  // Kahn's algorithm: repeatedly strip zero-indegree nodes. If every node can be removed
  // this way, the graph has no cycle - a tree/DAG shape that reads best top-down.
  const adjacency = new Map<string, string[]>();
  for (const r of relationships) adjacency.set(r.fromId, [...(adjacency.get(r.fromId) ?? []), r.toId]);
  const remaining = new Map(nodes.map((n) => [n.id, inDegree.get(n.id) ?? 0]));
  const queue = [...remaining.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let processed = 0;
  while (queue.length) {
    const id = queue.shift() as string;
    processed += 1;
    for (const next of adjacency.get(id) ?? []) {
      const d = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (processed === nodes.length) return 'hierarchical';

  if (nodes.length <= 8 && relationships.length >= nodes.length) return 'circular';
  return 'force';
}

interface PlacedGraph {
  nodes: { id: string; position: { x: number; y: number }; properties?: Record<string, unknown>; style?: Record<string, unknown> }[];
  relationships: { fromId: string; toId: string; type?: string; properties?: Record<string, unknown> }[];
  style?: Record<string, unknown>;
}

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const count = (o: Record<string, unknown> | undefined): number => Object.keys(o ?? {}).length;

// Property text hangs outside the circle, so a node occupies more than its radius.
function footprintRadius(n: PlacedGraph['nodes'][number], graph: PlacedGraph): number {
  const r = Number(n.style?.radius ?? graph.style?.radius);
  const body = Number.isFinite(r) && r > 0 ? r : 50;
  return body + (count(n.properties) ? 30 + count(n.properties) * 12 : 0);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const segmentsCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean =>
  cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

const boxesOverlap = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

const circleHitsBox = (c: Pt & { r: number }, b: Box): boolean =>
  Math.abs(c.x - b.x) < b.w / 2 + c.r && Math.abs(c.y - b.y) < b.h / 2 + c.r;

/** `hard` is content hidden by another element; `soft` is clutter that still reads. */
export function layoutScore(graph: PlacedGraph): { hard: number; soft: number } {
  const byId = new Map(graph.nodes.map((n) => [n.id, { ...n.position, r: footprintRadius(n, graph), id: n.id }]));
  const edges = graph.relationships
    .filter((r) => r.fromId !== r.toId && byId.has(r.fromId) && byId.has(r.toId))
    .map((r) => ({ a: byId.get(r.fromId)!, b: byId.get(r.toId)!, rel: r }));
  const nodes = [...byId.values()];
  let hard = 0;
  let soft = 0;

  for (const { a, b } of edges)
    for (const n of nodes) if (n !== a && n !== b && distToSegment(n, a, b) < n.r + 15) hard += 10;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < nodes[i].r + nodes[j].r + 20) hard += 10;

  // A label sits at the edge midpoint, rotated along the edge; its axis-aligned extent is what blocks.
  const labels = edges.map(({ a, b, rel }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const cos = Math.abs(b.x - a.x) / length;
    const sin = Math.abs(b.y - a.y) / length;
    const along = Math.max(50, (rel.type?.length ?? 0) * 11);
    const thick = 26 + count(rel.properties) * 22;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: cos * along + sin * thick, h: sin * along + cos * thick, ends: [a, b] };
  });
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) if (boxesOverlap(labels[i], labels[j])) soft += 8;
    for (const n of nodes) if (!labels[i].ends.includes(n) && circleHitsBox(n, labels[i])) hard += 8;
  }

  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const { a, b } = edges[i];
      const { a: c, b: d } = edges[j];
      if (a !== c && a !== d && b !== c && b !== d && segmentsCross(a, b, c, d)) soft += 3;
    }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const w = Math.max(...xs) - Math.min(...xs) + 300;
  const h = Math.max(...ys) - Math.min(...ys) + 300;
  // A strip-shaped diagram is downscaled until its text is unreadable.
  return { hard, soft: soft + Math.max(0, Math.max(w / h, h / w) - 1.6) * 4 };
}

// Hidden content costs more than clutter that still reads.
const HARD_WEIGHT = 3;
// How much worse than the tidiest layout the shape heuristic's pick may be and still win.
const PREFERRED_SLACK = 25;

const total = ({ hard, soft }: { hard: number; soft: number }): number => hard * HARD_WEIGHT + soft;

/** Lowest weighted score wins; the shape heuristic's pick keeps the win unless clearly worse. */
export async function pickLayout<G extends PlacedGraph>(
  graph: G,
  run: (graph: G, id: LayoutId) => Promise<G>,
): Promise<{ graph: G; algorithm: LayoutId }> {
  const preferred = chooseLayout(graph);
  if (preferred === 'grid') return { graph: await run(graph, 'grid'), algorithm: 'grid' };
  const candidates: LayoutId[] = [preferred, ...(['hierarchical', 'force', 'radial', 'circular'] as const).filter((l) => l !== preferred)];
  const scored = [];
  for (const algorithm of candidates) {
    const laidOut = await run(graph, algorithm);
    scored.push({ graph: laidOut, algorithm, score: total(layoutScore(laidOut)) });
  }
  const best = scored.reduce((a, b) => (b.score < a.score ? b : a));
  return scored[0].score <= best.score + PREFERRED_SLACK ? scored[0] : best;
}
