# Arrows for IntelliJ

The arrows.app canvas, inside a JetBrains IDE. Open a `.arrows` file and you get the editor from arrows.app — drag nodes, draw relationships, edit inline. The file stays plain JSON, so your graph models can live in git next to the code that uses them.

## Features

- Canvas editor for `.arrows` files
- Cypher export (copy to clipboard or save), SVG export, GraphQL-schema export
- Open the current graph in arrows.app, or import one from an arrows.app share link
- Project-wide rename for labels and relationship types
- Sidebar with your workspace's `.arrows` files plus six bundled examples

## Install

Not on the Marketplace yet — install from disk:

```sh
./install-local.sh      # macOS / Linux
install-local.bat       # Windows
```

That packages the plugin to `plugin/build/distributions/plugin.zip`; then in the IDE: **Settings → Plugins → ⚙ → Install Plugin from Disk…** and pick that zip. Or run a sandbox IDE with it loaded: `./gradlew :plugin:runIde`.

## Getting started

Open the **Arrows** tool window on the left and choose **New graph** (or open any `.arrows` file). From the canvas:

- Drag from a node's ring to draw a relationship.
- Double-click empty space to add a node.
- Right-click anything for the relevant menu.
- Use the kebab (**⋮**) menu in the toolbar for export, rename, and open-in-arrows.app.

Press **`?`** inside the canvas to see all shortcuts.

## Shortcuts

| | macOS | Windows / Linux |
|---|---|---|
| Select / Pan tool | V / H (or hold Space) | V / H (or hold Space) |
| Add node | Double-click empty | Double-click empty |
| Draw relationship | Drag from node ring | Drag from node ring |
| Add to selection | Shift+click | Shift+click |
| Delete | Delete / Backspace | Delete / Backspace |
| Zoom | Wheel | Wheel |

## Bundled examples

| Example | Layout |
|---|---|
| social | Force-directed |
| iam-rbac | Hierarchical |
| microservices | Hierarchical |
| lexical-graph (GraphRAG) | Radial |
| order-lifecycle | Circular |
| citations | Grid |

Labels are PascalCase, relationship types SCREAMING_SNAKE_CASE, properties camelCase.

## File format

Plain JSON, the same format arrows.app uses. The same `.arrows` file opens in arrows.app, the VS Code extension, or here — interchangeably, so it diffs cleanly in git.

## FAQ

**Does it phone home?** No. It's local.

**Does it round-trip with arrows.app?** Yes — same format.

**Why can't I edit the raw JSON in a tab?** `.arrows` always opens as the canvas; review the JSON via the git diff. (Editing it as text in a second tab tripped an IntelliJ platform bug, so it's intentionally one editor.)

## Build from source

The canvas is the shared web bundle, so build it first, then the plugin:

```sh
cd ../vscode && npm run build          # builds dist/apps/arrows-ts (the embed bundle)
cd ../intellij && ./gradlew :plugin:buildPlugin
```

Tests:

```sh
./gradlew test            # pure :core units + :plugin headless integration tests
```

This plugin is a thin Kotlin/JCEF adapter — host plumbing only (a `JBCefBrowser` loading the bundle, the postMessage bridge, a `FileEditor` for `*.arrows`, the sidebar tool window). All feature logic lives in the web bundle and is shared with the VS Code host over the same protocol; see [../../README.md](../../README.md) for the subsystem layout.

## Issues

[github.com/neo4j-labs/arrows.app/issues](https://github.com/neo4j-labs/arrows.app/issues) — please include your IDE version, OS, and a small repro.

## License

Apache-2.0.
