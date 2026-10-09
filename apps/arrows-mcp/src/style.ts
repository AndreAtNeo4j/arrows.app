import { themes, type Graph } from '@neo4j-arrows/model';

export const THEME_NAMES = themes.map((t) => t.name);

// One colour per entity type so a reader can tell Customer from Order at a glance.
const PALETTE = ['#4C8EDA', '#57C7E3', '#8DCC93', '#F79767', '#ECB5C9', '#D9C8AE', '#C990C0', '#FFC454'];

const typeOf = (node: { labels?: string[]; caption?: string }): string =>
  (node.labels ?? [])[0] ?? node.caption ?? '';

/** Radius grows with the caption so text stays inside the circle instead of overflowing it. */
const radiusFor = (caption: string): number =>
  Math.max(55, Math.min(130, Math.round(caption.length * 4.5) + 25));

/**
 * Applies a built-in arrows theme plus a per-entity-type colour. Any style the caller already
 * set on a node wins, so this only fills in what was left unstyled.
 */
export function applyTheme(graph: Graph, themeName?: string): Graph {
  if (themeName === 'none') return graph;
  const theme = themes.find((t) => t.name.toLowerCase() === (themeName ?? 'Bloom').toLowerCase());
  if (!theme) throw new Error(`unknown theme: ${themeName}`);

  const types = [...new Set(graph.nodes.map(typeOf))];
  return {
    ...graph,
    style: { ...theme.graph.style, ...graph.style },
    nodes: graph.nodes.map((n) => ({
      ...n,
      style: {
        'node-color': PALETTE[Math.max(0, types.indexOf(typeOf(n))) % PALETTE.length],
        // radius is typed string on Node.style but read as a number downstream; type-only bridge.
        radius: radiusFor(n.caption ?? '') as unknown as string,
        ...n.style,
      },
    })),
  };
}
