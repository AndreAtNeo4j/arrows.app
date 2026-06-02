export interface GraphPayload {
  nodes: unknown[];
  relationships: unknown[];
}

export type InboundMessage =
  | { type: 'ready' }
  | { type: 'graph-changed'; graph: GraphPayload; docVersion?: number }
  | { type: 'response'; requestId: string; result?: string; error?: string }
  | { type: 'command'; name: string }
  | { type: 'open-external'; url: string }
  | { type: 'embed-error'; message?: string; error?: string };

export interface LoadMessage {
  type: 'load';
  graph: unknown;
  docVersion: number;
  menu: unknown;
}

export interface RequestEnvelope {
  type: 'request';
  kind: string;
  requestId: string;
  payload?: unknown;
}

export type OutboundMessage = LoadMessage | RequestEnvelope;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isGraphPayload = (v: unknown): v is GraphPayload =>
  isRecord(v) && Array.isArray(v['nodes']) && Array.isArray(v['relationships']);

const optString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function parseInboundMessage(raw: unknown): InboundMessage | null {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return null;

  switch (raw['type']) {
    case 'ready':
      return { type: 'ready' };

    case 'graph-changed': {
      if (!isGraphPayload(raw['graph'])) return null;
      const msg: Extract<InboundMessage, { type: 'graph-changed' }> = {
        type: 'graph-changed',
        graph: raw['graph'],
      };
      if (typeof raw['docVersion'] === 'number') msg.docVersion = raw['docVersion'];
      return msg;
    }

    case 'response': {
      if (typeof raw['requestId'] !== 'string') return null;
      return {
        type: 'response',
        requestId: raw['requestId'],
        result: optString(raw['result']),
        error: optString(raw['error']),
      };
    }

    case 'command':
      return typeof raw['name'] === 'string' ? { type: 'command', name: raw['name'] } : null;

    case 'open-external':
      return typeof raw['url'] === 'string' ? { type: 'open-external', url: raw['url'] } : null;

    case 'embed-error':
      return { type: 'embed-error', message: optString(raw['message']), error: optString(raw['error']) };

    default:
      return null;
  }
}
