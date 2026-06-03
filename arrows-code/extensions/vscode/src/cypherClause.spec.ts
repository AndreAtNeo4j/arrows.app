import { describe, expect, it } from 'vitest';
import { cypherClauseItems } from './cypherClause';

describe('cypherClauseItems - pure picker logic', () => {
  it('defaults to CREATE when no last value is persisted', () => {
    const { active } = cypherClauseItems(undefined);
    expect(active?.clause).toBe('CREATE');
  });

  it('defaults to CREATE when persisted value is junk (not a valid clause)', () => {
    expect(cypherClauseItems('NOPE').active?.clause).toBe('CREATE');
    expect(cypherClauseItems(42).active?.clause).toBe('CREATE');
    expect(cypherClauseItems(null).active?.clause).toBe('CREATE');
  });

  it('pre-selects the previously chosen clause', () => {
    expect(cypherClauseItems('MATCH').active?.clause).toBe('MATCH');
    expect(cypherClauseItems('MERGE').active?.clause).toBe('MERGE');
    expect(cypherClauseItems('CREATE').active?.clause).toBe('CREATE');
  });
});
