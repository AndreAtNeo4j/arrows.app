# IntelliJ host

The IntelliJ Platform plugin that embeds the arrows canvas in a JCEF browser,
the JVM counterpart to `../vscode`. Gradle/Kotlin project, separate from the
nx/TypeScript build.

## Status

- **`protocol/`** — built and tested. `parseInboundMessage` + `dispatchInbound`
  mirror the TS `host-protocol` wire contract (a Kotlin host can't import the TS
  lib, so it validates the same shapes). Run `./gradlew :protocol:test`.
- **`plugin/`** — JCEF `FileEditor` for `*.arrows` with the postMessage bridge
  and two-way Document sync, built on the IntelliJ Platform SDK. Compiles and
  packages (`buildPlugin`). Sidebar/commands/export round-trip not wired yet.

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

## What it will be

A thin Kotlin/Gradle adapter. It reimplements only host plumbing against the
IntelliJ Platform:

- `JBCefBrowser` loading the shared embed bundle (served via a scheme handler)
- `JBCefJSQuery` ↔ `executeJavaScript` for the postMessage bridge
- `FileEditorProvider` / `FileEditor` for `*.arrows`, two-way synced to the Document
- `ToolWindow` sidebar, `AnAction` commands, `PasswordSafe`, `PersistentStateComponent`

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
