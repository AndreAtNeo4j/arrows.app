# Arrows for IntelliJ — Architecture

How the plugin works internally, and why it's built this way. For install/usage see [README.md](README.md); for the subsystem-wide layout see [../../README.md](../../README.md).

## The one-sentence version

The plugin is a thin Kotlin/JCEF **adapter**: it loads the same arrows.app web bundle the VS Code extension uses into an embedded Chromium browser, and bridges it to a JetBrains `FileEditor` over a small JSON message protocol. No canvas, renderer, or inspector is reimplemented here — they cascade from the web app via the bundle.

## Two modules: `:core` (pure) and `:plugin` (impure)

```
:core    pure Kotlin — no IntelliJ SDK, no IO, no threads, no JCEF
   ▲     parsing, validation, layout, rename, URL allowlist, the wire protocol
   │     (depends only on org.json)
:plugin  IntelliJ Platform + JCEF adapter — all side effects live here
         FileEditor, browser, document writes, dialogs, notifications, clipboard
```

The dependency runs **one way**: `:plugin → :core`, never the reverse.

**Why split it.** Everything decision-shaped — does this URL parse to an allowed host? what does this graph lay out to? which import payload is a real graph? — is pure logic in `:core` with no IDE dependency, so it's unit-tested headlessly in milliseconds (`./gradlew :core:test`) without booting an IDE. `:plugin` is left as a glue layer that's mostly untestable-by-nature platform calls, kept as thin as possible. This is ports-and-adapters: `:core` defines the `HostActions` port; `ArrowsFileEditor` is the adapter that satisfies it with real IDE effects.

## Runtime data flow

```
.arrows file ──► Document (IntelliJ's source of truth, plain JSON)
     │                 │
     │   load          │ documentChanged
     ▼                 ▼
  JBCefBrowser  ◄────────────  ArrowsFileEditor  ──────────► IntelliJ UI
  (embed bundle)                (implements HostActions)      (dialogs, notifications,
     │   ▲                          ▲     │                    clipboard, file save)
     │   │ window.postMessage       │     │ executeJavaScript("window.postMessage(…)")
     │   └──────────────────────────┘     │
     ▼                                    ▼
  JBCefJSQuery ──► dispatchInbound(raw, this) ──► parseInboundMessage ──► InboundMessage
  (embed→host)        (HostMessageDispatcher)        (HostProtocol)        (sealed)
```

- **Document is canonical.** The `.arrows` JSON in the IntelliJ `Document` is the single source of truth. Host→embed `load` messages push it into the canvas; embed→host `graph-changed` messages write back through a `WriteCommandAction` (so it's undoable).
- **Embed→host** travels over a `JBCefJSQuery`: injected JS forwards every `window.postMessage` to the host, where `dispatchInbound` parses it and calls the matching `HostActions` method.
- **Host→embed** is just `executeJavaScript("window.postMessage(<json>, '*')")`.

## The pieces

| File | Layer | Role |
|---|---|---|
| `core/HostProtocol.kt` | core | `InboundMessage` sealed type + `parseInboundMessage` — the embed→host trust boundary |
| `core/HostMessageDispatcher.kt` | core | `HostActions` port + `dispatchInbound` (pure routing, no `when` in the adapter) |
| `core/GraphEdits.kt` | core | import-URL/JSON parsing, label & rel-type listing and rename |
| `core/GraphLayout.kt` | core | the 5 layout algorithms (mirror of `libs/graph-logic`) |
| `core/GraphValidate.kt` | core | structural validation (same diagnostic codes as the TS validator) |
| `core/HostLogic.kt` | core | URL allowlist, defensive JSON parsing, arrows.app share-URL, path/mime helpers |
| `core/RequestTracker.kt` | core | correlates async export requests across threads by id |
| `core/CommandSurface.kt` | core | filters the bundled command catalog to the subset IntelliJ supports |
| `plugin/ArrowsFileEditorProvider.kt` | plugin | registers the canvas as the editor for `*.arrows` |
| `plugin/ArrowsFileEditor.kt` | plugin | the adapter — browser, bridge, command routing, document writes |
| `plugin/EmbedSchemeHandler.kt` | plugin | serves the bundle over a custom `http://arrows.local/` scheme |
| `plugin/ArrowsToolWindow.kt` | plugin | sidebar: workspace `.arrows` files + bundled examples |
| `plugin/PopupChooser.kt`, `Notifications.kt` | plugin | native list popups and notification helpers |

## Why the non-obvious choices

**Why embed the bundle instead of a native Swing/JCEF canvas.** The canvas is large and evolves on the web app. Reimplementing it per host would fork behavior three ways (web / VS Code / IntelliJ). Embedding the same Vite bundle means canvas changes cascade automatically on the next build; the host only owns plumbing.

**Why a custom `http://arrows.local/` scheme, not `file://`.** Chromium resolves relative asset paths and enforces CSP against the page's origin. Loaded from `file://`, the bundle's relative imports and cross-origin rules break. The scheme handler ([EmbedSchemeHandler.kt](plugin/src/main/kotlin/app/arrows/intellij/EmbedSchemeHandler.kt)) serves bundle files from plugin resources under a stable HTTP origin, and 404s anything `embedResourcePath` rejects (path traversal / double-encoding).

**Why canvas-only, no JSON text tab.** A second (text) editor makes IntelliJ a 2-editor composite, which makes it remember "open as JSON" per file and trips a platform NPE on close (`providerSelected!!`). `getPolicy() = HIDE_DEFAULT_EDITOR` ([ArrowsFileEditorProvider.kt](plugin/src/main/kotlin/app/arrows/intellij/ArrowsFileEditorProvider.kt)) avoids it. Review the JSON via the git diff instead.

**Why all the `invokeLater` and the two guards.** JCEF callbacks fire **off** the EDT, but reading/writing a `Document` and touching UI must happen **on** it — so every handler hops via `ApplicationManager.invokeLater`. Two races are then guarded explicitly:
- *Echo loop* — when the host writes the document (`onGraphChanged`), the resulting `documentChanged` would re-push a `load` to the canvas. The `applyingHostEdit` flag suppresses that.
- *Mid-edit clobber* — a long off-EDT layout, or an in-flight rename, can finish after the document already changed. Each compares the current `doc.text`/`modificationStamp` against what it started from and bails rather than overwriting a newer edit.

**Why `RequestTracker`.** SVG/Cypher/GraphQL exports are *asks* of the canvas: the host posts a `request` with an id and awaits a `response`. Requests are created on the EDT; responses arrive on the JCEF thread. `RequestTracker` is a `ConcurrentHashMap` of `CompletableFuture` keyed by id, with a 10s timeout so a silent canvas can't hang a future forever.

**Why defensive JSON parsing.** `.arrows` content and import URLs are untrusted, and `org.json` parses recursively with no depth cap — deeply nested input throws `StackOverflowError` (an `Error`, not a catchable `JSONException`). `parseJsonObjectOrNull` bounds nesting before parsing. See [HostLogic.kt](core/src/main/kotlin/app/arrows/intellij/core/HostLogic.kt).

## The cross-language mirror (and its guard)

The JVM host **cannot** import the TypeScript libs. The two things genuinely shared across hosts are the **web bundle** and the **message protocol**; everything else `:core` needs (layout math, validator codes, the `MAX_LAYOUT_NODES` cap, import parsing) is reimplemented from `libs/graph-logic` / `format.ts` and marked with "keep in sync" notes.

Because hand-mirrored copies drift silently, [`CrossLanguageParityTest`](core/src/test/kotlin/app/arrows/intellij/core/CrossLanguageParityTest.kt) reads the canonical TS sources at test time and fails if the Kotlin layout ids/order or node cap diverge. That converts the comments from honor-system into an enforced check.

## Build order

The canvas bundle must exist before the plugin packages it:

```sh
cd ../vscode && npm run build              # produces the embed bundle
cd ../intellij && ./gradlew :plugin:buildPlugin
```

The bundle lands in the plugin's resources under `/embed/`, where the scheme handler reads it.
