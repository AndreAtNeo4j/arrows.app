import type { GraphJson } from './engine';

// Bounded so a long conversation cannot grow the process without limit; the oldest entry goes first.
const MAX_GRAPHS = 20;

const graphs = new Map<string, GraphJson>();
let counter = 0;

export function store(json: GraphJson): string {
  const id = `g${++counter}`;
  graphs.set(id, json);
  if (graphs.size > MAX_GRAPHS) graphs.delete(graphs.keys().next().value as string);
  return id;
}

export const recall = (id: string): GraphJson | undefined => graphs.get(id);

/** Test seam: the store outlives a single call by design, so a determinism test has to reset it. */
export function reset(): void {
  graphs.clear();
  counter = 0;
}
