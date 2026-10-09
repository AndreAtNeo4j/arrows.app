import type { Graph } from '@neo4j-arrows/model';

/** Neo4j type names a modeller writes as a property value, mapped to each export dialect. */
const TYPES: Record<string, { cypher: string; graphql: string }> = {
  string: { cypher: 'STRING', graphql: 'String' },
  text: { cypher: 'STRING', graphql: 'String' },
  uuid: { cypher: 'STRING', graphql: 'String' },
  int: { cypher: 'INTEGER', graphql: 'Int' },
  integer: { cypher: 'INTEGER', graphql: 'Int' },
  long: { cypher: 'INTEGER', graphql: 'BigInt' },
  bigint: { cypher: 'INTEGER', graphql: 'BigInt' },
  float: { cypher: 'FLOAT', graphql: 'Float' },
  double: { cypher: 'FLOAT', graphql: 'Float' },
  number: { cypher: 'FLOAT', graphql: 'Float' },
  boolean: { cypher: 'BOOLEAN', graphql: 'Boolean' },
  bool: { cypher: 'BOOLEAN', graphql: 'Boolean' },
  date: { cypher: 'DATE', graphql: 'Date' },
  datetime: { cypher: 'ZONED DATETIME', graphql: 'DateTime' },
  localdatetime: { cypher: 'LOCAL DATETIME', graphql: 'LocalDateTime' },
  time: { cypher: 'ZONED TIME', graphql: 'Time' },
  localtime: { cypher: 'LOCAL TIME', graphql: 'LocalTime' },
  duration: { cypher: 'DURATION', graphql: 'Duration' },
  point: { cypher: 'POINT', graphql: 'Point' },
};

interface ParsedType {
  cypher: string;
  graphql: string;
  list: boolean;
  required: boolean;
}

/** Recognises "string", "[Int]!", "DATETIME" etc; returns undefined for literal values. */
export function parseType(value: unknown): ParsedType | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(\[?)\s*([A-Za-z]+)\s*(\]?)\s*(!?)\s*$/.exec(value);
  if (!m) return undefined;
  const [, open, name, close, bang] = m;
  if ((open === '[') !== (close === ']')) return undefined;
  const type = TYPES[name.toLowerCase()];
  if (!type) return undefined;
  return { ...type, list: open === '[', required: bang === '!' };
}

/** A value the modeller means as data, not as a type: quoted, numeric or boolean/null. */
function isLiteralValue(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const v = value.trim();
  if (v === '') return false;
  return /^['"]/.test(v) || /^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/i.test(v);
}

const entityProps = (graph: Graph): unknown[] => [
  ...graph.nodes.flatMap((n) => Object.values(n.properties ?? {})),
  ...graph.relationships.flatMap((r) => Object.values(r.properties ?? {})),
];

/**
 * A schema model names types instead of carrying data. Requiring *every* value to be a known
 * type name would flip a whole graph back to literal output over one unrecognised name
 * ("enum", "uuid"), silently storing type names as data - so unknown names stay schema-ish
 * and only a real literal ('Alice', 42) marks the graph as instance data.
 */
export function isSchemaModel(graph: Graph): boolean {
  const values = entityProps(graph).filter((v) => !(typeof v === 'string' && v.trim() === ''));
  if (values.length === 0) return false;
  if (values.some(isLiteralValue)) return false;
  return values.some((v) => parseType(v) !== undefined);
}

/** Neo4j quotes identifiers in backticks and escapes an internal backtick by doubling it. */
function escapeId(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/`/g, '``')}\``;
}

const slug = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

interface Declared {
  kind: 'node' | 'rel';
  owner: string;
  prop: string;
  type: ParsedType;
}

/**
 * Property-type constraints for a schema model. Property values are type names, so a literal
 * CREATE would store the word "string" as data; constraints are the useful export.
 */
export function toConstraints(graph: Graph): string {
  const declared = new Map<string, Declared>();
  const notes: string[] = [];
  const multiLabel = new Set<string>();

  const collect = (kind: 'node' | 'rel', owner: string, properties: Record<string, unknown>): void => {
    for (const [prop, value] of Object.entries(properties ?? {})) {
      const type = parseType(value);
      const key = `${kind}:${owner}.${prop}`;
      if (!type) {
        notes.push(`// skipped ${owner}.${prop}: unrecognised type ${JSON.stringify(value)}`);
        continue;
      }
      const existing = declared.get(key);
      if (existing && existing.type.cypher !== type.cypher) {
        notes.push(
          `// conflict: ${owner}.${prop} is declared as both ${existing.type.cypher} and ${type.cypher}; kept ${existing.type.cypher}`,
        );
        continue;
      }
      if (!existing) declared.set(key, { kind, owner, prop, type });
    }
  };

  for (const node of graph.nodes) {
    // A model drawn with captions only still needs constraints; the caption is the entity name.
    const labels = (node.labels ?? []).length > 0 ? node.labels : node.caption ? [node.caption] : [];
    if (labels.length > 1) multiLabel.add(labels.join(':'));
    for (const label of labels) {
      collect('node', label, node.properties as Record<string, unknown>);
    }
  }
  for (const rel of graph.relationships) {
    collect('rel', rel.type, rel.properties as Record<string, unknown>);
  }

  // The constraint name is what Neo4j uses for IF NOT EXISTS, so a collision would silently
  // drop a constraint; names are namespaced by kind and de-duplicated after slugging.
  const usedNames = new Set<string>();
  const nameFor = (d: Declared, suffix: string): string => {
    const base = `${d.kind}_${slug(d.owner)}_${slug(d.prop)}_${suffix}`;
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let n = 2;
    while (usedNames.has(`${base}_${n}`)) n += 1;
    usedNames.add(`${base}_${n}`);
    return `${base}_${n}`;
  };

  const statements: string[] = [];
  for (const d of declared.values()) {
    const pattern = d.kind === 'node' ? `(n:${escapeId(d.owner)})` : `()-[r:${escapeId(d.owner)}]-()`;
    const variable = d.kind === 'node' ? 'n' : 'r';
    const cypherType = d.type.list ? `LIST<${d.type.cypher} NOT NULL>` : d.type.cypher;
    statements.push(
      `CREATE CONSTRAINT ${nameFor(d, 'type')} IF NOT EXISTS\n` +
        `FOR ${pattern} REQUIRE ${variable}.${escapeId(d.prop)} IS :: ${cypherType};`,
    );
    if (d.type.required) {
      statements.push(
        `CREATE CONSTRAINT ${nameFor(d, 'exists')} IF NOT EXISTS\n` +
          `FOR ${pattern} REQUIRE ${variable}.${escapeId(d.prop)} IS NOT NULL;`,
      );
    }
  }

  const header = [
    '// Property type constraints - Neo4j 5.9+, Enterprise Edition only.',
    '// (Community Edition supports uniqueness constraints but not type/existence constraints.)',
    '// Uniqueness and node keys are not inferred - add them yourself where a property is a key.',
  ];
  for (const labels of multiLabel) {
    header.push(
      `// note: :${labels} is one multi-label node, but a constraint targets a single label, so each applies to every node with that label.`,
    );
  }
  if (statements.length === 0) {
    return [...header, ...notes, '// no typed properties to constrain'].join('\n');
  }
  return [...header, ...statements, ...notes].join('\n');
}

/**
 * Rewrites property values into GraphQL scalars so the SDL loads. Unrecognised names and
 * literal values are guessed rather than passed through, which would emit invalid SDL.
 */
export function withGraphqlScalars(graph: Graph): { graph: Graph; notes: string[] } {
  const notes: string[] = [];

  const scalarFor = (owner: string, key: string, value: unknown): string => {
    const type = parseType(value);
    if (type) {
      const inner = type.list ? `[${type.graphql}${type.required ? '!' : ''}]` : type.graphql;
      return type.required ? `${inner}!` : inner;
    }
    const raw = typeof value === 'string' ? value.trim() : String(value);
    if (/^-?\d+$/.test(raw)) return 'Int';
    if (/^-?\d+\.\d+$/.test(raw)) return 'Float';
    if (/^(true|false)$/i.test(raw)) return 'Boolean';
    notes.push(`# ${owner}.${key}: ${JSON.stringify(value)} is not a known type, using String`);
    return 'String';
  };

  const convert = (owner: string, properties: Record<string, unknown> = {}): Record<string, unknown> =>
    Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, scalarFor(owner, key, value)]));

  const converted = {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      properties: convert((n.labels ?? [])[0] ?? n.caption ?? 'Node', n.properties as Record<string, unknown>),
    })),
    relationships: graph.relationships.map((r) => ({
      ...r,
      properties: convert(r.type, r.properties as Record<string, unknown>),
    })),
  } as Graph;

  return { graph: converted, notes };
}
