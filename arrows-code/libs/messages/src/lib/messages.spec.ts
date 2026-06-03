import { describe, it, expect } from 'vitest';
import { parseInboundMessage, type InboundMessage } from './messages';
import fixtures from '../../fixtures/inbound-messages.json';

// Normalized shape both hosts compare against, so the TS and Kotlin parsers
// can't drift: the same fixtures drive both suites.
function normalize(m: InboundMessage | null): unknown {
  if (m === null) return null;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'graph-changed':
      return { type: m.type, nodeCount: m.graph.nodes.length, relCount: m.graph.relationships.length, docVersion: m.docVersion ?? null };
    case 'response':
      return { type: m.type, requestId: m.requestId, result: m.result ?? null, error: m.error ?? null };
    case 'command':
      return { type: m.type, name: m.name };
    case 'open-external':
      return { type: m.type, url: m.url };
    case 'embed-error':
      return { type: m.type, message: m.message ?? null, error: m.error ?? null };
  }
}

describe('inbound-message conformance fixtures (shared with the Kotlin host)', () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      expect(normalize(parseInboundMessage(fx.raw))).toEqual(fx.expect);
    });
  }
});

describe('parseInboundMessage', () => {
  it('parses a ready message, ignoring extra fields', () => {
    expect(parseInboundMessage({ type: 'ready', host: 'vscode' })).toEqual({ type: 'ready' });
  });

  it('parses graph-changed with a valid graph payload and docVersion', () => {
    const graph = { nodes: [], relationships: [] };
    expect(parseInboundMessage({ type: 'graph-changed', graph, docVersion: 7 })).toEqual({
      type: 'graph-changed',
      graph,
      docVersion: 7,
    });
  });

  it('parses graph-changed without docVersion', () => {
    const graph = { nodes: [{ id: 'n0' }], relationships: [] };
    expect(parseInboundMessage({ type: 'graph-changed', graph })).toEqual({
      type: 'graph-changed',
      graph,
    });
  });

  it('rejects graph-changed whose graph lacks node/relationship arrays', () => {
    expect(parseInboundMessage({ type: 'graph-changed', graph: { nodes: 'x' } })).toBeNull();
    expect(parseInboundMessage({ type: 'graph-changed', graph: {} })).toBeNull();
    expect(parseInboundMessage({ type: 'graph-changed' })).toBeNull();
  });

  it('ignores a non-numeric docVersion', () => {
    const graph = { nodes: [], relationships: [] };
    expect(parseInboundMessage({ type: 'graph-changed', graph, docVersion: 'nope' })).toEqual({
      type: 'graph-changed',
      graph,
    });
  });

  it('parses a response with a string requestId', () => {
    expect(parseInboundMessage({ type: 'response', requestId: 'svg-1', result: '<svg/>' })).toEqual({
      type: 'response',
      requestId: 'svg-1',
      result: '<svg/>',
    });
    expect(parseInboundMessage({ type: 'response', requestId: 'svg-1', error: 'boom' })).toEqual({
      type: 'response',
      requestId: 'svg-1',
      error: 'boom',
    });
  });

  it('rejects a response without a string requestId', () => {
    expect(parseInboundMessage({ type: 'response', result: 'x' })).toBeNull();
    expect(parseInboundMessage({ type: 'response', requestId: 42 })).toBeNull();
  });

  it('parses a command with a string name', () => {
    expect(parseInboundMessage({ type: 'command', name: 'arrows.validate' })).toEqual({
      type: 'command',
      name: 'arrows.validate',
    });
  });

  it('rejects a command without a string name', () => {
    expect(parseInboundMessage({ type: 'command' })).toBeNull();
  });

  it('parses open-external with a string url', () => {
    expect(parseInboundMessage({ type: 'open-external', url: 'https://neo4j.com' })).toEqual({
      type: 'open-external',
      url: 'https://neo4j.com',
    });
  });

  it('rejects open-external without a string url', () => {
    expect(parseInboundMessage({ type: 'open-external' })).toBeNull();
  });

  it('parses embed-error with optional message and error', () => {
    expect(parseInboundMessage({ type: 'embed-error', message: 'render failed', error: 'stack' })).toEqual({
      type: 'embed-error',
      message: 'render failed',
      error: 'stack',
    });
    expect(parseInboundMessage({ type: 'embed-error' })).toEqual({ type: 'embed-error' });
  });

  it('returns null for unknown types and non-object input', () => {
    expect(parseInboundMessage({ type: 'nope' })).toBeNull();
    expect(parseInboundMessage({})).toBeNull();
    expect(parseInboundMessage(null)).toBeNull();
    expect(parseInboundMessage('ready')).toBeNull();
    expect(parseInboundMessage(undefined)).toBeNull();
  });
});
