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
  nodes: { id: string; position: { x: number; y: number }; style?: Record<string, unknown> }[];
  relationships: { fromId: string; toId: string }[];
  style?: Record<string, unknown>;
}

const radiusOf = (n: PlacedGraph['nodes'][number], graph: PlacedGraph): number => {
  const r = Number(n.style?.radius ?? graph.style?.radius);
  return Number.isFinite(r) && r > 0 ? r : 50;
};

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

type Pt = { x: number; y: number };
const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const segmentsCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean =>
  cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

/** Lower is better: an edge through a node or two overlapping nodes hides content, so they dominate. */
export function layoutPenalty(graph: PlacedGraph): number {
  const byId = new Map(graph.nodes.map((n) => [n.id, { ...n.position, r: radiusOf(n, graph), id: n.id }]));
  const edges = graph.relationships
    .filter((r) => r.fromId !== r.toId && byId.has(r.fromId) && byId.has(r.toId))
    .map((r) => [byId.get(r.fromId)!, byId.get(r.toId)!] as const);
  const nodes = [...byId.values()];
  let penalty = 0;
  for (const [a, b] of edges)
    for (const n of nodes) if (n !== a && n !== b && distToSegment(n, a, b) < n.r + 15) penalty += 10;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < nodes[i].r + nodes[j].r + 40) penalty += 10;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      if (a !== c && a !== d && b !== c && b !== d && segmentsCross(a, b, c, d)) penalty += 3;
    }
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const w = Math.max(...xs) - Math.min(...xs) + 300;
  const h = Math.max(...ys) - Math.min(...ys) + 300;
  // A strip-shaped diagram is downscaled until its text is unreadable.
  return penalty + Math.max(0, Math.max(w / h, h / w) - 1.6) * 4;
}

/** Runs every candidate and keeps the cleanest; the shape heuristic only breaks ties. */
export async function pickLayout<G extends PlacedGraph>(
  graph: G,
  run: (graph: G, id: LayoutId) => Promise<G>,
): Promise<{ graph: G; algorithm: LayoutId }> {
  const preferred = chooseLayout(graph);
  if (preferred === 'grid') return { graph: await run(graph, 'grid'), algorithm: 'grid' };
  const candidates: LayoutId[] = [preferred, ...(['hierarchical', 'force', 'radial', 'circular'] as const).filter((l) => l !== preferred)];
  let best: { graph: G; algorithm: LayoutId; penalty: number } | undefined;
  for (const algorithm of candidates) {
    const laidOut = await run(graph, algorithm);
    const penalty = layoutPenalty(laidOut);
    if (!best || penalty < best.penalty) best = { graph: laidOut, algorithm, penalty };
  }
  return best!;
}
