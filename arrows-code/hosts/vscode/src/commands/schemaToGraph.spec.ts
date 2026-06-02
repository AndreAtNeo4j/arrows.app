import { describe, it, expect } from 'vitest';
import { schemaToGraph } from './schemaToGraph';
import type { SchemaResult } from '@arrows-code/neo4j-client';

describe('schemaToGraph', () => {
  it('maps each node type to a node with caption, labels, and typed properties', () => {
    const schema: SchemaResult = {
      nodeTypes: [
        {
          labels: ['Person'],
          properties: [
            { name: 'name', type: 'String' },
            { name: 'age', type: 'Long' },
          ],
        },
      ],
      relTypes: [],
    };

    const graph = schemaToGraph(schema);

    expect(graph.nodes).toEqual([
      {
        id: 'n0',
        position: { x: 0, y: 0 },
        caption: 'Person',
        labels: ['Person'],
        properties: { name: 'String', age: 'Long' },
        style: {},
      },
    ]);
    expect(graph.relationships).toEqual([]);
    expect(graph.style).toEqual({});
  });

  it('resolves relationship endpoints by first label', () => {
    const schema: SchemaResult = {
      nodeTypes: [
        { labels: ['User'], properties: [] },
        { labels: ['Post'], properties: [] },
      ],
      relTypes: [
        { type: 'LIKED', from: ['User'], to: ['Post'], properties: [{ name: 'at', type: 'Long' }] },
      ],
    };

    const graph = schemaToGraph(schema);

    expect(graph.relationships).toEqual([
      { id: 'r0', fromId: 'n0', toId: 'n1', type: 'LIKED', properties: { at: 'Long' }, style: {} },
    ]);
  });

  it('drops a relationship whose endpoint label has no matching node', () => {
    const schema: SchemaResult = {
      nodeTypes: [{ labels: ['User'], properties: [] }],
      relTypes: [{ type: 'GHOST', from: ['User'], to: ['Missing'], properties: [] }],
    };

    expect(schemaToGraph(schema).relationships).toEqual([]);
  });

  it('returns an empty graph for an empty schema', () => {
    expect(schemaToGraph({ nodeTypes: [], relTypes: [] })).toEqual({
      nodes: [],
      relationships: [],
      style: {},
    });
  });
});
