# arrows-code

Brings arrows.app into developer IDEs — a VS Code extension and an IntelliJ plugin. Self-contained under `arrows-code/`; deletable without breaking the host monorepo.

Layout, the cascade from the web app, and decoupling/import rules live in [README.md](README.md). This file is the working agent rules; it does not repeat them.

**Cross-language caveat.** A Kotlin host (IntelliJ) cannot import the TypeScript
libs. The libs de-duplicate logic among TypeScript hosts; the two things both
hosts genuinely share are the **web bundle** and the **protocol contract**.
Logic that must be single-source across languages belongs in the bundle.

## Commands

```bash
npx nx test arrows-code-graph-logic              # one lib
npx nx run-many -t test --projects=arrows-code-* # all libs
cd arrows-code/extensions/vscode && npm run install:local  # build + install (then Reload Window in VS Code)
cd arrows-code/extensions/vscode && npm run build        # build only (no install)
cd arrows-code/extensions/vscode && npm run commands-test  # real VS Code Electron host
cd arrows-code/extensions/vscode && npm run package      # build .vsix
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

## Shared canvas - one codebase, every host

Neither host has its own copy of the graph canvas, renderer, or inspector. Both embed the arrows-ts app as a Vite bundle.

- All canvas logic lives in `apps/arrows-ts/src/` (shared with the web app).
- The embed-specific code is only under `apps/arrows-ts/src/embed/`: the postMessage bridge (`bridge/`), the entry point (`main.tsx`), and the thin UI overlay (`ui/EmbedToolbar.tsx`, `ui/EmbedActionMenu.tsx`, `ui/EmbedFooter.tsx`).
- **To change any canvas behaviour**, edit `apps/arrows-ts/src/` as you would for the web app, then rebuild: `cd arrows-code/extensions/vscode && npm run build`.

Never duplicate canvas or renderer code into `arrows-code/`. If something only works in one surface, the split belongs in `embed/`.

## Architecture invariants

The VS Code host invariants (immutable graph, one panel per URI, single edit chain, webview command allowlist) are in [README.md](README.md#architecture-invariants).

In the embed bundle (`apps/arrows-ts/src/embed/`):

- **Bridge state machine.** Outbound (`shouldEmit`) and inbound (`applyHostLoad` deferral) consult the same `isUserBusy` predicate. Don't add a new busy-condition to one side without the other.
- **Document-version guard.** Every webview→host edit checks `originatingDocVersion` against current. Stale edits drop.
- **Echo suppression.** Inbound `load` is compared canonically (entityType stripped) against the last outbound emit; matches are no-ops.

When editing the bridge, run its torture spec `apps/arrows-ts/src/embed/bridge/bridge.spec.ts` — it hammers interleaved drag/edit/load through a fake store. Add new bridge scenarios there, not ad-hoc tests.

## Test conventions

Co-located `*.spec.ts(x)` next to source. Vitest.

`commands-test.mjs` boots a real VS Code Electron host via `@vscode/test-electron`. Run before packaging.
