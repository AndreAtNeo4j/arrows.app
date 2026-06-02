# arrows-code

Subsystem brings arrows.app into VS Code. Self-contained under `arrows-code/`; deletable without breaking the host monorepo.

## Layout

```
arrows-code/
├── hosts/                editor-specific adapters (one dir per editor)
│   ├── vscode/           VS Code extension (only VS-Code-coupled code)
│   └── intellij/         IntelliJ/JCEF plugin (planned, Kotlin/Gradle)
├── libs/                 host-agnostic, no editor SDK
│   ├── format-json/      read/write canonical .arrows JSON
│   ├── graph-logic/      layout + patch + validation algorithms
│   └── host-protocol/    embed↔host wire contract + parseInboundMessage
└── fixtures/examples/    bundled .arrows examples shown in sidebar
```

**Separation rule.** `hosts/*` is editor-specific and may import that editor's
SDK. `libs/*` is host-agnostic and must never import an editor SDK. If logic is
shared, it goes in a lib — not inlined in a host.

**Cross-language caveat.** A Kotlin host (IntelliJ) cannot import the TypeScript
libs. The libs de-duplicate logic among TypeScript hosts; the two things both
hosts genuinely share are the **web bundle** and the **protocol contract**.
Logic that must be single-source across languages belongs in the bundle.

Only allowed imports from the host repo: `@neo4j-arrows/{model,graphics,selectors}`. Never `apps/arrows-ts/**`.

## Commands

```bash
npx nx test arrows-code-validator               # one project
npx nx run-many -t test --projects=arrows-code-* # all
cd arrows-code/hosts/vscode && npm run install:local  # build + install (then Reload Window in VS Code)
cd arrows-code/hosts/vscode && npm run build        # build only (no install)
cd arrows-code/hosts/vscode && npm run commands-test  # real VS Code Electron host
cd arrows-code/hosts/vscode && npm run package      # build .vsix
```

## Comment policy

Default: write no comment.

Add one only when the *why* isn't visible in the code:

- A platform quirk (`acquireVsCodeApi` is one-shot; jsdom `getContext` throws when canvas npm pkg is absent)
- A historical bug the code now guards against (echo ping-pong, mid-drag clobber)
- A non-obvious invariant a future reader would otherwise break
- A reference to an external contract that constrains the code (Cypher escape rules, VS Code message protocol)

Never write:

- File header doc-blocks describing what the file does (the export names already do)
- Comments restating the next line (`// increment counter` above `counter++`)
- Multi-paragraph comments. One sentence max.
- Comments narrating sections of a function (`// 1. Parse`, `// 2. Validate`). Extract a function if you need a heading.
- TODO/FIXME without an issue link. Move to GitHub issues.
- Justification that belongs in the commit message ("fix for bug #123", "added for the X flow").
- `@param`/`@returns` JSDoc on TypeScript code - types already document those.

When trimming an existing comment, ask: would removing it confuse a competent reader? If no, remove.

## Shared canvas - one codebase, two surfaces

The VS Code extension does **not** have its own copy of the graph canvas, renderer, or inspector. It embeds the arrows-ts app as a Vite bundle.

- All canvas logic lives in `apps/arrows-ts/src/` (shared with the web app).
- The embed-specific files are only in `apps/arrows-ts/src/embed/`: the postMessage bridge (`bridge.ts`), the entry point (`main.tsx`), and the thin toolbar overlay (`EmbedToolbar.tsx`, `EmbedActionMenu.tsx`, `EmbedFooter.tsx`).
- **To change any canvas behaviour**, edit `apps/arrows-ts/src/` as you would for the web app, then rebuild: `cd arrows-code/hosts/vscode && npm run build`.

Never duplicate canvas or renderer code into `arrows-code/`. If something only works in one surface, the split belongs in `embed/`.

## Architecture invariants

Inside `arrows-code/`:

- **Graph is immutable.** Reducers and patch ops return new objects; never mutate in place.
- **One panel per document URI.** `PreviewProvider.panels` is a static Map; the provider is a singleton per extension host.
- **Single edit chain in `PreviewProvider`.** `applyChain: Promise<unknown>` serializes `applyEdit` calls so rapid webview emits don't race on the doc range. Don't introduce a second chain.
- **Webview command allowlist.** Only IDs in `webviewAllowedCommandIds` (from `commandsCatalog.ts`) can be invoked via the `command` postMessage channel.

In the embed bundle (`apps/arrows-ts/src/embed/`):

- **Bridge state machine.** Outbound (`shouldEmit`) and inbound (`applyHostLoad` deferral) consult the same `isUserBusy` predicate. Don't add a new busy-condition to one side without the other.
- **Document-version guard.** Every webview→host edit checks `originatingDocVersion` against current. Stale edits drop.
- **Echo suppression.** Inbound `load` is compared canonically (entityType stripped) against the last outbound emit; matches are no-ops.

When editing the bridge, run `apps/arrows-ts/src/embed/bridge.spec.ts` - it hammers interleaved drag/edit/load through a fake store.

## Test conventions

Co-located `*.spec.ts(x)` next to source. Vitest.

`commands-test.mjs` boots a real VS Code Electron host via `@vscode/test-electron`. Run before packaging.

The bridge has a torture spec (`apps/arrows-ts/src/embed/bridge.spec.ts`) that hammers interleaved drag/edit/load operations through a fake store. Add new bridge scenarios there, not new ad-hoc tests.
