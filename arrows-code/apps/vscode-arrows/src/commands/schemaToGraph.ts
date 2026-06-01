import type { SchemaResult } from '@arrows-code/neo4j-client';
import type { GraphIn } from '../layout';

function toProps(properties: { name: string; type: string }[]): Record<string, string> {
  return Object.fromEntries(properties.map((p) => [p.name, p.type]));
}

export function schemaToGraph(schema: SchemaResult): GraphIn {
  const nodes = schema.nodeTypes.map((nt, i) => ({
    id: `n${i}`,
    position: { x: 0, y: 0 },
    caption: nt.labels[0] ?? '',
    labels: nt.labels,
    properties: toProps(nt.properties),
    style: {},
  }));

  const idByLabel = new Map<string, string>();
  for (const node of nodes) {
    const label = node.labels[0];
    if (label && !idByLabel.has(label)) idByLabel.set(label, node.id);
  }

  const relationships = schema.relTypes.flatMap((rt, i) => {
    const fromId = idByLabel.get(rt.from[0] ?? '');
    const toId = idByLabel.get(rt.to[0] ?? '');
    if (!fromId || !toId) return [];
    return [
      {
        id: `r${i}`,
        fromId,
        toId,
        type: rt.type,
        properties: toProps(rt.properties),
        style: {},
      },
    ];
  });

  return { nodes, relationships, style: {} };
}
