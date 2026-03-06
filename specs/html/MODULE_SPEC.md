# NLSpec: src/html/

## Purpose

Server-side HTML document generation for the Veryfront rendering pipeline. This module produces complete HTML shells (doctype through closing `</html>` tag) for SSR output, including metadata injection, hydration scripts, import maps, Tailwind CSS compilation, and client-side SPA navigation infrastructure. It serves two code paths: (1) the primary `generateHTMLShellParts`/`wrapInHTMLShell` path used by the renderer for full-page SSR, and (2) the legacy `injectHTMLContent` template-injection path for custom HTML layouts.

## Public API

### Exports (from `index.ts` barrel)

| Export | Type | Description |
|--------|------|-------------|
| `getDevStyles` | `(nonce?) => string` | Dev-mode CSS (error overlay, dev indicator styles) |
| `isFullHTMLDocument` | `(content) => boolean` | Detects if string is a complete HTML document |
| `buildAttributes` | `(attrs) => string` | Builds escaped HTML attribute string |
| `escapeHTML` | `(str) => string` | Escapes HTML special characters |
| `escapeHtml` | alias | Alias for `escapeHTML` |
| `injectHTMLContent` | `(template, content, metadata, options) => string` | Template-based HTML injection for custom layouts |
| `generateHTMLShellParts` | `(meta, options, params?, props?, content?) => Promise<{start, end}>` | Primary SSR HTML generation (traced) |
| `wrapInHTMLShell` | `(content, meta, options, params?, props?) => Promise<string>` | Wraps content in full HTML shell |
| `processMetadata` | `(meta) => ProcessedMetadata` | Extracts and renders metadata from frontmatter |
| `extractHTMLMetadata` | `(page, layout?) => HTMLMetadata` | Merges page+layout frontmatter into metadata |
| `generateMetaTags` | `(metadata) => string` | Renders `<meta>` tags |
| `generateLinkTags` | `(metadata) => string` | Renders `<link>` tags (with font preload crossorigin) |
| `generateScriptTags` | `(metadata, nonce?) => string` | Renders `<script>` tags |
| `generateStyleTags` | `(metadata, nonce?) => string` | Renders `<style>`/stylesheet `<link>` tags |
| `buildImportMapJson` | `(options?) => Promise<string>` | Builds ES module import map JSON |
| `buildRootAttributes` | `(slug, mode, noLayout, ssrHash?) => string` | Builds `<div id="root">` attributes |
| `shouldDisableLayout` | `(frontmatter?) => boolean` | Checks if layout is disabled via frontmatter |
| `HTMLGenerationOptions` | type | Options for HTML shell generation |
| `HTMLMetadata` | type | Metadata structure for HTML documents |
| `HydrationData` | type | Hydration data passed to client |
| `ImportMapConfig` | type | Import map configuration |
| `MDXFrontmatter` | type | MDX frontmatter shape |
| `ProcessedMetadata` | type | Result of `processMetadata` |
| `InjectHTMLContentOptions` | type | Options for `injectHTMLContent` |
| `generateHydrationData` | `(slug, params, props, options) => string` | Generates hydration JSON for client |
| `getDevScripts` | `(slug, config, params?, props?, nonce?, options?) => string` | Dev-mode client scripts (error logger, HMR, renderer) |
| `getProdScripts` | `(slug, params?, props?, nonce?) => string` | Production client scripts (router, loader, renderer) |

### Sub-module: `styles-builder/`

| Export | Type | Description |
|--------|------|-------------|
| `getDevStyles` | `(nonce?) => string` | Error overlay styles (different from top-level) |
| `generateTailwindCSS` | `(stylesheet, candidates, options?) => Promise<TailwindResult>` | Core Tailwind CSS JIT compilation |
| `generateTailwind4CSS` | `(html) => Promise<string>` | Deprecated: extract+compile in one call |
| `getProjectCSS` | `(slug, stylesheet, candidates, options?) => Promise<{css, hash, fromCache}>` | Project-level CSS with distributed caching |
| `regenerateCSSByHash` | `(hash) => Promise<string \| undefined>` | JIT CSS regeneration from cached inputs |
| `extractCandidates` | `(content) => string[]` | Extract Tailwind class candidates from source |
| `extractCandidatesFromFiles` | `(files) => Set<string>` | Extract candidates from file list |
| `hashCSS` | `(css) => string` | DJB2 hash of CSS (max 8 chars) |
| `cacheCSSAsync` | `(css, hash?, inputs?) => Promise<string>` | Cache CSS in local+distributed cache |
| `clearCSSCache` | `() => void` | Clear all local CSS caches |
| `getCSSByHash` | `(hash) => string \| undefined` | Synchronous local cache lookup |
| `invalidateCompiler` | `() => void` | Clear all cached Tailwind compilers |
| `invalidateProjectCSS` | `(slug) => void` | Invalidate project-specific CSS cache |
| `formatCSSError` | `(error) => CSSErrorInfo` | Classify and format CSS compilation errors |
| `pregenerateCSSFromFiles` | `(options) => Promise<void>` | Pre-generate CSS from file list (fire-and-forget) |

### Sub-module: `hydration-script-builder/`

| Export | Type | Description |
|--------|------|-------------|
| `generateHydrationData` | fn | Serialize hydration state to JSON |
| `getDevScripts` | fn | Compose dev client scripts |
| `getProdScripts` | fn | Compose production client scripts |
| `generateDevErrorLoggerScript` | fn | Client error logger IIFE |
| `generateDevComponentManifestScript` | fn | Window component manifest assignment |
| `generateDevClientRendererScript` | fn | Dev renderer (module script with imports) |
| `generateProdHydrationScript` | fn | Legacy prod hydration (not used externally) |
| `getRouterScript` | fn | SPA router template (navigation, prefetch, scroll) |
| `getLoaderScript` | fn | Component loader template (cache, dynamic import) |
| `getRendererScript` | fn | Page renderer template (hydration, layout wrapping) |
| `getSpaRendererScript` | fn | SPA mode renderer template |
| `getSpaLoaderScript` | fn | SPA mode component loader template |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `zod` | `zod` | Schema validation for HTMLGenerationOptions, HydrationData |
| `tailwindcss` | `tailwindcss` | CSS JIT compilation |
| `tailwindcss/plugin` | `tailwindcss/plugin` | Plugin shims for compiled binaries |
| `#veryfront/types` | internal | RenderMetadata, ComponentProps |
| `#veryfront/config` | internal | VeryfrontConfig type |
| `#veryfront/cache/backend.ts` | internal | Distributed cache backends (Redis/memory) |
| `#veryfront/observability` | internal | OpenTelemetry tracing spans |
| `#veryfront/utils` | internal | Logger, constants, path utils |
| `#veryfront/transforms` | internal | MDX types, ESM package registry, markdown utils |
| `#veryfront/modules` | internal | Import map defaults, path resolver, route manifest |
| `#veryfront/build` | internal | CSS minification |

## Behaviors

### Behavior 1: Full HTML Shell Generation

- **Given**: SSR-rendered content, render metadata, and generation options
- **When**: `wrapInHTMLShell` or `generateHTMLShellParts` is called
- **Then**: Returns a complete HTML5 document with:
  - DOCTYPE, `<html>` with lang attribute and optional theme attributes
  - `<head>` with meta tags, title, import map, modulepreload hints, Tailwind CSS link
  - `<body>` with root div (data attributes), content, hydration JSON, mode-specific scripts
  - Production: hydration error suppression script, hashed CSS link, prod renderer
  - Development: error overlay styles, error logger, HMR script, dev renderer
  - Preview: dev scripts without error logger, preview-HMR script
- **Edge cases**: Empty cssHash in production omits CSS link (avoids 404); frontmatter `layout: false` sets `data-layout="none"`; colorScheme only applied when `colorSchemeFromParam` is true

### Behavior 2: Template-Based HTML Injection

- **Given**: An HTML template with `{{ content }}`, `{{ title }}`, `{{ meta }}`, etc. placeholders
- **When**: `injectHTMLContent` is called
- **Then**: Replaces placeholders with rendered content and metadata tags; injects dev/prod scripts before `</body>`; injects hydration data for client pages; injects Studio bridge when `studioEmbed` is true
- **Edge cases**: Missing `</body>` tag means scripts are not injected; `{{ devScripts }}` placeholder takes precedence over auto-injection

### Behavior 3: HTML Document Detection

- **Given**: A string of HTML content
- **When**: `isFullHTMLDocument` is called
- **Then**: Returns `true` only if content starts with `<!doctype` (case-insensitive, allowing leading whitespace) AND contains `<html` AND `</html>`
- **Edge cases**: Missing closing tag returns false; doctype without html tags returns false

### Behavior 4: HTML Escaping

- **Given**: A string potentially containing `&`, `<`, `>`, `"`, `'`
- **When**: `escapeHTML` is called
- **Then**: All special characters are replaced with HTML entities; null/undefined coerced to empty string; non-strings coerced via `String()`
- **Edge cases**: `escapeHtml` is a strict alias (same reference)

### Behavior 5: Metadata Extraction and Processing

- **Given**: Page frontmatter and optional layout frontmatter
- **When**: `extractHTMLMetadata` is called
- **Then**: Merges layout (base) + page (override) frontmatter; promotes nested `metadata` object to top level; converts `og.*` to `property="og:*"` meta tags; converts `twitter.*` to `name="twitter:*"` meta tags; passes through non-reserved keys
- **Edge cases**: Default title is "Veryfront App"; arrays for meta/links/scripts/styles preserved, non-arrays become empty arrays

### Behavior 6: Import Map Construction

- **Given**: Optional project directory, config, and custom imports
- **When**: `buildImportMapJson` is called
- **Then**: Detects React version from package.json or config; selects CDN provider (esm.sh default); includes platform utility paths for local module server; merges custom imports; adds `@/` alias to `/_vf_modules/`
- **Edge cases**: `bundled` mode only includes React (no platform utilities); `self-hosted` mode uses local paths for veryfront packages; plain `Record<string, string>` input treated as raw import map

### Behavior 7: Tailwind CSS JIT Compilation

- **Given**: A stylesheet string and candidate class names
- **When**: `generateTailwindCSS` is called
- **Then**: Fetches Tailwind base CSS (cached), compiles with plugin support, optionally minifies; returns `{css, error?}`
- **Edge cases**: Plugin loading uses esm.sh fetch + temp file in Deno; compiler cache bounded to 10 entries with LRU eviction; plugins loaded via global shims for compiled binary compatibility

### Behavior 8: Project CSS Caching

- **Given**: A project slug, stylesheet, and candidate set
- **When**: `getProjectCSS` is called
- **Then**: Checks local fallback cache -> distributed cache -> generates fresh; stores in both caches; deduplicates concurrent requests via in-flight promise map
- **Edge cases**: Cache keyed by `slug:environment:stylesheetHash:candidatesHash:profileHash`; stale entries (expired or mismatched candidates) are evicted; hash-level cache populated on generation so any pod can serve `/_vf/css/{hash}.css`

### Behavior 9: CSS JIT Regeneration

- **Given**: A CSS content hash
- **When**: `regenerateCSSByHash` is called
- **Then**: Looks up cached inputs (unified cache first, legacy inputs cache fallback); regenerates CSS; verifies hash matches; persists regenerated entry
- **Edge cases**: Returns `undefined` if no cached inputs or hash mismatch; deduplicates via in-flight map

### Behavior 10: Client-Side SPA Router

- **Given**: Hydration data embedded in the HTML
- **When**: The renderer script runs in the browser
- **Then**: Hydrates the React tree; sets up SPA navigation (link interception, popstate handling); prefetches on hover with debounce; manages LRU page data cache with TTL; shows/hides navigation progress bar; handles scroll position memory
- **Edge cases**: External links, modifier keys, `target="_blank"`, download links bypass SPA; hash-only links scroll to element; version mismatch triggers full reload; hydration timeout after 10s

### Behavior 11: Candidate Extraction

- **Given**: Source code content (HTML, JSX, TSX, MDX)
- **When**: `extractCandidates` is called
- **Then**: Returns deduplicated array of potential Tailwind utility class names matching the comprehensive regex pattern (supports negatives, important, variants, arbitrary values, container queries, CSS variables)
- **Edge cases**: Empty/whitespace-only content returns empty array; `extractCandidatesFromFiles` filters by source file extension (.tsx, .jsx, .ts, .js, .mdx)

### Behavior 12: CSS Error Classification

- **Given**: A Tailwind CSS compilation error message
- **When**: `formatCSSError` is called
- **Then**: Matches against ordered rule list to produce structured `{title, message, suggestion}`; categories: Plugin Options Not Supported, Plugin Not Found, Invalid @theme, CSS Syntax Error, generic fallback

## Constraints

- All HTML attribute values must be escaped via `escapeHTML` to prevent XSS
- JSON embedded in `<script>` tags must escape `<` as `\u003c` to prevent script breakout
- CSP nonce must be propagated to all inline `<script>` and `<style>` tags
- Import map `<script type="importmap">` must appear before any module scripts
- Modulepreload hints skipped in preview/studio-embed mode (HMR timestamps cause unused preload warnings)

## Error Handling

- Tailwind CSS compilation errors are caught, formatted with user-friendly suggestions, and either logged (in `getProjectCSS`) or returned as `TailwindResult.error`
- Plugin loading failures are cached in `pluginErrors` map to avoid repeated fetch attempts
- Distributed cache failures fall back to memory-only cache with logging
- `pregenerateCSSFromFiles` is fire-and-forget: errors are logged but never thrown

## Side Effects

- `getCompiler` fetches Tailwind base CSS from CDN on first call (cached thereafter)
- `loadModuleFromEsmSh` writes temp `.mjs` files to `/tmp/` (cleaned up in `finally`)
- `plugin-loader.ts` sets global shims on `globalThis` (`__tailwindPluginShim`, `__tailwindDefaultThemeShim`, `__tailwindColorsShim`, `localStorage`)
- Distributed cache operations (get/set/delByPattern) make network calls to Redis/API
- `registerCache` registers cache instances for memory monitoring

## Performance Constraints

- Compiler cache bounded to 10 entries (LRU eviction)
- Local CSS cache bounded to 100 entries
- Local CSS inputs cache bounded to 50 entries
- Project CSS local fallback bounded to 50 entries with 24h TTL
- In-flight deduplication for `getProjectCSS` and `regenerateCSSByHash`
- `pregenerateCSSFromFiles` designed to run in parallel with other initialization

## Invariants

- `hydrateRoot` always uses `identifierPrefix: 'vf'` (must match SSR)
- The router, loader, and renderer scripts are concatenated in that order (loader depends on router's `DEBUG`/`log`/`logError` variables)
- `escapeHTML` always returns a string (never null/undefined)
- CSS content hash is deterministic (DJB2, max 8 chars via base-36)
- Page frontmatter always overrides layout frontmatter on key collision
