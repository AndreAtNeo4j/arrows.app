// Sugiyama-style layered drawing via Kahn topo sort: https://en.wikipedia.org/wiki/Layered_graph_drawing
// Cyclic-safe: back-edges into already-layered nodes are ignored; pure-cycle nodes land in a leftover layer.

import type { LayoutFn } from './types';
import { applyPositions, round1 } from './types';

const LAYER_HEIGHT = 280;
const LABEL_CHAR_WIDTH = 11;
const LAYER_LABEL_ROOM = 220;
const NODE_SPACING = 340;

export const hierarchical: LayoutFn = async (graph) => {
  if (graph.nodes.length === 0) return graph;
  const ids = graph.nodes.map((n) => n.id).sort();
  const idSet = new Set(ids);

  const inDeg = new Map<string, number>();
  const edgesOut = new Map<string, string[]>();
  for (const id of ids) { inDeg.set(id, 0); edgesOut.set(id, []); }
  for (const r of graph.relationships) {
    if (r.fromId === r.toId) continue;
    if (!idSet.has(r.fromId) || !idSet.has(r.toId)) continue;
    inDeg.set(r.toId, (inDeg.get(r.toId) ?? 0) + 1);
    edgesOut.get(r.fromId)!.push(r.toId);
  }

  // `tentative` carries max(predecessorLayer + 1); a node's layer is committed
  // only when all incoming edges have been processed.
  const remaining = new Map(inDeg);
  const tentative = new Map<string, number>();
  const layer = new Map<string, number>();
  let frontier = ids.filter((id) => (remaining.get(id) ?? 0) === 0);
  for (const id of frontier) layer.set(id, 0);

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const L = layer.get(id)!;
      for (const target of edgesOut.get(id) ?? []) {
        if (layer.has(target)) continue; // back-edge into a layered node
        const candidate = L + 1;
        tentative.set(target, Math.max(tentative.get(target) ?? 0, candidate));
        const remainingForTarget = (remaining.get(target) ?? 0) - 1;
        remaining.set(target, remainingForTarget);
        if (remainingForTarget <= 0) {
          layer.set(target, tentative.get(target)!);
          next.push(target);
        }
      }
    }
    frontier = next;
  }

  // Pure-cycle nodes (no source) go to a leftover layer past the DAG.
  const maxLayer = Math.max(0, ...layer.values());
  for (const id of ids) if (!layer.has(id)) layer.set(id, maxLayer + 1);

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const L = layer.get(id)!;
    if (!byLayer.has(L)) byLayer.set(L, []);
    byLayer.get(L)!.push(id);
  }
  for (const arr of byLayer.values()) arr.sort();

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  // A vertical edge label runs along the edge, so a long relationship type needs a taller gap.
  const longestType = Math.max(0, ...graph.relationships.map((r) => String(r.type ?? '').length));
  const layerHeight = Math.max(LAYER_HEIGHT, longestType * LABEL_CHAR_WIDTH + LAYER_LABEL_ROOM);

  // Barycenter sweeps (down then up) cut crossings; alphabetical order routed edges through nodes.
  // An edge spanning several layers reserves a slot in each one it crosses, so a node there is
  // pushed aside instead of sitting on the straight line.
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  const link = (a: string, b: string) => { neighbours.get(a)!.push(b); neighbours.get(b)!.push(a); };
  for (const [from, tos] of edgesOut) {
    for (const to of tos) {
      let prev = from;
      for (let L = layer.get(from)! + 1; L < layer.get(to)!; L++) {
        const dummy = `\0${from}\0${to}\0${L}`;
        layer.set(dummy, L);
        neighbours.set(dummy, []);
        byLayer.get(L)!.push(dummy);
        link(prev, dummy);
        prev = dummy;
      }
      link(prev, to);
    }
  }
  const slot = new Map<string, number>();
  const order = (L: number, ref: number) => {
    const arr = byLayer.get(L)!;
    const centre = (id: string) => {
      const xs = neighbours.get(id)!.filter((n) => layer.get(n) === ref).map((n) => slot.get(n)!);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : slot.get(id)!;
    };
    const keyed = arr.map((id) => [id, centre(id)] as const);
    keyed.sort((a, b) => a[1] - b[1]);
    byLayer.set(L, keyed.map(([id]) => id));
    byLayer.get(L)!.forEach((id, i) => slot.set(id, i - (arr.length - 1) / 2));
  };
  for (const L of layers) byLayer.get(L)!.forEach((id, i, arr) => slot.set(id, i - (arr.length - 1) / 2));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let i = 1; i < layers.length; i++) order(layers[i], layers[i - 1]);
    for (let i = layers.length - 2; i >= 0; i--) order(layers[i], layers[i + 1]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const L of layers) {
    const arr = byLayer.get(L)!;
    const offsetX = -((arr.length - 1) * NODE_SPACING) / 2;
    for (let i = 0; i < arr.length; i++) {
      positions.set(arr[i], { x: round1(offsetX + i * NODE_SPACING), y: round1(L * layerHeight) });
    }
  }

  return applyPositions(graph, positions);
};
