# RFC-001: Prose Styling and Auto-Injected CSS Cleanup

## Summary

Remove redundant auto-injected CSS from the HTML shell, include `@tailwindcss/typography` by default, and clean up MDX template styling. The framework currently injects CSS that duplicates Tailwind utilities and a custom `.prose` implementation that conflicts with the standard typography plugin.

## Background

### Full production HTML audit

Everything injected into a production page's HTML (in order of appearance):

```
<head>
  1. Hydration error suppression script      ~20 lines JS
  2. Theme persistence script                 ~1 line JS (only with ?color_mode=)
  3. Meta tags                                from page metadata
  4. <title>                                  from page metadata
  5. Import map                               React dependency URLs
  6. Modulepreload hints                      <link rel="modulepreload"> for page + layouts
  7. Tailwind CSS                             <link> to compiled CSS file
  8. .md preview styles                       GitHub CSS from CDN (only for .md previews)
  9. User link/style/script tags              from page metadata
  10. Production styles <style> block          body reset, .prose, .container, utilities <<<
</head>
<body>
  11. <div id="root" class="vf-tailwind">     wrapper with data attributes
  12.   <div id="veryfront-content">           content wrapper with data attributes
  13.     [SSR content]
  14.   </div>
  15. </div>
  16. <div id="veryfront-portals">             for modals/portals
  17. Hydration data JSON                      <script type="application/json">
  18. User script tags                         from page metadata
  19. Production scripts                       ~500 lines inline JS: SPA router,
                                               component loader, hydration,
                                               prefetching, scroll memory,
                                               progress bar, LRU cache,
                                               version tracking
</body>
```

### Items marked for cleanup (this RFC)

| # | What | Status |
|---|------|--------|
| 10 | Production `<style>` block | **Remove** — redundant with Tailwind |
| 11 | `class="vf-tailwind"` on root | **Review** — overlaps with Tailwind preflight |

### Items that are correct / out of scope

| # | What | Status |
|---|------|--------|
| 1 | Hydration error suppression | Needed — catches React error #4 |
| 2 | Theme persistence | Needed — only injected with `?color_mode=` param |
| 3-6 | Meta, title, import map, preloads | Needed — standard HTML shell |
| 7 | Tailwind CSS link | Needed — compiled project CSS |
| 8 | .md preview styles | Needed — separate preview feature |
| 12 | `#veryfront-content` wrapper | Needed — hydration target |
| 16 | `#veryfront-portals` | Needed — modals/portals |
| 17 | Hydration data JSON | Needed — component tree reconstruction |
| 19 | Production scripts (SPA router etc) | Out of scope — separate concern, works correctly |

### What gets injected where (CSS only)

There are three separate contexts that inject CSS, and they overlap:

**1. Dev/Preview** (`html-shell-generator.ts` -> `dev-styles.ts`):
- Error overlay styles — needed
- `.animate-bounce-delay-200` / `.animate-bounce-delay-400` — unused, no component references these
- View transition styles — needed

**2. Production** (`html-shell-generator.ts` -> `production-styles.ts`):
- `body` reset (margin, font-family, line-height)
- Custom `.prose` rules (h1-h3 margins, p margins, code/pre styling)
- `.vf-tailwind { width: 100% }`
- `.container` with breakpoint media queries
- `.mx-auto`, `.px-4`, `.py-8`, `.max-w-4xl` utilities

**3. App route renderer fallback** (`build-app-route-renderer.ts`):
- Its own duplicate copy of ALL the same CSS (body reset, .prose, .container, utilities)
- Loading spinner styles (`.loading-container`, `.loading-spinner`) — dead CSS, no HTML uses these classes
- Wraps content in: `<div class="container mx-auto px-4 py-8 prose max-w-4xl">`
- Only used for layoutless MDX/pages (no `layout.tsx`)

**4. Theme variables** (`theme-variables.ts`):
- CSS custom properties for theming (`:root` vars)
- `.vf-tailwind` base styles (margin reset, line-height, `font-family: Inter ... !important`)
- NOTE: `generateThemeVariables()` is exported but **never called** outside of tests — this is dead code. The Inter `!important` font override does NOT make it into production.

### The `.prose` class flow

```
MDX page request
       |
       v
  Has layout.tsx?
   |           |
  Yes          No
   |           |
   v           v
  Rendered    Fallback: build-app-route-renderer.ts
  as React    wraps in <div class="prose ...">
  children    |
   |          v
   v        .prose class APPLIED
  .prose class NOT applied
   |          |
   v          v
  Unstyled    Gets custom .prose CSS
  content     (not typography plugin)
```

All CLI templates have `layout.tsx` -> `.prose` never applies to them.

### Problems

1. **Redundant utilities**: `.container`, `.mx-auto`, `.px-4`, `.py-8`, `.max-w-4xl` are standard Tailwind classes generated by JIT when found in source. Injecting them separately is redundant.

2. **Redundant body reset**: Tailwind preflight already handles `body { margin: 0 }`, font-family, and line-height.

3. **Custom `.prose` conflicts with standard**: The hand-written `.prose` CSS is a subset of `@tailwindcss/typography`. If a user enables the typography plugin, the two conflict.

4. **Duplicated CSS**: `build-app-route-renderer.ts` has its own complete copy of the same CSS that `production-styles.ts` has. Two separate inline style blocks doing the same thing.

5. **Dead CSS in dev**: `.animate-bounce-delay-200` and `.animate-bounce-delay-400` are defined but never referenced in any component.

6. **MDX templates have no prose styling**: Template MDX files render as unstyled HTML inside layouts, bypassing the `.prose` wrapper entirely.

7. **Dead code**: `generateThemeVariables()` in `theme-variables.ts` is exported but never called — the Inter `!important` override and `:root` CSS vars never make it into any page.

8. **Redundant wrapper divs**: Production HTML has two nested wrapper divs (`#root > #veryfront-content`). `#root` only holds `class="vf-tailwind"` (just `width: 100%`) and data attributes. `#veryfront-content` is the actual React hydration target. These could be collapsed into a single div.

## Proposal

### 1. Include `@tailwindcss/typography` by default

**File**: `src/html/styles-builder/css-hash-cache.ts`

```typescript
export const DEFAULT_STYLESHEET = `@import "tailwindcss";
@plugin "@tailwindcss/typography";
@custom-variant dark (&:is(.dark, [data-theme="dark"]) *, &:is(.dark, [data-theme="dark"]));`;
```

Users who don't use `prose` pay zero cost — Tailwind only generates CSS for classes found in source files.

### 2. Remove `production-styles.ts`

Everything in this file is either:
- Handled by Tailwind preflight (`body` reset)
- Handled by Tailwind JIT (`.container`, `.mx-auto`, `.px-4`, `.py-8`, `.max-w-4xl`)
- Replaced by the typography plugin (`.prose`)

Delete the file. Remove `getProductionStyles` from exports and the `modeStyles` injection in `html-shell-generator.ts:199`.

### 3. Clean up `build-app-route-renderer.ts`

This file has its own duplicate inline CSS block (lines 108-223) and wraps content in a magic `.prose` div.

- Remove the duplicate inline CSS (body reset, .prose, .container, utilities, loading spinner — all dead or redundant)
- Remove the auto-wrapped `<div class="container mx-auto px-4 py-8 prose max-w-4xl">`
- If a user wants prose styling on layoutless pages, they add `className="prose"` themselves

### 4. Clean up `dev-styles.ts`

Remove unused `.animate-bounce-delay-200`, `.animate-bounce-delay-400`, and `@keyframes vf-bounce`.

Keep:
- Error overlay styles
- View transition styles

### 5. Remove `.vf-tailwind` and collapse wrapper divs

**Current production HTML**:
```html
<div id="root" class="vf-tailwind" data-veryfront-slug="" data-veryfront-mode="production">
  <div id="veryfront-content" data-slug="" data-layout="default" data-ssr-hash="...">
    [content]
  </div>
</div>
<div id="veryfront-portals"></div>
```

**Why two divs exist**: No hard technical reason. `#root` is an outer framework wrapper (`vf-tailwind` class + metadata), `#veryfront-content` is the React hydration target. They evolved separately but serve no purpose that couldn't be handled by a single div. The data attributes on `#root` are set server-side and never change client-side. `suppressHydrationWarning` is already on `<body>`.

**What `#root` contributes**:
- `class="vf-tailwind"` — just `width: 100%` (redundant, body is already full-width)
- `data-veryfront-slug=""` — project slug
- `data-veryfront-mode="production"` — mode identifier
- Conditionally omits `vf-tailwind` class when `noLayout` is true

**What `#veryfront-content` contributes**:
- React hydration target (`hydrateRoot(container, tree)`)
- `data-slug=""` — duplicates the slug from `#root`
- `data-layout="default|none"` — layout mode
- `data-ssr-hash="..."` — SSR content hash

**Proposed**: Collapse to a single `<div id="root">`:

```html
<div id="root" data-veryfront-slug="" data-veryfront-mode="production" data-layout="default" data-ssr-hash="...">
  [content]
</div>
<div id="veryfront-portals"></div>
```

- Remove `#veryfront-content` entirely
- Move `data-layout` and `data-ssr-hash` onto `#root`
- Drop `class="vf-tailwind"` and its CSS
- Drop duplicate `data-slug` (already have `data-veryfront-slug`)
- Update all `getElementById('veryfront-content')` calls to `getElementById('root')`

**What references these IDs** (all need updating):

| File | Reference | Change |
|------|-----------|--------|
| `src/html/utils.ts` | `buildRootAttributes()` + `buildContentAttributes()` | Merge into single function |
| `src/html/html-shell-generator.ts` | Generates both `<div>` wrappers | Single `<div id="root">` |
| `src/html/hydration-script-builder/templates/renderer.ts` | `getElementById('veryfront-content')` | Change to `'root'` |
| `src/html/hydration-script-builder/templates/router.ts` | `getElementById('veryfront-content')` | Change to `'root'` |
| `src/html/hydration-script-builder/templates/spa-renderer.ts` | `getElementById('veryfront-content')` | Change to `'root'` |
| `src/studio/element-selector-injector.ts` | Regex matching both IDs | Simplify to just `id="root"` |
| `src/server/build-app-route-renderer.ts` | `<div id="root" class="vf-tailwind">` | Drop `vf-tailwind` |
| `src/html/styles-builder/theme-variables.ts` | `.vf-tailwind` CSS + `generateThemeVariables()` | Delete file (dead code — never called) |

**Risk**: Low. The only consumer of `#veryfront-content` is internal framework code (hydration scripts, studio injector). No user code references it. The `#root` ID is already the conventional React mount target.

### 6. Remove `PROSE_MAX_WIDTH` constant

**File**: `src/utils/constants/html.ts`

Only used by `production-styles.ts`. No longer needed.

### 7. Update MDX templates to use `prose`

Replace verbose `[&_]` wrapper divs with:

```mdx
<div className="prose dark:prose-invert">

# About
...

</div>
```

**Files**:
- `cli/templates/files/minimal/app/about/page.mdx`
- `cli/templates/features/mdx/files/app/docs/page.mdx`
- `cli/templates/features/mdx/files/app/docs/getting-started/page.mdx`
- `cli/templates/features/mdx/files/app/docs/core-concepts/page.mdx`

### 8. Keep `.md` preview rendering as-is

The `.md` preview flow (GitHub CSS from CDN, `markdown-body` class) is a separate dev/preview-only feature. No changes needed.

### 9. Keep color mode / theme persistence as-is

The theme persistence script (`localStorage.setItem('theme', ...)`) injected when `color_mode` URL param is used is needed and correct.

## Files affected

| File | Action |
|------|--------|
| `src/html/styles-builder/css-hash-cache.ts` | Add `@plugin "@tailwindcss/typography"` to default stylesheet |
| `src/html/styles-builder/production-styles.ts` | Delete |
| `src/html/styles-builder/production-styles.test.ts` | Delete |
| `src/html/styles-builder/index.ts` | Remove `getProductionStyles` export |
| `src/html/index.ts` | Remove `getProductionStyles` export |
| `src/html/html-shell-generator.ts` | Remove `getProductionStyles` import/call, remove `modeStyles` for prod path |
| `src/html/styles-builder/dev-styles.ts` | Remove bounce animation classes |
| `src/html/styles-builder/theme-variables.ts` | Delete (dead code — never called) |
| `src/html/utils.ts` | Merge `buildRootAttributes` + `buildContentAttributes` into single function |
| `src/html/html-shell-generator.ts` | Collapse two wrapper divs into single `<div id="root">` |
| `src/html/hydration-script-builder/templates/renderer.ts` | `getElementById('veryfront-content')` → `getElementById('root')` |
| `src/html/hydration-script-builder/templates/router.ts` | `getElementById('veryfront-content')` → `getElementById('root')` |
| `src/html/hydration-script-builder/templates/spa-renderer.ts` | `getElementById('veryfront-content')` → `getElementById('root')` |
| `src/studio/element-selector-injector.ts` | Simplify regex to just match `id="root"` |
| `src/server/build-app-route-renderer.ts` | Remove duplicate inline CSS, remove auto-wrapped prose div |
| `src/utils/constants/html.ts` | Remove `PROSE_MAX_WIDTH` |
| `cli/templates/files/minimal/app/about/page.mdx` | Use `prose dark:prose-invert` wrapper |
| `cli/templates/features/mdx/files/app/docs/page.mdx` | Use `prose dark:prose-invert` wrapper |
| `cli/templates/features/mdx/files/app/docs/getting-started/page.mdx` | Use `prose dark:prose-invert` wrapper |
| `cli/templates/features/mdx/files/app/docs/core-concepts/page.mdx` | Use `prose dark:prose-invert` wrapper |

## Open questions

1. ~~**Collapsing wrapper divs**~~: Confirmed safe — no hard technical reason for two divs, all consumers are internal framework code.

2. **Layoutless MDX fallback**: If we remove the prose wrapper, what's the fallback for pages without `layout.tsx`? Just render raw content? Or require a layout?

3. **Typography plugin loading**: The plugin is loaded via esm.sh in the plugin-loader. Confirm this works reliably and doesn't add latency to builds.

4. **Production inline scripts**: The ~500-line inline SPA router/hydration script is a separate concern but worth noting — could it be an external file instead of inline? (Out of scope for this RFC.)

## Follow-up: Minify production HTML and inline scripts

Tailwind CSS output is already minified (`getProjectCSS` passes `minify: true`), but the HTML shell and inline scripts are not. The production output currently includes:

- Unminified inline JS (~500 lines of SPA router, component loader, hydration logic) with comments, debug conditionals, and full whitespace
- Unminified HTML shell with extra whitespace and newlines

Consider minifying inline `<script>` blocks and collapsing HTML whitespace for production builds. This would reduce page weight and improve initial parse time. Could use a lightweight JS minifier (e.g. `esbuild.transform` with `minify: true`) at build time for the inline scripts.
