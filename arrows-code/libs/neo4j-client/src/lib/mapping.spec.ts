import { describe, it, expect } from 'vitest';
import { buildSchema } from './mapping';

describe('buildSchema', () => {
  it('groups node properties by label set', () => {
    const result = buildSchema(
      [
        { nodeLabels: ['Person'], propertyName: 'name', propertyTypes: ['String'] },
        { nodeLabels: ['Person'], propertyName: 'age', propertyTypes: ['Long'] },
        { nodeLabels: ['Post'], propertyName: 'title', propertyTypes: ['String'] },
      ],
      [],
      []
    );

    expect(result.nodeTypes).toEqual([
      {
        labels: ['Person'],
        properties: [
          { name: 'name', type: 'String' },
          { name: 'age', type: 'Long' },
        ],
      },
      { labels: ['Post'], properties: [{ name: 'title', type: 'String' }] },
    ]);
  });

  it('emits a node type with no properties when propertyName is null', () => {
    const result = buildSchema(
      [{ nodeLabels: ['Tag'], propertyName: null, propertyTypes: null }],
      [],
      []
    );

    expect(result.nodeTypes).toEqual([{ labels: ['Tag'], properties: [] }]);
  });

  it('joins multiple property types with a pipe', () => {
    const result = buildSchema(
      [{ nodeLabels: ['Mixed'], propertyName: 'val', propertyTypes: ['Long', 'String'] }],
      [],
      []
    );

    expect(result.nodeTypes[0].properties[0]).toEqual({ name: 'val', type: 'Long | String' });
  });

  it('normalizes the backtick/colon-wrapped relType from relTypeProperties', () => {
    const result = buildSchema(
      [],
      [{ relType: ':`KNOWS`', propertyName: 'since', propertyTypes: ['Long'] }],
      [{ type: 'KNOWS', from: ['Person'], to: ['Person'] }]
    );

    expect(result.relTypes).toEqual([
      {
        type: 'KNOWS',
        from: ['Person'],
        to: ['Person'],
        properties: [{ name: 'since', type: 'Long' }],
      },
    ]);
  });

  it('attaches endpoints to a relationship type that has no properties', () => {
    const result = buildSchema(
      [],
      [{ relType: ':`LIKED`', propertyName: null, propertyTypes: null }],
      [{ type: 'LIKED', from: ['User'], to: ['Post'] }]
    );

    expect(result.relTypes).toEqual([
      { type: 'LIKED', from: ['User'], to: ['Post'], properties: [] },
    ]);
  });

  it('defaults endpoints to empty arrays when visualization has no match', () => {
    const result = buildSchema(
      [],
      [{ relType: ':`ORPHAN`', propertyName: null, propertyTypes: null }],
      []
    );

    expect(result.relTypes).toEqual([
      { type: 'ORPHAN', from: [], to: [], properties: [] },
    ]);
  });
});
