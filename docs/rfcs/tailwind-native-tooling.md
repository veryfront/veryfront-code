# RFC: Native Tailwind CSS v4 Tooling

## Status: Draft

## Tailwind Version

**Target: Tailwind CSS v4.x** (currently 4.1.8)

- Preview CDN: `@tailwindcss/browser@4` (pinned in `cdn.ts`)
- Production JIT: `tailwindcss@4.x` npm package
- No Tailwind v3 support

## Problem

Current Tailwind implementation is hacky:

1. **Custom JIT compiler** (`tailwind4-compiler.ts`) reimplements what Tailwind does natively
2. **Directive stripping** in `globals-css-handler.ts` removes `@import "tailwindcss"`, `@theme`, etc.
3. **Manual normalization** for edge cases (aspect ratios, CSS variables)
4. **No Play CDN in preview** - missing live class updates

## Goals

1. **Preview mode**: Use `@tailwindcss/browser` (Play CDN) with live globals.css updates
2. **Production mode**: Server-side JIT using native `tailwindcss` API (cleaner implementation)
3. **Remove hacks**: No directive stripping, no manual normalization

---

## Proposed Solution

### Preview Mode

Include Tailwind v4 Play CDN + globals.css content in a `<style type="text/tailwindcss">` block:

```html
<!-- Tailwind CSS v4 Browser CDN -->
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">
@import "tailwindcss";
@theme {
  --color-primary: hsl(var(--primary));
  /* ... */
}
/* rest of globals.css content */
</style>
```

The CDN handles:
- `@import "tailwindcss"` resolution
- `@theme` processing
- Class scanning from DOM
- Live recompilation on DOM changes

For HMR: Replace the `<style type="text/tailwindcss">` content when globals.css changes.

### Production Mode

Server-side JIT using Tailwind CSS v4 `compile()` API:

```typescript
// Tailwind CSS v4 programmatic API
import { compile } from "tailwindcss";

// 1. Read globals.css (with all directives)
const globalsCSS = await adapter.fs.readFile("globals.css");

// 2. Create compiler
const compiler = await compile(globalsCSS);

// 3. Extract classes from rendered HTML + project sources
const classes = extractClassesFromHTML(html);

// 4. Build final CSS
const css = compiler.build(classes);
```

Output as `<style>` block (no CDN script needed).

---

## File Changes

### Files to Modify

#### 1. `src/html/html-shell-generator.ts`

**Current (lines 279-282):**
```typescript
${options.mode === "development" || options.proxyEnvironment === "preview" ? tailwindCDN : ""}
${tailwindCSS ? `<style>...JIT compiled...</style>` : ""}
```

**New:**
```typescript
// Preview: CDN + globals.css in <style type="text/tailwindcss">
// Production: JIT-compiled CSS in regular <style>
${isPreviewMode ? generatePreviewTailwind(globalsCSSContent) : ""}
${!isPreviewMode && tailwindCSS ? `<style>${tailwindCSS}</style>` : ""}
```

Add new function:
```typescript
function generatePreviewTailwind(globalsCSSContent: string, nonce?: string): string {
  const cdnUrl = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
  return `
    <script src="${cdnUrl}"${nonce ? ` nonce="${nonce}"` : ""}></script>
    <style type="text/tailwindcss"${nonce ? ` nonce="${nonce}"` : ""}>
${globalsCSSContent}
    </style>`;
}
```

**Changes:**
- Remove `generateTailwindV4Theme()` call for preview (globals.css has the theme)
- Remove separate theme `<style type="text/tailwindcss">` block
- Pass raw globals.css content (no stripping) to preview mode
- Keep JIT for production only

---

#### 2. `src/server/handlers/dev/globals-css-handler.ts`

**Current:** Strips all Tailwind directives before serving.

**New:** Two modes:
- **Preview**: Don't serve globals.css separately (it's inlined in HTML)
- **Production**: Serve for HMR but keep directives (or remove handler entirely)

```typescript
// Option A: Remove handler entirely for preview mode
// globals.css is inlined in <style type="text/tailwindcss">

// Option B: Keep handler but stop stripping directives
async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
  const filePath = joinPath(ctx.projectDir, "globals.css");
  const css = await ctx.adapter.fs.readFile(filePath);

  // NO STRIPPING - serve as-is
  return this.respond(
    this.createResponseBuilder(ctx)
      .withCache("no-cache")
      .withContentType("text/css; charset=utf-8", css, HTTP_OK)
  );
}
```

**Recommendation:** Option A - remove link tag for preview, inline in HTML.

---

#### 3. `src/html/styles-builder/tailwind4-compiler.ts`

**Current:** Complex custom implementation with:
- Class extraction (keep)
- Normalization hacks (remove)
- Aspect ratio aliases (remove)
- Safelist (simplify)

**New:** Simplified for production-only use:

```typescript
import { compile } from "tailwindcss";

let compilerPromise: Promise<Awaited<ReturnType<typeof compile>>> | null = null;

async function getCompiler(globalsCSSContent: string): Promise<...> {
  // Cache compiler per globals.css content
  const compiler = await compile(globalsCSSContent);
  return compiler;
}

export async function generateTailwindCSS(
  html: string,
  globalsCSSContent: string,
  projectClasses?: Set<string>,
): Promise<string> {
  const compiler = await getCompiler(globalsCSSContent);

  // Extract classes from HTML
  const classes = extractClassNames(html);

  // Add project-wide classes
  if (projectClasses) {
    for (const cls of projectClasses) {
      classes.add(cls);
    }
  }

  // Let Tailwind handle everything natively
  return compiler.build(Array.from(classes));
}
```

**Remove:**
- `normalizeClass()` - let Tailwind handle syntax
- `generateAliases()` - no longer needed
- `generateAspectRatioAliases()` - Tailwind v4 supports this
- `SAFELIST_CLASSES` - or keep minimal set
- `buildCustomTheme()` - theme comes from globals.css

**Keep:**
- `extractClassNames()` - simple regex extraction
- `extractClassNamesFromSource()` - for project class scanning

---

#### 4. `src/html/styles-builder/tailwind-config.ts`

**Current:** Generates `@theme` CSS and provides CDN URL.

**Changes:**
- `getTailwindCDNUrl()` - keep, used for preview
- `generateTailwindV4Theme()` - **remove** (theme in globals.css)

---

#### 5. `src/html/styles-builder/index.ts`

Update exports:
- Remove `generateTailwindV4Theme` export
- Update `generateTailwind4CSS` signature to accept globals.css content

---

#### 6. `src/rendering/orchestrator/html.ts`

**Current:** Loads globals.css content for link tag check.

**New:** Pass globals.css content to shell generator for:
- Preview: Inline in `<style type="text/tailwindcss">`
- Production: Pass to JIT compiler

```typescript
// Load globals.css content
const globalsCSSContent = await this.loadGlobalsCSS();

// Pass to shell generator
const { start, end } = await generateHTMLShellParts(
  meta,
  {
    ...options,
    globalsCSSContent, // NEW: raw content for preview/prod
  },
  params,
  props,
  contentForTailwind,
);
```

---

### Files to Remove/Deprecate

| File | Action | Reason |
|------|--------|--------|
| `src/html/styles-builder/theme-variables.ts` | Keep for fallback | Used when no globals.css exists |
| `src/html/styles-builder/production-styles.ts` | Keep | Fallback styles |

---

## Implementation Steps

### Phase 1: Preview Mode (Play CDN)

1. Modify `html-shell-generator.ts`:
   - Add `generatePreviewTailwind()` function
   - Include globals.css content in `<style type="text/tailwindcss">`
   - Remove separate JIT CSS in preview mode

2. Update `globals-css-handler.ts`:
   - Remove directive stripping
   - Or remove handler for preview (globals inlined in HTML)

3. Update HMR for globals.css:
   - Signal to reload `<style type="text/tailwindcss">` block
   - Or full page reload on globals.css change

### Phase 2: Production Mode (Clean JIT)

1. Simplify `tailwind4-compiler.ts`:
   - Remove normalization hacks
   - Remove alias generation
   - Accept globals.css content directly

2. Update orchestrator:
   - Pass globals.css content to compiler
   - Only generate JIT CSS in production mode

### Phase 3: Cleanup

1. Remove unused code:
   - `generateTailwindV4Theme()`
   - Normalization functions
   - CDN-based theme injection

2. Update tests

---

## Migration

### For Projects

No migration needed. Projects with `globals.css` containing:
```css
@import "tailwindcss";
@theme { ... }
```

Will work automatically. The renderer handles both modes transparently.

### Breaking Changes

None expected. The output CSS should be identical or better (Tailwind native handling).

---

## Questions

1. **HMR for globals.css in preview**: Full reload or hot-swap the style block?
2. **Fallback without globals.css**: Keep generating default theme, or require globals.css?
3. **Class extraction**: Keep current regex or use more robust parser?

---

## References

- [Tailwind CSS v4 Browser CDN](https://tailwindcss.com/docs/installation/play-cdn)
- [Tailwind CSS compile() API](https://tailwindcss.com/docs/functions-and-directives)
- Current implementation: `src/html/styles-builder/tailwind4-compiler.ts`
