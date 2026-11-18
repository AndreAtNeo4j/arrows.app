// Synthetic sample data for a schema model, as Cypher. Deterministic: the same model and size
// always give the same data, so a result can be reproduced and nothing needs to be stored.
//
// Measured constraints this is shaped around (Relate 0.1.3):
//  - one statement may not commit more than ~64 MB, so every statement is chunked;
//  - wiring relationships with MATCH ... MATCH ... CREATE is quadratic without an index (40 s for
//    10k rels); collecting both ends into lists and indexing them is linear.
import type { Graph } from '@neo4j-arrows/model';
import { escapeId, parseType } from './schema';

export const FANOUT = 3;
// Relationship wiring cost grows with the square of the row count here (0.4s per statement at 5k
// rows, 5s at 20k), so the cap is what keeps a call inside its time limit.
export const MAX_SEED = 10_000;
const CHUNK = 20_000;

/** One value per row, driven by the row number `i`; every form satisfies its own `IS :: TYPE`. */
const VALUE: Record<string, string> = {
  STRING: "'v' + toString(i)",
  INTEGER: 'i',
  FLOAT: 'toFloat(i) * 0.5',
  BOOLEAN: 'i % 2 = 0',
  DATE: "date('2020-01-01') + duration({days: i % 3650})",
  'ZONED DATETIME': 'datetime({epochSeconds: 1700000000 + i * 60})',
  'LOCAL DATETIME': "localdatetime('2020-01-01T00:00:00') + duration({minutes: i})",
  'ZONED TIME': "time('12:00:00Z') + duration({minutes: i % 600})",
  'LOCAL TIME': "localtime('12:00:00') + duration({minutes: i % 600})",
  DURATION: 'duration({seconds: i})',
  POINT: 'point({x: toFloat(i), y: toFloat(i)})',
};

/** An unrecognised type name ("enum") still gets a value, as the schema export skips its constraint. */
function valueFor(raw: unknown): string {
  const t = parseType(raw);
  const one = VALUE[t?.cypher ?? 'STRING'];
  return t?.list ? `[${one}, ${one.replace(/\bi\b/g, '(i + 1)')}]` : one;
}

const propMap = (props: Record<string, unknown>): string =>
  Object.entries(props)
    .map(([k, v]) => `${escapeId(k)}: ${valueFor(v)}`)
    .join(', ');

/** Same label rule as the constraint export: explicit labels, else the caption. */
const labelsOf = (n: { labels?: string[]; caption?: string }): string[] =>
  (n.labels ?? []).length > 0 ? [...(n.labels as string[])].sort() : n.caption ? [n.caption] : [];

const pattern = (labels: string[]): string => labels.map((l) => `:${escapeId(l)}`).join('');

function ranges(total: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < total; a += size) out.push([a, Math.min(a + size, total) - 1]);
  return out;
}

/**
 * `n` rows per distinct label set (a model that draws :Person twice, for a self-relationship, is
 * one group), then FANOUT relationships per source row for each drawn relationship. Uniform: no
 * skew, no supernodes - callers must say so.
 */
export function seedStatements(graph: Graph, n: number, chunk = CHUNK): string[] {
  const rows = Math.max(1, Math.min(Math.floor(n), MAX_SEED));

  const groups = new Map<string, { labels: string[]; props: Record<string, unknown> }>();
  const groupOf = new Map<string, string>();
  for (const node of graph.nodes) {
    const labels = labelsOf(node);
    if (labels.length === 0) continue;
    const key = labels.join(':');
    const g = groups.get(key) ?? { labels, props: {} };
    for (const [k, v] of Object.entries(node.properties ?? {})) g.props[k] ??= v;
    groups.set(key, g);
    groupOf.set(node.id, key);
  }

  const out: string[] = [];
  for (const g of groups.values()) {
    const create = `CREATE (${pattern(g.labels)}${Object.keys(g.props).length ? ` {${propMap(g.props)}}` : ''})`;
    for (const [a, b] of ranges(rows, chunk)) out.push(`UNWIND range(${a + 1}, ${b + 1}) AS i ${create}`);
  }

  const rels = new Map<string, { from: string; to: string; type: string; props: Record<string, unknown> }>();
  for (const r of graph.relationships) {
    const from = groupOf.get(r.fromId);
    const to = groupOf.get(r.toId);
    if (!from || !to) continue;
    const key = `${from}|${r.type}|${to}`;
    const entry = rels.get(key) ?? { from, to, type: r.type, props: {} };
    for (const [k, v] of Object.entries(r.properties ?? {})) entry.props[k] ??= v;
    rels.set(key, entry);
  }
  const perChunk = Math.max(1, Math.floor(chunk / FANOUT));
  for (const r of rels.values()) {
    // A self-relationship is shifted by one so a row does not always point at itself.
    const offset = r.from === r.to ? 1 : 0;
    const props = Object.keys(r.props).length ? ` {${propMap(r.props)}}` : '';
    for (const [a, b] of ranges(rows, perChunk)) {
      out.push(
        `MATCH (a${pattern(groups.get(r.from)!.labels)}) WITH collect(a) AS xs ` +
          `MATCH (b${pattern(groups.get(r.to)!.labels)}) WITH xs, collect(b) AS ys ` +
          `UNWIND range(${a}, ${b}) AS idx UNWIND range(0, ${FANOUT - 1}) AS j ` +
          `WITH xs[idx] AS a, ys[(idx * ${FANOUT} + j + ${offset}) % ${rows}] AS b, idx * ${FANOUT} + j + 1 AS i ` +
          `CREATE (a)-[:${escapeId(r.type)}${props}]->(b)`,
      );
    }
  }
  return out;
}
