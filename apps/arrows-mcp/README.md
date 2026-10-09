# arrows-mcp

MCP server that lets Claude create, edit, render, review and export Neo4j
[arrows.app](https://arrows.app) graph models - directly in a conversation.

It reuses the engine already in this repo (canonical `.arrows` JSON, patch ops, validator,
layouts, and the web app's Cypher/GraphQL exporters), so rendering and export match
arrows.app itself. Rendering runs headless in Node - no browser needed.

It sits outside `arrows-code/` because it imports the web app's exporters
(`apps/arrows-ts/**`), which that subsystem is not allowed to touch.

## Tools

| Tool | What it does |
| --- | --- |
| `arrows_build` | Create a model from `.arrows` JSON (`nodes` + `relationships`). Auto-assigns ids, picks the cleanest of the built-in layouts, themes it (a colour per entity type) and returns JSON + inline image. No share link by default - it embeds the whole graph; ask for one via `arrows_export format=url`. |
| `arrows_edit` | Apply a batch of patch ops (add/remove/rename nodes, labels, properties, styles, relationships). Returns updated JSON + image. A batch where some ops applied is not an error; the failures are listed. |
| `arrows_validate` | Review a model: structural + parse diagnostics with severity. |
| `arrows_layout` | Re-position nodes with one of the built-in layout algorithms. |
| `arrows_render` | Render a model as an inline `png`, or return `svg` markup. |
| `arrows_export` | Export to `cypher` (CREATE/MATCH/MERGE), `graphql`, `svg`, `json`, or `url` (arrows.app share link). |

Every graph flows in and out as `.arrows` JSON. Results also carry an `id` handle, held in
memory for the session only, that later calls can pass instead of re-sending the graph; passing
`graph` always works. Validate, render and export are annotated read-only.

## Build

```bash
cd apps/arrows-mcp
npm install
npm run build      # bundles dist/server.cjs
npm test           # build + unit/edge cases + full MCP protocol E2E
npm run pack       # build + package dist/arrows.mcpb (Claude Desktop extension)
```

No native compiler needed - the canvas dependency ships prebuilt binaries.

## Install

### Claude Desktop (recommended)

```bash
npm run pack && open -a Claude dist/arrows.mcpb
```

Confirm the install dialog once. The extension appears under Settings → Extensions with
the arrows icon.

After that, updating needs no dialog - the installed extension is an unpacked copy, so
push a new build straight into it:

```bash
npm run sync    # build + update the installed extension + verify it starts
```

Then restart Claude Desktop (or toggle the extension off/on in Settings). Only a
**dependency** change needs a full `npm run pack` + reinstall; `sync` will tell you if so.

### Claude Code

```bash
claude mcp add -s user arrows -- node "$PWD/dist/server.cjs"
```

Editing `claude_desktop_config.json` by hand is not recommended: a running Claude Desktop
rewrites that file from its own state and will drop the entry.

## Example prompt

> "Model an e-commerce domain: customers place orders, orders contain products. Show me
> the graph, then export it as Cypher."

## Layout

`arrows_build` picks the layout automatically from the graph's shape - a hub node goes
radial, a tree/DAG goes hierarchical (top-down), a small dense cluster goes circular,
otherwise force. Pass `layout` explicitly to override.

## Appearance

`arrows_build` takes a `theme`: `Bloom` (default), `Chunky`, `Dark Code`, `Browser`, `Iconic`,
or `none`. Each entity type gets its own colour, node radius grows with the caption, and the
image is padded so property captions never clip. Styles live in the graph JSON, so they
survive edits.

## Node property values

A property value is either a **type name** or a **literal value**, and that choice decides
what the Cypher export means:

| You write | Model kind | `arrows_export format=cypher` gives |
| --- | --- | --- |
| `name: "string"` | schema | `REQUIRE n.name IS :: STRING` (property-type constraints) |
| `name: "Alice"` | instance data | `CREATE (:Person {name: "Alice"})` |

Do not mix them in one model: a single literal makes the whole graph export as data, and the
type names would be stored as data. The export warns when it detects a mix. Add inner quotes
(`status: "'string'"`) only when an instance value collides with a type name.

Property type and existence constraints need Neo4j 5.9+ **Enterprise Edition**; uniqueness
constraints and node keys are not inferred.
