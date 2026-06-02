# IntelliJ host

The IntelliJ Platform plugin that embeds the arrows canvas in a JCEF browser,
the JVM counterpart to `../vscode`. Gradle/Kotlin project, separate from the
nx/TypeScript build.

## Status

- **`protocol/`** — built and tested. `parseInboundMessage` + `dispatchInbound`
  mirror the TS `host-protocol` wire contract (a Kotlin host can't import the TS
  lib, so it validates the same shapes). Run `./gradlew :protocol:test`.
- **`plugin/`** — JCEF `FileEditor` for `*.arrows` with the postMessage bridge
  and two-way Document sync. Sidebar (new/example/import), the kebab commands
  (copy/save Cypher, save SVG/GraphQL, open in arrows.app, rename label/rel
  type), and the export round-trip are wired. validate and auto-arrange need
  graph-logic the JVM host can't run; show-JSON-side-by-side is dropped (a 2nd
  editor on the file trips a platform NPE and makes files reopen as JSON).

## Tests

```sh
./gradlew test            # all: pure :protocol unit tests + :plugin integration tests
./gradlew :protocol:test  # fast pure-logic units (parse, dispatch, host logic, request tracker)
./gradlew :plugin:test    # BasePlatformTestCase integration (editor provider, workspace scan) in a headless IDE
```

Pure logic is unit-tested in `:protocol` (mirrors the VS Code `src/*.spec.ts`).
Host wiring is integration-tested in `:plugin` (the counterpart of the VS Code
`commands-test.mjs`). JCEF command bodies need a live browser, so — like the VS
Code webview checks — they aren't exercised in headless tests.

## Build & install locally

```sh
./install-local.sh      # macOS / Linux
install-local.bat       # Windows
```

Packages the plugin to `plugin/build/distributions/plugin.zip`, then install via
**Settings > Plugins > (gear) Install Plugin from Disk…**. Or run a sandbox IDE
with it loaded: `./gradlew :plugin:runIde`.

The canvas needs the shared embed bundle: build it first (`cd ../vscode &&
npm run build`), which produces `dist/apps/arrows-ts`; the plugin build copies it
in. Without it, a placeholder page loads.

## What it is

A thin Kotlin/Gradle adapter — only host plumbing against the IntelliJ Platform:

- `JBCefBrowser` (windowed) loading the shared embed bundle via a scheme handler
- `JBCefJSQuery` ↔ `executeJavaScript` for the postMessage bridge
- `FileEditorProvider` / `FileEditor` for `*.arrows`, two-way synced to the Document
- `ToolWindow` sidebar + the embed kebab commands

## What it must NOT do

Reimplement feature logic. Layout, patch, validation, JSON read/write, and the
graph operations live once — in the web bundle and the `@arrows-code/*` libs.
A Kotlin host cannot import the TypeScript libs, so anything that must be
single-source across both hosts belongs in the **bundle**, invoked over the
protocol. The libs de-duplicate among TypeScript hosts; the bundle and the
wire-protocol contract are what the two hosts genuinely share.

## Toolchain

Gradle + IntelliJ Platform Gradle plugin — separate from the nx/TypeScript
build. It consumes the built embed bundle and mirrors the `host-protocol`
message contract.
