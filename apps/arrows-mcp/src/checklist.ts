import type { GraphJson } from './engine';

const cap = (items: string[], max: number): string[] =>
  items.length > max ? [...items.slice(0, max), `+${items.length - max} more`] : items;

/** What the image should contain, so a caller checks the picture instead of trusting the call. */
export function verificationChecklist(json: GraphJson): string {
  // arrows_render passes the caller's raw graph, so neither field is guaranteed to be an array.
  const nodes = (Array.isArray(json.nodes) ? json.nodes : []) as { caption?: string; labels?: string[] }[];
  const rels = (Array.isArray(json.relationships) ? json.relationships : []) as { type?: string }[];
  const names = [...new Set(nodes.map((n) => n.caption || (n.labels ?? [])[0] || '(unlabelled)'))];
  const types = [...new Set(rels.map((r) => r.type).filter((t): t is string => Boolean(t)))];

  const parts = [`nodes [${cap(names, 20).join(', ')}]`];
  if (types.length) parts.push(`relationships [${cap(types, 20).join(', ')}]`);

  return (
    'The diagram above is already rendered - present it as it is. Never redraw it, rebuild it from ' +
    'the JSON, or substitute mermaid or another diagramming tool. Only if the user says they cannot ' +
    'see it, copy the <svg> markup above into an image/svg+xml artifact, character for character.\n' +
    `It contains: ${parts.join('; ')}.`
  );
}
