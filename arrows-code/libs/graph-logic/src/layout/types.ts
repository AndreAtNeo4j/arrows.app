export interface NodeIn {
  id: string;
  position?: { x?: unknown; y?: unknown } | unknown;
  caption?: unknown;
  labels?: unknown;
  properties?: unknown;
  [k: string]: unknown;
}
export interface RelIn { fromId: string; toId: string; [k: string]: unknown }
export interface GraphIn { nodes: NodeIn[]; relationships: RelIn[]; [k: string]: unknown }

export type LayoutProgress = (fraction: number) => void;
export type LayoutFn = (graph: GraphIn, onProgress?: LayoutProgress) => Promise<GraphIn>;

export function applyPositions(
  graph: GraphIn,
  byId: Map<string, { x: number; y: number }>,
): GraphIn {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: byId.get(n.id) ?? n.position,
    })),
  };
}

// 1dp rounding - stable JSON diffs, no 12-digit floats.
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export const NODE_BODY_RADIUS = 80;
export const LABEL_LINE_HEIGHT = 30;

// Approximate node hit-radius (body + label/property lines); used by collision passes and radial ring scaling.
export function effectiveRadius(n: NodeIn): number {
  const labelLines = Array.isArray(n.labels) ? (n.labels as unknown[]).length : 0;
  const propLines = n.properties && typeof n.properties === 'object'
    ? Object.keys(n.properties as Record<string, unknown>).length
    : 0;
  const captionExtra = typeof n.caption === 'string' && n.caption.length > 0 ? 1 : 0;
  return NODE_BODY_RADIUS + (labelLines + propLines + captionExtra) * LABEL_LINE_HEIGHT;
}
