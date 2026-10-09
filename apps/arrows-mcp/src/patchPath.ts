import type { GraphJson } from './engine';

export const PATH_OPS = ['set', 'remove', 'insert'] as const;
export const MAX_OPS = 200;
const MAX_STRING = 20_000;
// The circle-fitting word-wrap layout search (libs/graphics/utils/circleWordWrap.ts) that renders
// a caption re-measures a growing line on every word and re-runs a swap-refinement pass; its cost
// grows highly superlinearly with caption length - 400 chars measured ~3.6s, 800 chars ~27s, for
// ONE node. A cap here, not in that shared renderer, keeps the fix scoped to this server's input.
export const MAX_CAPTION = 120;

export interface PathOp {
  op: (typeof PATH_OPS)[number];
  path: string;
  value?: unknown;
}

interface Entity {
  id?: string;
  labels?: unknown;
  properties?: Record<string, unknown>;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

const NEW_NODE_GAP = 280;

const decode = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');

function segments(path: string): string[] {
  if (!path.startsWith('/')) throw new Error('path must start with "/"');
  return path.slice(1).split('/').map(decode);
}

/**
 * By id only. Every node/relationship reaching this code has a string id (build() and the
 * normalize() at the start of edit() both guarantee it), so a numeric ref that matches no id is
 * a mistaken array index, not a valid address - silently accepting it would edit the wrong entity.
 */
function indexOf(list: Entity[], ref: string): number {
  return list.findIndex((e) => e.id === ref);
}

function nextId(list: Entity[], prefix: string): string {
  const taken = new Set(list.map((e) => e.id));
  for (let i = 0; ; i++) if (!taken.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

/**
 * A column beside the graph, stacked downwards. Anchored to the graph as it was before the batch:
 * recomputing per op would push each insert further right and rebuild the wide row this avoids.
 */
function slots(nodes: Entity[]): () => { x: number; y: number } {
  const points = nodes
    .map((n) => n.position as { x?: number; y?: number } | undefined)
    .filter((p): p is { x: number; y: number } => typeof p?.x === 'number' && typeof p?.y === 'number');
  const x = points.length ? Math.max(...points.map((p) => p.x)) + NEW_NODE_GAP : 0;
  const top = points.length ? Math.min(...points.map((p) => p.y)) : 0;
  let taken = 0;
  return () => ({ x, y: top + NEW_NODE_GAP * taken++ });
}

const collectionOf = (json: GraphJson, name: string): Entity[] => {
  if (name !== 'nodes' && name !== 'relationships') throw new Error(`unknown collection "${name}"`);
  return json[name] as Entity[];
};

/**
 * Applies generic JSON Pointer ops. Deliberately not routed through engine/patch's 16-op `apply`:
 * half of these paths (removing a style key, repointing fromId) have no op there. The guarantees it
 * provided are kept explicitly below - cascade, duplicate ids, endpoint integrity, string values.
 */
export function applyPathOps(input: GraphJson, ops: PathOp[]): { json: GraphJson; errors: string[] } {
  if (ops.length > MAX_OPS) throw new Error(`${ops.length} ops exceeds the limit of ${MAX_OPS}; split into smaller batches`);
  let json = structuredClone(input);
  const errors: string[] = [];
  const nextSlot = slots(json.nodes as Entity[]);
  ops.forEach((op, i) => {
    try {
      json = applyOne(json, op, nextSlot);
    } catch (error) {
      errors.push(`op ${i} (${op.op} ${op.path}): ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { json, errors };
}

function applyOne(json: GraphJson, { op, path, value }: PathOp, nextSlot: () => { x: number; y: number }): GraphJson {
  const seg = segments(path);
  if (seg[0] === 'style') return graphStyle(json, op, seg, value);
  const list = collectionOf(json, seg[0]);

  if (seg.length === 1) throw new Error('a whole collection cannot be replaced; address an entity');
  if (seg.length === 2) return entityOp(json, seg[0], list, op, seg[1], value, nextSlot);

  const idx = indexOf(list, seg[1]);
  if (idx === -1) throw new Error(`${seg[0] === 'nodes' ? 'node' : 'relationship'} "${seg[1]}" not found`);
  const next = [...list];
  next[idx] = fieldOp(next[idx], op, seg.slice(2), value, json);
  return { ...json, [seg[0]]: next };
}

function graphStyle(json: GraphJson, op: string, seg: string[], value: unknown): GraphJson {
  if (seg.length !== 2) throw new Error('graph style is addressed as /style/<key>');
  const style = { ...(json.style ?? {}) };
  if (op === 'remove') delete style[seg[1]];
  else style[seg[1]] = requireString(value, `style/${seg[1]}`);
  return { ...json, style };
}

function entityOp(json: GraphJson, name: string, list: Entity[], op: string, ref: string, value: unknown, nextSlot: () => { x: number; y: number }): GraphJson {
  if (op === 'insert') {
    const entity = { ...(asRecord(value, 'insert') as Entity) };
    if (ref !== '-') throw new Error('insert appends, so the path must end in "/-"');
    entity.id = typeof entity.id === 'string' ? entity.id : nextId(list, name === 'nodes' ? 'n' : 'r');
    if (list.some((e) => e.id === entity.id)) throw new Error(`id "${entity.id}" already exists`);
    if (name === 'nodes') {
      const p = entity.position as { x?: unknown; y?: unknown } | undefined;
      if (typeof p?.x !== 'number' || typeof p?.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        entity.position = nextSlot();
      }
      entity.caption = entity.caption === undefined ? '' : requireCaption(entity.caption);
      entity.labels = stringArray(entity.labels, 'labels', []);
    } else {
      for (const end of ['fromId', 'toId'] as const) {
        const id = entity[end];
        if (typeof id !== 'string') throw new Error(`${end} must be a string, got ${typeof id}`);
        if (!(json.nodes as Entity[]).some((n) => n.id === id)) throw new Error(`${end} "${id}" is not a node`);
      }
      if (typeof entity.type !== 'string' || entity.type === '') throw new Error('type must be a non-empty string');
    }
    entity.properties = stringRecord(entity.properties, 'properties', {});
    entity.style = stringRecord(entity.style, 'style', {});
    return { ...json, [name]: [...list, entity] };
  }

  const idx = indexOf(list, ref);
  if (idx === -1) throw new Error(`${name === 'nodes' ? 'node' : 'relationship'} "${ref}" not found`);
  if (op === 'set') {
    const given = asRecord(value, 'set') as Entity;
    const entity: Entity = {
      ...given,
      id: list[idx].id,
      properties: stringRecord(given.properties, 'properties', {}),
      style: stringRecord(given.style, 'style', {}),
    };
    if ('labels' in given) entity.labels = stringArray(given.labels, 'labels', []);
    if (name === 'nodes' && 'caption' in given) entity.caption = requireCaption(given.caption);
    const next = [...list];
    next[idx] = entity;
    return { ...json, [name]: next };
  }
  const removedId = list[idx].id;
  const kept = list.filter((_, i) => i !== idx);
  if (name === 'relationships') return { ...json, relationships: kept };
  // A node's relationships would otherwise dangle; readGraph drops them with only a warning.
  return {
    ...json,
    nodes: kept,
    relationships: (json.relationships as Entity[]).filter((r) => r.fromId !== removedId && r.toId !== removedId),
  };
}

function fieldOp(entity: Entity, op: string, seg: string[], value: unknown, json: GraphJson): Entity {
  const [field, key] = seg;

  // Checked ahead of the generic remove-guard below: "cannot be removed, set it instead" would be
  // actively misleading here, since an id cannot be set either.
  if (field === 'id') throw new Error('an id is immutable; remove and insert instead');
  if (field === 'labels') return labelOp(entity, op, key, value);

  if (field === 'properties' || field === 'style') {
    if (key === undefined) throw new Error(`address a single key as /${field}/<key>`);
    const map = { ...((entity[field] as Record<string, unknown>) ?? {}) };
    if (op === 'remove') delete map[key];
    else map[key] = requireString(value, `${field}/${key}`);
    return { ...entity, [field]: map };
  }

  if (op === 'remove') throw new Error(`"${field}" cannot be removed; set it instead`);
  if (field === 'position') return { ...entity, position: position(entity, seg, value) };
  if (field === 'fromId' || field === 'toId') {
    const id = requireString(value, field);
    if (!(json.nodes as Entity[]).some((n) => n.id === id)) throw new Error(`${field} "${id}" is not a node`);
    return { ...entity, [field]: id };
  }
  if (field === 'caption') return { ...entity, caption: requireCaption(value) };
  return { ...entity, [field]: requireString(value, field) };
}

function labelOp(entity: Entity, op: string, key: string | undefined, value: unknown): Entity {
  const labels = stringArray(entity.labels, 'labels', []);
  if (op === 'insert') {
    if (key !== '-') throw new Error('insert appends, so the path must end in "/labels/-"');
    const label = requireString(value, 'label');
    return labels.includes(label) ? entity : { ...entity, labels: [...labels, label] };
  }
  if (key === undefined) throw new Error('address a label by value or index');
  // By value, since a model knows the label it wants gone but not its index.
  const idx = /^\d+$/.test(key) ? Number(key) : labels.indexOf(key);
  if (idx < 0 || idx >= labels.length) throw new Error(`label "${key}" not found`);
  if (op === 'remove') return { ...entity, labels: labels.filter((_, i) => i !== idx) };
  const next = [...labels];
  next[idx] = requireString(value, 'label');
  return { ...entity, labels: next };
}

function position(entity: Entity, seg: string[], value: unknown): { x: number; y: number } {
  const current = (entity.position ?? { x: 0, y: 0 }) as { x: number; y: number };
  if (seg.length === 1) {
    const next = asRecord(value, 'position');
    if (typeof next.x !== 'number' || typeof next.y !== 'number' || !Number.isFinite(next.x) || !Number.isFinite(next.y)) {
      throw new Error('position needs finite numeric x and y');
    }
    return { x: next.x, y: next.y };
  }
  if (seg[1] !== 'x' && seg[1] !== 'y') throw new Error('position has only x and y');
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`position/${seg[1]} must be a finite number`);
  return { ...current, [seg[1]]: value };
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} must be a string, got ${typeof value}`);
  if (value.length > MAX_STRING) throw new Error(`${what} exceeds ${MAX_STRING} characters`);
  return value;
}

function requireCaption(value: unknown): string {
  const caption = requireString(value, 'caption');
  if (caption.length > MAX_CAPTION) {
    throw new Error(`caption exceeds ${MAX_CAPTION} characters - put longer text in a property instead`);
  }
  return caption;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} needs an object value`);
  return value as Record<string, unknown>;
}

/** Every value in a properties/style map must be a string; a wrong-typed map is rejected, not silently kept. */
export function stringRecord(value: unknown, what: string, fallback: Record<string, string>): Record<string, string> {
  if (value === undefined) return fallback;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} needs an object value`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) out[k] = requireString(v, `${what}/${k}`);
  return out;
}

export function stringArray(value: unknown, what: string, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) throw new Error(`${what} needs an array of strings`);
  return value.map((v, i) => requireString(v, `${what}[${i}]`));
}
