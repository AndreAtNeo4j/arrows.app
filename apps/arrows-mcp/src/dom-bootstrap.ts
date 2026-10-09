import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

// @neo4j-arrows/graphics builds a measurement canvas at module-eval time, so the
// DOM and a font-metrics-backed getContext must exist before that import runs.
const dom = new JSDOM('<!doctype html><body></body>');
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;

const measurer = createCanvas(8, 8).getContext('2d');
dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
  set font(v: string) {
    measurer.font = v;
  },
  measureText: (s: string) => measurer.measureText(String(s)),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

export const serializer = new dom.window.XMLSerializer();
