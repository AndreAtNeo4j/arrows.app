# How to test arrows-code

The commands are in [README.md](README.md#commands). This is what each layer covers and when to run it, fastest to slowest.

## 1. Unit tests (vitest, <5s)

`npx nx test arrows-code-*` (the libs) and `npm test` (the VS Code extension src).

Covers: graph read/write round-trips, layout algorithms, patch ops, structural validation, webview request/response envelope, command catalog, Cypher clause picker, import-URL parser.

## 2. Electron smoke test (~10s)

`npm run commands-test` boots a real VS Code Electron host and asserts the extension activates and every contributed command resolves. Run before packaging — it catches activation-event regressions unit tests can't see.

## 3. End-to-end (Playwright, ~30s)

`npm run e2e` drives the embed bundle in a real browser against the arrows-ts dev server (port 4200), asserting the postMessage protocol over canvas interactions.

## 4. Manual sanity check inside VS Code

`npm run install:local`, then `Cmd+Shift+P → Developer: Reload Window`. If the old version is still active after a reload, the extension host is caching — close **all** VS Code windows and reopen.

Open `arrows-code/fixtures/examples/social.arrows` (or the sidebar's "New from example…") and verify: canvas renders, drag a node, edit JSON in a side panel — both directions round-trip without jitter.

## Pre-package gate

`npm run package` runs `build → test → commands-test → vsce package` in sequence. If any step fails the `.vsix` is not produced.
