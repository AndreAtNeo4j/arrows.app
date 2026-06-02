# arrows-code

Brings the arrows.app canvas into developer IDEs — a **VS Code extension** and an **IntelliJ Platform plugin** — both embedding the same web bundle over the same host protocol.

Self-contained subsystem inside the `arrows.app` monorepo. Deleting `arrows-code/` removes it cleanly - the parent web app is untouched.

This README documents the VS Code host; the IntelliJ host is a thin Kotlin/JCEF adapter — see [hosts/intellij/README.md](hosts/intellij/README.md).

## Layout

```text
arrows-code/
├── hosts/                       editor-specific adapters (one dir per editor)
│   ├── vscode/                  VS Code extension — only VS-Code-coupled code
│   │   └── src/
│   │       ├── PreviewProvider.ts   CustomTextEditorProvider + host↔webview bridge
│   │       ├── extension.ts         activate() - wires commands, sidebar, custom editor
│   │       ├── sidebar.ts           TreeDataProvider: quick actions, workspace .arrows, examples
│   │       ├── webviewHtml.ts       embed.html → webview-safe HTML (CSP, nonces, asWebviewUri)
│   │       ├── webviewRequest.ts    request/response envelope over postMessage
│   │       ├── commands/            command implementations (file, export, format, validate, rename)
│   │       ├── commandsCatalog.ts   single source of truth for command surface
│   │       └── parseImportInput.ts  arrows.app share URL / raw JSON parser
│   └── intellij/                IntelliJ plugin — JCEF canvas, Kotlin/Gradle
├── libs/                        host-agnostic — no editor SDK
│   ├── format-json/             read/write canonical .arrows JSON, deterministic output
│   ├── graph-logic/             layout (5 algorithms) + patch ops + structural validation
│   └── host-protocol/           embed↔host wire contract + parseInboundMessage
└── fixtures/examples/           .arrows files copied into media/embed examples at build time
```

`hosts/*` is editor-specific (may import the editor SDK); `libs/*` is host-agnostic (never imports one). Shared logic lives in a lib, not inlined in a host.

The canvas, renderer, and inspector are **not** here - they live in `apps/arrows-ts/src/` and ship as a Vite bundle into `media/embed/` (gitignored). See `CLAUDE.md` for the shared-canvas rule.

## What cascades from the web app

The embed bundle re-exports the web app's modules verbatim, so changes in `apps/arrows-ts/src/` and `libs/{model,graphics,selectors}/` flow into the extension on the next `npm run build`:

| Web app source                                       | What the extension picks up automatically                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `libs/model/styling.ts`                              | Style key vocabulary used by the inspector, theme picker, validator, and Cypher export                      |
| `libs/model/themes.ts`                               | Built-in theme cards shown in the right panel                                                               |
| `libs/model/applicationLayout.ts`                    | `inspectorWidth`, `headerHeight`, `footerHeight` - drive embed viewport math + kebab menu max-height        |
| `libs/graphics/*` (VisualNode, VisualRelationship, renderers) | Canvas rendering: node shapes, captions, arrows, labels                                            |
| `libs/selectors/*` (`getPresentGraph`, `getVisualGraph`) | State traversal used by the bridge and embed thunks                                                     |
| `apps/arrows-ts/src/reducers/`                       | All state transitions - graph mutations, selection, undo/redo, view transformations                         |
| `apps/arrows-ts/src/actions/`                        | Action creators dispatched from the embed (selection, mouse, undo, viewport, inspector toggle)              |
| `apps/arrows-ts/src/middlewares/imageCacheMiddleware.js` | Cached image lookups for node icons                                                                     |
| `apps/arrows-ts/src/middlewares/viewportMiddleware.js` (`calculateViewportTranslation`) | Fit-to-content math used by `embedViewportMiddleware`              |
| `apps/arrows-ts/src/containers/InspectorChooser`     | Entire inspector pane (mounted as-is by `EmbedInspectorPanel`)                                              |
| `apps/arrows-ts/src/containers/GraphContainer`       | Entire graph canvas - every pixel of the editor area                                                        |
| `apps/arrows-ts/src/components/Footer.jsx`           | Entire footer (dark navy bar, Neo4j logo, help link, link list) - `EmbedFooter` only wraps it for help-click + external-link interception |
| `apps/arrows-ts/src/components/informationLinks.js`  | Privacy / Terms / Feedback links rendered by the bundle Footer                                              |
| `apps/arrows-ts/src/storage/exportCypher.js`         | Cypher CREATE/MERGE/MATCH export, including injection-safe identifier escaping                              |
| `apps/arrows-ts/src/graphql/exportGraphQL.js`        | GraphQL schema export (lazy-loaded chunk)                                                                   |
| `apps/arrows-ts/src/interactions/Keybindings.ts`     | Key combinations for Select-all / Duplicate / Delete / Undo / Redo via `getKeybindingString()`              |

What the extension defines **on top of** the bundle (does NOT auto-update from a web-app change):

- Toolbar layout, slide-in inspector tab, right-click context menu, action menu (kebab), help/shortcuts modal, error boundaries - all under `apps/arrows-ts/src/embed/ui/`.
- Bridge protocol + busy/echo state machine - `apps/arrows-ts/src/embed/bridge/`.
- Pan tool + cursor-anchored wheel-zoom (intentionally bypasses arrows.app's `minScale` floor) - `apps/arrows-ts/src/embed/interactions/panInteraction.ts`.
- Refit policy (only on `WINDOW_RESIZED` + `TOGGLE_INSPECTOR`, not on every CRUD action) - `apps/arrows-ts/src/embed/store/embedViewportMiddleware.ts`.
- Shift+click multi-select, double-click-to-create-node, drag-continues-off-canvas + edge-pan - `apps/arrows-ts/src/embed/interactions/` event listeners.
- Webview-scoped CSS (subtle scrollbar inside the kebab menu) - `apps/arrows-ts/src/embed/embed.css`.
- VS Code host code: commands, sidebar, custom editor provider, webview HTML/CSP, `format-json` lib.

### Brand strings + URLs duplicated (not cascaded)

The web app's brand strings (`https://neo4j.com/labs/arrows`, "Powered by Neo4j Labs", the Neo4j logo SVG) live inside `Footer.jsx`'s JSX - not exported as constants. The extension references them in three places that would need manual update if rebranded:

- `arrows-code/hosts/vscode/src/commands/file.ts` - `TUTORIAL_URL`, `ALLOWED_HOSTS` allowlist
- `arrows-code/hosts/vscode/src/commands/export.ts` - `https://arrows.app/#/import/json=` URL construction for `openInArrowsApp`
- `arrows-code/hosts/vscode/src/commands/file.ts` - `arrows.app` prompt text for `importGraph`

## Decoupling rules

Code under `arrows-code/` may import only from:

- `@neo4j-arrows/{model,graphics,selectors}` - additive exports only
- `@arrows-code/format-json` - the one local library
- npm packages declared in each project's `package.json`

Forbidden: any path under `apps/arrows-ts/**`. The embed is consumed as a built bundle at runtime, never as source.

## Commands

```bash
# Unit tests (vitest) for the one library + the extension src
npx nx test arrows-code-format-json
cd arrows-code/hosts/vscode && npm test

# Build the embed bundle + extension bundle
cd arrows-code/hosts/vscode && npm run build

# Real VS Code Electron smoke test (commands resolve, extension activates)
cd arrows-code/hosts/vscode && npm run commands-test

# Package .vsix (runs build + test + commands-test)
cd arrows-code/hosts/vscode && npm run package

# Build + install locally (then Reload Window in VS Code)
cd arrows-code/hosts/vscode && npm run install:local
```

## Architecture invariants

These hold inside `arrows-code/`:

- **Graph state is immutable.** Patch ops and reducers return new objects.
- **One panel per document URI.** `PreviewProvider.panels` is a static Map; the provider is a singleton per extension host.
- **Single edit chain in `PreviewProvider`.** `applyChain: Promise<unknown>` serializes `applyEdit` so rapid webview emits don't race on the doc range.
- **Webview command allowlist.** Only IDs in `webviewAllowedCommandIds` (derived from `commandsCatalog.ts`) can be invoked via the `command` postMessage channel.

The bridge-state-machine invariants (`isUserBusy`, `applyHostLoad` deferral, doc-version guard, echo suppression) live inside the embed bundle, in `apps/arrows-ts/src/embed/`. They are documented next to that code.

## License

Apache-2.0, matching the parent repo.
