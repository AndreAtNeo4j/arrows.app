import { serializer } from './dom-bootstrap';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderSvgDom } from '@neo4j-arrows/graphics';
import { Point, type Graph } from '@neo4j-arrows/model';
import { readGraph } from '@arrows-code/format-json';
import type { GraphJson } from './engine';

const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80">' +
  '<rect width="100%" height="100%" fill="#ffffff"/>' +
  '<text x="120" y="44" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#888">empty graph</text></svg>';

// Claude downscales an image past ~1568px before the model sees it, so a larger PNG costs the model
// no more and the user keeps a sharp, zoomable picture. This only bounds the native bitmap.
const MAX_PNG_DIMENSION = 2400;
// Property captions sit outside the node, beyond the bounding box, so they clip without padding.
const PAD = 48;
// An outlier coordinate inflates the viewBox until every real node is sub-pixel. Rendering only;
// exports keep the original positions.
const RENDER_BOUND = 50_000;

export interface RenderOptions {
  /** Drops the backdrop and the mask boxes behind label text, so a line may show through it. */
  transparent?: boolean;
}

function loadGraph(input: GraphJson): Graph {
  const graph = readGraph(JSON.stringify(input)).graph;
  const nodes = graph.nodes.map((n) => {
    const { x, y } = n.position;
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= RENDER_BOUND && Math.abs(y) <= RENDER_BOUND) return n;
    const bound = (v: number) => (Number.isFinite(v) ? Math.max(-RENDER_BOUND, Math.min(RENDER_BOUND, v)) : 0);
    return { ...n, position: new Point(bound(x), bound(y)) };
  });
  return { ...graph, nodes };
}

/** Reads a length attribute, tolerating exponent notation ("2e+30") and junk. */
function length(tag: string, name: string, fallback: number): number {
  const raw = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** A style value is only usable as a colour if it is actually a non-empty string. */
const colour = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Trims float precision and default-valued attributes; ~25% smaller for no visible change. */
function minifySvg(svg: string): string {
  const round = (value: string): string =>
    value.replace(/-?\d+\.\d{3,}(?:e[+-]?\d+)?/gi, (n) => {
      const r = Math.round(parseFloat(n) * 100) / 100;
      return String(r === 0 ? 0 : r);
    });
  // Confined to tags: a caption may contain an `="..."` of its own.
  const inTag = (tag: string): string =>
    tag
      .replace(/([\w:-]+)="([^"]*)"/g, (_m, key, value) => `${key}="${round(value)}"`)
      .replace(/ transform="(?:translate\(0 0\)|rotate\(0\))"/g, '')
      // Only non-inherited attributes are dropped at their default; an explicit text-anchor="start"
      // or font-weight="normal" overrides an ancestor and must survive.
      .replace(/ (?:x|y)="0"/g, '');
  return svg
    .replace(/<[^>]*>/g, inTag)
    // xml:space only matters for leading, trailing or repeated whitespace.
    .replace(/<text([^>]*) xml:space="preserve"([^>]*)>([^<]*)<\/text>/g, (m, before, after, text) =>
      /^\s|\s$|\s\s/.test(text) ? m : `<text${before}${after}>${text}</text>`,
    );
}

export function renderSvg(input: GraphJson, options: RenderOptions = {}): string {
  const graph = loadGraph(input);
  if (graph.nodes.length === 0) return EMPTY_SVG;
  // renderSvgDom returns the graphics lib's own element type, not jsdom's global Node.
  let svg = serializer.serializeToString(renderSvgDom(graph, {}) as unknown as Node);
  // A degenerate bounding box yields NaN/Infinity lengths, which abort the native canvas.
  svg = svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\b(width|height)="([^"]*)"/g, (m, attr, value) =>
      Number.isFinite(Number(value)) && Number(value) >= 1 ? m : `${attr}="1"`,
    ),
  );
  svg = svg.replace(/<svg\b[^>]*>/, (tag) => {
    const w = Number(/\bwidth="([^"]*)"/.exec(tag)?.[1]);
    const h = Number(/\bheight="([^"]*)"/.exec(tag)?.[1]);
    const box = /\bviewBox="([^"]*)"/.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || box?.length !== 4 || box.some((n) => !Number.isFinite(n))) return tag;
    return tag
      .replace(/\bwidth="[^"]*"/, `width="${w + PAD * 2}"`)
      .replace(/\bheight="[^"]*"/, `height="${h + PAD * 2}"`)
      .replace(/\bviewBox="[^"]*"/, `viewBox="${box[0] - PAD} ${box[1] - PAD} ${box[2] + PAD * 2} ${box[3] + PAD * 2}"`);
  });

  const style = (graph.style ?? {}) as Record<string, unknown>;
  const bg = colour(style['background-color']);
  if (options.transparent) {
    // Only a <g> directly wrapping a <rect> is a mask box; a node circle in the same colour keeps its fill.
    for (const masked of new Set([bg, colour(style['type-background-color'])].filter(Boolean) as string[])) {
      const pattern = escapeAttr(masked).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      svg = svg.replace(new RegExp(`<g([^>]*) fill="${pattern}"([^>]*)>(?=<rect)`, 'g'), '<g$1 fill="none"$2>');
    }
    return minifySvg(svg);
  }
  if (bg && bg !== 'white' && bg !== '#ffffff') {
    // Anchored to the viewBox, which the padding above moved off the origin. bg is caller-supplied,
    // and this is the one attribute not written through the DOM, so it has to be escaped here.
    svg = svg.replace(/<svg\b([^>]*)>/, (tag, attrs) => {
      const box = /\bviewBox="([^"]*)"/.exec(tag)?.[1]?.trim().split(/[\s,]+/) ?? ['0', '0', '100%', '100%'];
      return `<svg${attrs}><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="${escapeAttr(bg)}"/>`;
    });
  }
  return minifySvg(svg);
}

/** Rasterises markup that has already been rendered, so a caller never pays for renderSvg twice. */
export function pngFromSvg(svg: string, options: RenderOptions = {}): Buffer {
  const rootTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '<svg>';
  const natW = length(rootTag, 'width', 1200);
  const natH = length(rootTag, 'height', 900);
  const longest = Math.max(natW, natH);
  const scale = longest > MAX_PNG_DIMENSION ? MAX_PNG_DIMENSION / longest : 1;
  const width = Math.max(1, Math.round(natW * scale));
  const height = Math.max(1, Math.round(natH * scale));

  // The decoder allocates a native bitmap at the declared size, so the declared lengths - not just
  // the canvas - must be bounded; the viewBox keeps content scaled.
  const boundedSvg = svg.replace(
    rootTag,
    rootTag.replace(/\bwidth="[^"]*"/, `width="${width}"`).replace(/\bheight="[^"]*"/, `height="${height}"`),
  );

  const img = new Image();
  img.src = Buffer.from(boundedSvg, 'utf8');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // The themed backdrop is inside the svg; this only covers the default white theme.
  if (!options.transparent) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}

export const renderPng = (input: GraphJson, options: RenderOptions = {}): Buffer =>
  pngFromSvg(renderSvg(input, options), options);
