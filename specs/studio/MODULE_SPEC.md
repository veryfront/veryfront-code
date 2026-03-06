# NLSpec: src/studio/

## Purpose

The `src/studio/` module provides the communication and editing infrastructure between Studio (the visual editor) and the Renderer (the preview iframe). It defines the postMessage protocol schemas, injects element selectors for the navigator tree, computes source hashes for change detection, and contains the **bridge** -- a client-side script bundle injected into the preview iframe that handles inspect mode overlays, console capture, screenshot capture, a full Lexical-based markdown/MDX editor with collaborative editing via Yjs, slash menus, inline toolbars, block drag-and-drop, and bidirectional messaging with Studio.

## Public API

### Exports

| Export | Type | Source File | Description |
|--------|------|-------------|-------------|
| `BundlerMessage` (type) | Zod inferred type | `types.ts` re-exports from `schemas/` | Bundler error/warning message shape |
| `LogMessage` (type) | Zod inferred type | `types.ts` | Console log message shape |
| `LogMethod` (type) | Zod enum inferred type | `types.ts` | Console method name union |
| `MessageFromRenderer` (type) | Zod discriminated union | `types.ts` | All postMessage actions from Renderer to Studio |
| `MessageFromStudio` (type) | Zod discriminated union | `types.ts` | All postMessage actions from Studio to Renderer |
| `NavigatorNode` (type) | Zod recursive type | `types.ts` | Component tree node shape |
| `NavigatorNodeType` (type) | Zod enum inferred type | `types.ts` | Node type union: root, component, element, markdown, text |
| `DATA_VF_ID` | string constant | `types.ts` | `"data-vf-id"` attribute name |
| `DATA_VF_SELECTOR` | string constant | `types.ts` | `"data-vf-selector"` attribute name |
| `DATA_VF_TEXT` | string constant | `types.ts` | `"data-vf-text"` attribute name |
| `DATA_VF_IGNORE` | string constant | `types.ts` | `"data-vf-ignore"` attribute name |
| `injectElementSelectors` | function | `element-selector-injector.ts` | Injects `data-vf-selector` attributes into HTML for navigator |
| `isStudioEmbed` | function | `element-selector-injector.ts` | Checks if `?studio_embed=true` is in URL |
| `computeSourceHash` | function (re-export) | `hash-utils.ts` | FNV-1a hash of source content for change detection |
| `STUDIO_BRIDGE_BUNDLE` | string constant | `bridge/bridge-bundle.generated.ts` | Pre-bundled bridge script for injection into preview iframe |
| Schema validators | Zod schemas | `schemas/studio.schema.ts` | `MessageFromRendererSchema`, `MessageFromStudioSchema`, etc. |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `zod` | `zod` | Schema validation for postMessage protocol types |
| `fnv1aHash` | `#veryfront/utils/hash-utils.ts` | Source content hashing (re-exported as `computeSourceHash`) |
| `lexical` | `esm.sh` (dynamic) | Rich text editor for markdown editing in bridge |
| `yjs` | `esm.sh` (dynamic) | Collaborative editing via Y.Text CRDT in bridge |
| `y-websocket` | `esm.sh` (dynamic) | WebSocket transport for Yjs in bridge |
| `html2canvas-pro` | `cdn.jsdelivr.net` (dynamic) | Screenshot capture in bridge |

## Behaviors

### Behavior 1: Element selector injection
- **Given**: Raw HTML from the renderer containing a `<div id="root">` content area
- **When**: `injectElementSelectors(html, options?)` is called
- **Then**: Every non-ignored element inside the root gets a unique `data-vf-selector="prefix-tag-N"` attribute; elements with existing `data-vf-*` attributes, void elements in ignored sets, and elements outside the content root are skipped
- **Edge cases**: Void elements (img, br, etc.) get selectors but do not increment the `inIgnoredElement` counter; self-closing tags are handled; nested ignored elements track depth correctly

### Behavior 2: PostMessage protocol validation
- **Given**: A message object from either Studio or Renderer
- **When**: Validated against `MessageFromRendererSchema` or `MessageFromStudioSchema`
- **Then**: The discriminated union validates the `action` field and enforces required/optional fields per action type
- **Edge cases**: `openFile` accepts both `number` and `string` for `lineNumber`; `setSelectedNode` from Renderer accepts `null` id; navigation actions (`goBack`, `goForward`, `reload`) have no payload fields

### Behavior 3: Bridge initialization
- **Given**: The bridge script is loaded in the preview iframe (either embedded in Studio or standalone with wsUrl)
- **When**: `initConfig()` + `init()` run
- **Then**: In embedded mode: overlay styles are injected, hover/selection overlays created, console capture and error handling installed, inspect mode listeners attached, mutation observer watches for DOM changes, and `appLoaded`/`appUpdated`/`onPageTransitionEnd` messages are posted to Studio. In standalone mode with `wsUrl`: only markdown editor and Yjs are set up (no overlays or Studio messaging).
- **Edge cases**: If `window.parent === window` and no `studio_embed` param and no `wsUrl`, initialization is skipped entirely

### Behavior 4: Inspect mode (hover/select)
- **Given**: Bridge is initialized and inspect mode is toggled on via `toggleInspectMode` message
- **When**: User clicks or hovers over elements with `data-vf-id`, `data-vf-selector`, or `data-node-id` attributes
- **Then**: Hover overlay positions over the hovered element; click selects the element and posts `setSelectedNode` with node metadata (name, type, file, line, column, text) to Studio; overlays reposition on scroll/resize
- **Edge cases**: Touch events (`pointerType === "touch"`) are ignored for hover; clicking outside inspectable elements deselects; removing a selected element from DOM auto-deselects

### Behavior 5: Navigator tree building and sync
- **Given**: A DOM mutation occurs (childList or characterData) within the root element
- **When**: The debounced (150ms) tree update fires
- **Then**: A signature (element count + tag concatenation) is compared against the last sent signature; if changed, `buildNavigatorTree` walks the DOM producing a recursive `NavigatorNode` tree and posts `treeUpdated` to Studio
- **Edge cases**: Elements with `data-vf-ignore`, `display: none`, or in `DOM_IGNORE_TAGS` (SCRIPT, STYLE, LINK, META, NOSCRIPT) are skipped; elements without an ID get auto-assigned `data-vf-selector`

### Behavior 6: Console capture and error forwarding
- **Given**: Bridge is initialized in embedded mode
- **When**: `console.log/debug/info/warn/error/table/clear/dir` is called, or a runtime error / unhandled rejection occurs
- **Then**: The original console method is called, then a `logEvent` message with serialized arguments and timestamp is posted to Studio; errors post `runtimeError` with file/line/column info and hide overlays
- **Edge cases**: Error objects serialize to `{__isError, message, stack, name}`; undefined to `{__isUndefined}`; functions to `{__isFunction, name}`; symbols to `{__isSymbol, description}`; circular objects fall back to `String(arg)`

### Behavior 7: Markdown editor lifecycle
- **Given**: The current page is a `.md` or `.mdx` file (determined by `pagePath`)
- **When**: In Simple mode: editor activates automatically. In Advanced mode: "Edit" button appears; clicking it or having `?edit=true` activates edit mode
- **Then**: A full-screen editor overlay is created with Lexical rich-text surface, textarea fallback (if Lexical fails to load), slash menu, inline toolbar, block drag handle, selection overlays, and MDX blocks bar. Content is parsed into frontmatter + body, raw blocks (HTML/JSX/mermaid fences) are tokenized for safe Lexical editing, and the URL is updated with `?edit=true`
- **Edge cases**: If Lexical dynamic import fails, falls back to plain textarea; MDX blocks bar only shown for `.mdx` files; frontmatter is preserved verbatim through editing

### Behavior 8: Yjs collaborative editing
- **Given**: Markdown editor is active and `wsUrl` + `yjsGuid` are configured
- **When**: `setupMarkdownYjsConnection` is called
- **Then**: Yjs + y-websocket are dynamically imported, a Y.Doc with the configured GUID connects via WebSocket, Y.Text is bound to the file ID, awareness broadcasts user identity (extracted from authToken JWT cookie), remote changes trigger `applyMarkdownContent`, local changes are synced to Y.Text via minimal text diffs, and remote cursors/selections are rendered as colored overlays
- **Edge cases**: Non-binary WebSocket messages are filtered to prevent y-websocket parse errors; if user has unsaved local edits when sync completes, local content is pushed to Y.Text rather than overwritten; a monotonically-increasing `setupId` guards against stale async callbacks; `disposeMarkdownYjs` fully tears down all state for clean re-entry

### Behavior 9: Slash menu
- **Given**: Markdown editor is active with Lexical
- **When**: User types `/` at the start of a line (optionally with leading whitespace)
- **Then**: A popup menu appears near the caret showing filtered commands (text, h1-h3, lists, quote, code block, image); arrow keys navigate, Enter/Tab applies, Escape dismisses; applying a command replaces the `/query` text with the appropriate markdown syntax and positions the caret
- **Edge cases**: Menu is limited to 8 commands; position is clamped to viewport bounds; menu hides when selection is non-collapsed or caret moves away from slash pattern

### Behavior 10: Screenshot capture
- **Given**: Studio sends a `screenshot` message
- **When**: `captureScreenshot` or `captureMultipleSections` is called
- **Then**: html2canvas-pro is loaded (once, cached), the page is optionally scrolled, a canvas is rendered, and a data URL is posted back as `screenshotResult`; for multi-section, the page is divided into viewport-height sections captured sequentially
- **Edge cases**: Empty canvas (0x0) or invalid data URL return `{success: false, error}`; original scroll position is always restored in a finally block; CSP restrictions on script-src produce a warning

### Behavior 11: Origin-scoped messaging security
- **Given**: The preview iframe receives postMessage events
- **When**: `isFromStudio` validates the event
- **Then**: Only messages from `localhost`, `*.veryfront.org`, `*.veryfront.com`, or `*.veryfront.dev` origins are accepted; the first valid origin is captured and used as `targetOrigin` for all subsequent `postToStudio` calls to prevent information leakage
- **Edge cases**: Messages from `window` itself (e.g. React DevTools) are rejected; if no valid origin has been captured yet, `"*"` is used as fallback

### Behavior 12: Offset mapping (editor <-> source <-> rendered)
- **Given**: The markdown editor has content with raw block tokens and optional frontmatter
- **When**: Selection coordinates need to be converted between Lexical rendered text, editor markdown source, body (without frontmatter), and full source
- **Then**: Three coordinate spaces are bridged: rendered (DOM text offsets via Range.toString), editor (markdown with tokens), and source (full file with frontmatter + raw blocks). `buildEditorRenderedMaps` uses greedy character alignment; `editorOffsetToBodyOffset`/`bodyOffsetToEditorOffset` handle token expansion/contraction; frontmatter length is added/subtracted for source offsets
- **Edge cases**: Lexical appends trailing newlines that don't exist in markdown source (stripped before alignment); unconsumed rendered characters produce a console warning; bias parameter ("start"/"end") controls which side of a token boundary an offset maps to

## Constraints

- Bridge modules run in the browser (preview iframe) and must work without build tools -- all non-standard dependencies are loaded via dynamic ESM imports from CDN
- The bridge script is pre-bundled into a single string constant (`STUDIO_BRIDGE_BUNDLE`) by a build step; source modules are the source of truth
- Circular imports exist between `bridge-markdown-core.ts`, `bridge-markdown-editor.ts`, and `bridge-markdown-yjs.ts` -- all cross-module calls must remain inside function bodies, never at module top-level
- The `schemas/` Zod schemas define the contract between Studio and Renderer and must remain backward-compatible

## Error Handling

- Console capture serialization errors fall back to `String(arg)`
- Lexical import failure falls back to textarea editor
- html2canvas failures return `{success: false, error}` rather than throwing
- Yjs connection failures are logged but do not crash the editor
- `postToStudio` wraps `postMessage` in try/catch with debug logging
- Invalid origins in `isFromStudio` return false (no throw)
- All DOM Range operations are wrapped in try/catch to handle races with Lexical DOM updates

## Side Effects

- Injects a `<style>` element into the preview iframe's `<head>` for overlay/editor CSS
- Monkey-patches `console.*` methods to intercept logging
- Registers global event listeners on `window` (message, error, unhandledrejection, scroll, resize, beforeunload) and `document` (click, pointerover, pointerout, selectionchange, keydown, mousedown)
- Creates a `MutationObserver` on the root element
- Appends overlay and editor DOM elements to `document.body`
- Dynamically loads external scripts (html2canvas, Lexical, Yjs) from CDNs
- Modifies `window.location.href` for route changes and `window.history.replaceState` for edit mode URL
- Sets `data-theme` and class on `document.documentElement` for color mode
- Writes to `window.__VF_STUDIO_BRIDGE_DEBUG` when debug mode is enabled

## Performance Constraints

- Tree updates are debounced at 150ms with signature-based deduplication
- Selection sync is debounced at 80ms
- Content sync to Studio is debounced at 120ms
- Inline toolbar and selection overlay updates use `requestAnimationFrame`
- Slash menu updates use `setTimeout(0)` (microtask-like)
- Overlay repositioning on scroll/resize is debounced at 16ms (~60fps)

## Invariants

- Frontmatter is never modified by the markdown editor -- it passes through `extractMarkdownParts` and `composeMarkdownContent` unchanged
- Raw blocks (HTML/JSX/mermaid fences) are tokenized before Lexical editing and restored verbatim afterward -- Lexical never sees or modifies their content
- The `markdownApplyingRemoteUpdate` flag prevents echo-back: when true, the Lexical update listener returns early and queues edits for reconciliation after the remote apply settles
- `studioOrigin` is write-once: captured from the first valid incoming message and never changed
- `setupId` (monotonically increasing) ensures stale Yjs async callbacks from previous edit sessions are silently discarded
- The `isFromStudio` origin allowlist is the sole gatekeeper for all incoming messages
