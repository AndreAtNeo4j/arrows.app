# arrows-mcp - guarantees

What must not regress. **P0** = blocker, holds for every input. **P1** = required for
correct feature behavior. Tool behavior itself is documented by the tool descriptions in
`src/server.ts` (the version the model actually reads) and the table in `README.md`.

| ID | Requirement | Sev | Enforced by |
|----|-------------|-----|-------------|
| G1 | No input crashes or exits the server process; errors surface as tool errors | P0 | `src/test.ts` (empty graph, 1e6-char values, 1e30 coordinates) |
| G2 | Canonical JSON is deterministic, including across property insertion order | P0 | `src/test.ts` |
| G3 | Share URL round-trips: `Base64.decode` of the hash payload reparses to the same graph (never percent-encode the base64) | P0 | `src/test.ts` |
| G4 | Output depends only on the resolved graph and the call's arguments; two graphs in one session never bleed together | P0 | `scripts/e2e.mjs` (repeat + interleaved calls, session cross-talk) |
| G5 | Patch/build errors are reported, never thrown; a partial batch still returns a valid graph | P0 | `src/test.ts`, `scripts/e2e.mjs` |
| G6 | Render always yields a valid PNG and well-formed SVG, never NaN/negative/over-large dimensions | P0 | `src/test.ts` |
| G7 | No prototype pollution via property/style keys | P0 | `src/test.ts` |
| G8 | **Generated Cypher is safe**: identifiers escape internal backticks, string values escape quotes and backslashes. A label or property name can never break out of its identifier | P0 | `src/test.ts` (hostile label, quoted value) |
| G9 | A schema model (property values are type names) exports type constraints, never the type name stored as data - including a model with unrecognised type names | P0 | `src/test.ts`, `scripts/e2e.mjs` |
| G10 | Instance data exports a literal CREATE/MATCH/MERGE; `cypherStyle` overrides the automatic choice | P1 | `src/test.ts`, `scripts/e2e.mjs` |
| G11 | GraphQL output parses as SDL and every field type is a real scalar or a declared type | P1 | `src/test.ts`, `scripts/e2e.mjs` |
| G12 | Every layout runs, moves nodes to distinct finite positions, and preserves counts and non-position data | P1 | `src/test.ts`, `scripts/e2e.mjs` |
| G13 | `arrows_validate` reports real problems (duplicate ids, dangling relationships), not just an empty array | P1 | `src/test.ts` |
| G14 | Duplicate captions never silently misroute relationships - they warn | P1 | `src/test.ts` |
| G15 | Unicode captions/labels/properties survive round-trip and render | P1 | `src/test.ts` |
| G16 | An outlier coordinate does not render every real node sub-pixel | P1 | `src/test.ts` |
| G17 | The packaged extension runs standalone under a minimal env **and can rasterize a PNG** (proves the bundled native canvas loads) | P0 | `scripts/pack-extension.mjs` |
| G18 | Input graph objects are never mutated. A session handle holds a graph in memory only, is bounded, and never survives a restart - an unknown handle says so and names the `graph` fallback | P0 | `scripts/e2e.mjs` (stale handle), `src/session.ts` |

Also: no native compiler and no network needed to build or run.

## Known limitations

- Property **type** and **existence** constraints require Neo4j 5.9+ **Enterprise Edition**;
  Community Edition supports uniqueness constraints only. The emitted Cypher says so.
- Uniqueness constraints and node keys are not inferred - the model has no notation for them.
- A constraint targets a single label, so a multi-label node yields one constraint per label,
  each broader than the node the diagram drew. The output notes this.
- A model mixing type names and literal values is treated as instance data if any value is a
  literal; unrecognised type names in a schema model are skipped with a comment.
