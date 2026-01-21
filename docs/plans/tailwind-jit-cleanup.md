# Plan: Tailwind CSS v4 Server-Side JIT

## Goal

Simplify Tailwind implementation to use **server-side JIT only**, with **zero custom Tailwind logic**.

---

## Requirements (MUST HAVE)

1. **Support plugins** - `@plugin "@tailwindcss/typography"` must work
2. **Support theming** - `@theme { ... }` must work
3. **No custom Tailwind logic** - No normalization, aliases, safelists, or hacks
4. **Preview mode** - Single CSS for current page state (fast, incremental)
5. **Production mode** - Site-wide CSS extracted from all project files

---

## Principles

1. **Page never blows up** - CSS errors never crash the render, return last good CSS
2. **Stylesheet is source of truth** - Contains `@import "tailwindcss"`, `@plugin`, `@theme`
3. **Native Tailwind only** - Use `compile()` API, trust Tailwind completely
4. **Simple class extraction** - Plain text scanning like Tailwind does
5. **One compile path** - Same `compile()` call for preview and production

---

## Configuration

```typescript
// veryfront.config.ts
export default {
  tailwind: {
    // Path to main stylesheet (default: "globals.css")
    stylesheet: "globals.css",
  },
};
```

**Type definition:**
```typescript
// src/core/config/types.ts
interface TailwindConfig {
  /** Path to main stylesheet relative to project root. Default: "globals.css" */
  stylesheet?: string;
}

interface VeryfrontConfig {
  tailwind?: TailwindConfig;
}
```

**Resolution:**
```typescript
function getStylesheetPath(config?: VeryfrontConfig): string {
  return config?.tailwind?.stylesheet || "globals.css";
}

// Usage
const stylesheetPath = getStylesheetPath(ctx.config);
const stylesheetContent = await ctx.adapter.fs.readFile(stylesheetPath);
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  STYLESHEET (config.tailwind?.stylesheet || "globals.css")          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ @import "tailwindcss";                                          │ │
│  │ @plugin "@tailwindcss/typography";                              │ │
│  │ @plugin "tailwindcss-animate";                                  │ │
│  │ @theme {                                                        │ │
│  │   --color-primary: hsl(var(--primary));                        │ │
│  │   --font-sans: "Inter", system-ui, sans-serif;                 │ │
│  │ }                                                               │ │
│  │ /* Custom CSS */                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              ↓                                       │
│  NATIVE TAILWIND compile()                                          │
│  └── compile(globalsCSS, {                                          │
│        loadStylesheet: (id) => fetch tailwindcss base CSS           │
│        loadModule: (id) => import from esm.sh (plugins)             │
│      })                                                              │
│                              ↓                                       │
│  CLASS CANDIDATES (same for preview & production)                    │
│  └── Extract from ALL project files via Files API                   │
│      └── Pages + components + layouts + any .tsx/.jsx/.mdx          │
│                              ↓                                       │
│  compiler.build(candidates)                                          │
│  └── Tailwind generates CSS for valid classes only                  │
│  └── Tailwind handles ALL edge cases natively                       │
│                              ↓                                       │
│  OUTPUT                                                              │
│  ├── Preview: <style id="vf-tailwind-css"> (inline, HMR updates)    │
│  └── Production: <link href="/_vf/css/[hash].css"> (cacheable)      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Preview & Production (Same Path)

**Both use ALL project classes.** Simpler, one code path, no edge cases.

| Aspect | Preview | Production |
|--------|---------|------------|
| **Classes from** | All project files (Files API) | All project files (Files API) |
| **Includes** | Pages + components + layouts | Pages + components + layouts |
| **When compiled** | On request (cached per globals.css hash + class set) | Same |
| **HMR** | Push new CSS via WebSocket when classes change | N/A |
| **Plugins** | ✅ via esm.sh | ✅ via esm.sh |
| **@theme** | ✅ native | ✅ native |
| **Tailwind version** | v4 only | v4 only |

**Why all classes in preview too?**
- Simpler - one code path
- Components may be lazy-loaded, need their classes ready
- Tailwind v4 is fast, handles large candidate lists efficiently
- No risk of missing classes from dynamically loaded components

---

## The Single Compiler

**Delete `tailwind4-compiler.ts` complexity. Replace with:**

```typescript
import { compile } from "tailwindcss";

// Cache
let compiler: Awaited<ReturnType<typeof compile>> | null = null;
let lastGlobalsCSSHash = "";
let tailwindBaseCSS: string | null = null;
const pluginCache = new Map<string, unknown>(); // Cache loaded plugins

// Track plugin errors for error overlay
const pluginErrors: Map<string, string> = new Map();

/**
 * Load plugin from esm.sh (cached)
 * Throws on failure so error propagates to overlay
 */
async function loadPlugin(id: string): Promise<unknown> {
  if (pluginCache.has(id)) {
    // Check if this was a failed plugin
    if (pluginErrors.has(id)) {
      throw new Error(pluginErrors.get(id));
    }
    return pluginCache.get(id);
  }

  try {
    const mod = await import(`https://esm.sh/${id}`);
    const plugin = mod.default ?? mod;
    pluginCache.set(id, plugin);
    return plugin;
  } catch (error) {
    const errorMsg = `Failed to load plugin "${id}": ${error instanceof Error ? error.message : String(error)}`;
    logger.warn(`[Tailwind] ${errorMsg}`);

    // Cache the error so we show it consistently
    pluginErrors.set(id, errorMsg);

    // Throw so it propagates to error overlay
    throw new Error(errorMsg);
  }
}

/**
 * Get or create Tailwind compiler from globals.css
 * Handles: @import "tailwindcss", @plugin, @theme, custom CSS
 */
async function getCompiler(globalsCSS: string): Promise<typeof compiler> {
  const hash = hashString(globalsCSS);

  if (compiler && hash === lastGlobalsCSSHash) {
    return compiler;
  }

  // Fetch Tailwind base CSS (cached)
  if (!tailwindBaseCSS) {
    const res = await fetch(getTailwindCSSUrl());
    tailwindBaseCSS = await res.text();
  }

  // Create compiler with native Tailwind
  compiler = await compile(globalsCSS, {
    base: "/",

    // Handle @import "tailwindcss"
    loadStylesheet: async (id) => {
      if (id === "tailwindcss") {
        return { content: tailwindBaseCSS, base: "/", path: "/" };
      }
      return { content: "", base: "/", path: "/" };
    },

    // Handle @plugin "package-name" (cached)
    loadModule: async (id) => {
      const plugin = await loadPlugin(id);
      return { module: plugin, base: "/", path: "/" };
    },
  });

  lastGlobalsCSSHash = hash;
  return compiler;
}

// Default if no stylesheet exists
const DEFAULT_STYLESHEET = `@import "tailwindcss";`;

/**
 * Generate CSS from globals.css + class candidates
 *
 * @param globalsCSS - Project's globals.css content (or undefined for default)
 * @param candidates - Class candidates (from all project files)
 * @param options - { minify?: boolean }
 */
export async function generateTailwindCSS(
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: { minify?: boolean },
): Promise<string> {
  const css = stylesheet || DEFAULT_STYLESHEET;
  const compiler = await getCompiler(css);

  // Tailwind filters invalid classes automatically
  let output = compiler.build([...candidates]);

  // Minify for production
  if (options?.minify) {
    output = minifyCSS(output); // Use lightningcss or similar
  }

  return output;
}
```

---

## Class Extraction (Simple)

**Tailwind scans files as plain text.** We do the same:

```typescript
/**
 * Extract potential class candidates from content.
 * Same approach as Tailwind: scan as text, extract tokens.
 * Tailwind's build() filters out invalid ones.
 */
function extractCandidates(content: string): string[] {
  // Match anything that could be a Tailwind class
  const pattern = /[a-zA-Z][a-zA-Z0-9_\-:\/\[\]\.%#,()!']+/g;
  const matches = content.match(pattern) || [];
  return [...new Set(matches)];
}
```

**That's it.** No special handling for:
- `cn()`, `clsx()`, `cva()`, `tv()` - tokens extracted as text
- `aspect-[16/9]` - Tailwind v4 supports natively
- `bg-[--var]` - Tailwind v4 supports natively
- Template literals - static parts extracted as tokens

---

## File Changes

### 1. MERGE: globals-compiler.ts + tailwind4-compiler.ts

**Keep:** `globals-compiler.ts` approach (has loadModule for plugins)
**Delete:** Most of `tailwind4-compiler.ts` (normalization, aliases, safelists)
**Result:** Single unified compiler

```typescript
// src/html/styles-builder/tailwind-compiler.ts (NEW - merged)
export { generateTailwindCSS, extractCandidates };
```

### 2. REMOVE: CDN from HTML shell

**File:** `src/html/html-shell-generator.ts`

```diff
- ${options.mode === "development" || options.proxyEnvironment === "preview" ? tailwindCDN : ""}
- ${tailwindCSS ? `<style>...</style>` : ""}
+ ${tailwindCSS ? `<style id="vf-tailwind-css"${nonce ? ` nonce="${nonce}"` : ""}>${tailwindCSS}</style>` : ""}
```

**Remove:**
- `tailwindCDN` variable (lines 212-215)
- `generateTailwindV4Theme()` call - theme lives in globals.css
- `getTailwindCDNUrl()` import (for CDN script)

### 3. SIMPLIFY: class-cache.ts

Use simple `extractCandidates()` instead of complex regex patterns.

### 4. ADD: HMR CSS push

**File:** `src/server/dev-server/hmr/templates.ts`

```typescript
function handleUpdate(update) {
  // ... existing code ...

  // If CSS included in update, apply it
  if (update.css) {
    const style = document.getElementById('vf-tailwind-css');
    if (style) style.textContent = update.css;
  }
}
```

**Server side:** When file changes → re-extract classes → if changed → recompile → push CSS via WebSocket

---

## Files Summary

### DELETE (dead code)

| File | Reason |
|------|--------|
| `tailwind-jit.ts` | Old UnoCSS approach, never worked, unused |
| `tailwind4-compiler.ts` | All the hacks live here - replace with clean version |

### DELETE functions

| File | Function | Reason |
|------|----------|--------|
| `tailwind-config.ts` | `generateTailwindV4Theme()` | Theme lives in globals.css |
| `tailwind-config.ts` | `getTailwindCDNUrl()` | No more CDN script |
| `tailwind-config.ts` | `convertTailwindConfigForBrowser()` | Deprecated, unused |
| `tailwind-config.ts` | `generateTailwindConfig()` | Deprecated, unused |

### CREATE

| File | Purpose |
|------|---------|
| `tailwind-compiler.ts` | NEW unified compiler (merge globals-compiler.ts) |
| `css-handler.ts` | Handler for `/_vf/css/[hash].css` |

### MODIFY

| File | Action |
|------|--------|
| `globals-compiler.ts` | MERGE into tailwind-compiler.ts, then delete |
| `class-cache.ts` | SIMPLIFY extraction to plain text scanning |
| `html-shell-generator.ts` | REMOVE CDN, use JIT only |
| `index.ts` | UPDATE exports |
| `hmr/templates.ts` | ADD CSS push handling |

### KEEP (unchanged)

| File | Reason |
|------|--------|
| `theme-variables.ts` | Fallback when no stylesheet exists |
| `dev-styles.ts` | Dev mode styles |
| `production-styles.ts` | Production styles |

---

## What We're Removing (Hacks)

| Code | Why it's a hack | Native solution |
|------|-----------------|-----------------|
| `normalizeClass()` | Manual syntax fixing | Tailwind v4 handles all syntax |
| `generateAliases()` | CSS selector duplication | Not needed |
| `generateAspectRatioAliases()` | aspect-[16/9] workaround | Tailwind v4 native support |
| `SAFELIST_CLASSES` | Static class list | Extract from source |
| `needsNormalization()` | Detection logic | Not needed |
| `buildCustomTheme()` | Inline theme generation | Use globals.css @theme |
| CDN script | Runtime compilation | Server-side JIT |

---

## Output: Hashed Stylesheet

| Mode | Output | Caching |
|------|--------|---------|
| **Preview** | Inline `<style>` | No cache (HMR updates inline) |
| **Production** | `<link href="/_vf/css/[hash].css">` | Immutable, cache forever |

```typescript
// Generate hash from CSS content
function hashCSS(css: string): string {
  // Use first 8 chars of content hash
  return hashString(css).slice(0, 8);
}

// In html-shell-generator.ts
const cssHash = hashCSS(tailwindCSS);

if (options.mode === "development" || options.proxyEnvironment === "preview") {
  // Inline for HMR
  return `<style id="vf-tailwind-css">${tailwindCSS}</style>`;
} else {
  // Link to hashed file for production caching
  return `<link rel="stylesheet" href="/_vf/css/${cssHash}.css">`;
}
```

**Handler for `/_vf/css/[hash].css` (production only):**

```typescript
// src/server/handlers/css-handler.ts
export class CSSHandler extends BaseHandler {
  patterns = [{ pattern: "/_vf/css/:hash.css", method: "GET" }];

  // Only enabled in production - preview uses inline <style>
  enabled = (ctx) => ctx.mode === "production";

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const hash = ctx.params.hash;
    const css = await getCachedCSS(ctx.projectKey, hash);

    return this.respond(
      this.createResponseBuilder(ctx)
        .withCache("public, max-age=31536000, immutable") // Cache forever
        .withContentType("text/css", css)
    );
  }
}
```

**Summary:**
| Mode | URL | Cache Header |
|------|-----|--------------|
| Preview | N/A (inline `<style>`) | N/A |
| Production | `/_vf/css/a1b2c3d4.css` | `immutable, max-age=31536000` |

---

## Error Handling

**Strategy: Return last good CSS + show error overlay**

| Error | Strategy | User Sees |
|-------|----------|-----------|
| **Plugin load fails** | Log warning, return no-op | Error overlay: "Failed to load plugin: X" |
| **globals.css compile error** | Return cached CSS | Error overlay: "CSS compile error: X" |
| **Tailwind base fetch fails** | Return cached CSS | Error overlay: "Failed to fetch Tailwind" |
| **Invalid class candidates** | Tailwind ignores them | No impact |

```typescript
// Cache last successful CSS
let lastGoodCSS = "";
let lastError: Error | null = null;

export async function generateTailwindCSS(
  globalsCSS: string,
  candidates: string[] | Set<string>,
): Promise<{ css: string; error?: string }> {
  try {
    const compiler = await getCompiler(globalsCSS);
    const css = compiler.build([...candidates]);

    // Success - cache it
    lastGoodCSS = css;
    lastError = null;
    return { css };
  } catch (error) {
    logger.error("[Tailwind] Compilation failed", { error });

    // Return last good CSS + error message for overlay
    return {
      css: lastGoodCSS,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

**Error overlay - reuse existing `ErrorOverlay` system:**

```typescript
// Error types with specific suggestions
function formatCSSError(error: Error): { title: string; message: string; suggestion: string } {
  const msg = error.message;

  // Plugin not found
  if (msg.includes("Could not resolve") || msg.includes("Failed to load plugin")) {
    const pluginMatch = msg.match(/@plugin\s+["']([^"']+)["']/);
    const pluginName = pluginMatch?.[1] || "unknown";
    return {
      title: "Plugin Not Found",
      message: `Could not load plugin: ${pluginName}`,
      suggestion: `Check the plugin name is correct. Available at esm.sh/${pluginName}?`,
    };
  }

  // Invalid @theme syntax
  if (msg.includes("@theme") || msg.includes("Invalid theme")) {
    return {
      title: "Invalid @theme",
      message: msg,
      suggestion: "Check @theme syntax: @theme { --color-name: value; }",
    };
  }

  // CSS syntax error
  if (msg.includes("Unexpected") || msg.includes("Expected")) {
    return {
      title: "CSS Syntax Error",
      message: msg,
      suggestion: "Check for missing semicolons, brackets, or typos",
    };
  }

  // Generic
  return {
    title: "Tailwind CSS Error",
    message: msg,
    suggestion: "Check your stylesheet for errors",
  };
}

// Server: push error via WebSocket
if (result.error) {
  const errorInfo = formatCSSError(result.error);
  ws.send(JSON.stringify({
    type: "error",
    error: {
      type: "css",
      ...errorInfo,
    },
  }));
}
```

```typescript
// Client: existing HMR handles "error" type
// src/server/dev-server/hmr/templates.ts already has error handling
case 'error':
  ErrorOverlay.show(message.error);
  break;
```

**Same overlay as JS errors** - consistent UX, no new code needed.

**Philosophy:**
- **Page never blows up** - CSS errors never crash the render
- User keeps working with last good styles
- Clear error message shown to fix the issue
- Fix the error → styles update automatically via HMR

---

## Open Questions

| Question | Proposed Answer |
|----------|-----------------|
| **First load error (no cached CSS)?** | Return empty CSS + show error. User sees unstyled page with clear error message. |
| **globals.css changes?** | Hash includes globals.css content → compiler recreated automatically |
| **No stylesheet in project?** | Use minimal default: `@import "tailwindcss";` |
| **CSS minification?** | Yes for production. Use `lightningcss` or Tailwind's built-in minification |
| **Source maps?** | No - adds complexity, Tailwind classes are self-explanatory |

---

## Tests to Write

### Unit Tests: `tailwind-compiler.test.ts`

```typescript
describe("generateTailwindCSS", () => {
  it("compiles basic classes", async () => {
    const css = await generateTailwindCSS(
      `@import "tailwindcss";`,
      ["bg-red-500", "text-white"]
    );
    expect(css).toContain("background-color");
    expect(css).toContain("color");
  });

  it("handles @theme directive", async () => {
    const css = await generateTailwindCSS(
      `@import "tailwindcss"; @theme { --color-brand: #ff0000; }`,
      ["bg-brand"]
    );
    expect(css).toContain("--color-brand");
  });

  it("loads plugins via esm.sh", async () => {
    const css = await generateTailwindCSS(
      `@import "tailwindcss"; @plugin "@tailwindcss/typography";`,
      ["prose"]
    );
    expect(css).toContain("prose");
  });

  it("returns cached CSS on error", async () => {
    // First call succeeds
    const good = await generateTailwindCSS(`@import "tailwindcss";`, ["bg-red-500"]);

    // Second call with bad CSS
    const result = await generateTailwindCSS(`@import "invalid";`, ["bg-red-500"]);

    expect(result.css).toBe(good); // Returns cached
    expect(result.error).toBeDefined();
  });

  it("ignores invalid class candidates", async () => {
    const css = await generateTailwindCSS(
      `@import "tailwindcss";`,
      ["bg-red-500", "notaclass", "function()", "bg-blue-500"]
    );
    expect(css).toContain("red");
    expect(css).toContain("blue");
    expect(css).not.toContain("notaclass");
  });
});

describe("extractCandidates", () => {
  // Basic className
  it("extracts from className strings", () => {
    const candidates = extractCandidates(`className="bg-red-500 text-white"`);
    expect(candidates).toContain("bg-red-500");
    expect(candidates).toContain("text-white");
  });

  // cn() / clsx() / classNames()
  it("extracts from cn() calls", () => {
    const candidates = extractCandidates(`cn("bg-red-500", active && "text-white")`);
    expect(candidates).toContain("bg-red-500");
    expect(candidates).toContain("text-white");
  });

  it("extracts from clsx() calls", () => {
    const candidates = extractCandidates(`clsx("px-4 py-2", { "bg-blue-500": isActive })`);
    expect(candidates).toContain("px-4");
    expect(candidates).toContain("py-2");
    expect(candidates).toContain("bg-blue-500");
  });

  it("extracts from nested cn() calls", () => {
    const candidates = extractCandidates(`cn("base-class", condition && cn("nested-1", "nested-2"))`);
    expect(candidates).toContain("base-class");
    expect(candidates).toContain("nested-1");
    expect(candidates).toContain("nested-2");
  });

  // cva() - class variance authority
  it("extracts from cva() base", () => {
    const candidates = extractCandidates(`cva("inline-flex items-center justify-center")`);
    expect(candidates).toContain("inline-flex");
    expect(candidates).toContain("items-center");
    expect(candidates).toContain("justify-center");
  });

  it("extracts from cva() variants", () => {
    const candidates = extractCandidates(`
      cva("base", {
        variants: {
          size: {
            sm: "text-sm px-2",
            md: "text-base px-4",
            lg: "text-lg px-6",
          },
          color: {
            primary: "bg-primary text-primary-foreground",
            secondary: "bg-secondary text-secondary-foreground",
          }
        }
      })
    `);
    expect(candidates).toContain("text-sm");
    expect(candidates).toContain("px-2");
    expect(candidates).toContain("text-base");
    expect(candidates).toContain("px-4");
    expect(candidates).toContain("bg-primary");
    expect(candidates).toContain("text-primary-foreground");
  });

  // tv() - tailwind-variants
  it("extracts from tv() slots", () => {
    const candidates = extractCandidates(`
      tv({
        base: "font-medium bg-blue-500",
        slots: {
          title: "text-2xl font-bold",
          description: "text-sm text-gray-500",
        }
      })
    `);
    expect(candidates).toContain("font-medium");
    expect(candidates).toContain("bg-blue-500");
    expect(candidates).toContain("text-2xl");
    expect(candidates).toContain("font-bold");
    expect(candidates).toContain("text-gray-500");
  });

  // Template literals
  it("extracts from template literals", () => {
    const candidates = extractCandidates('className={`px-4 py-2 ${active ? "bg-blue-500" : "bg-gray-500"}`}');
    expect(candidates).toContain("px-4");
    expect(candidates).toContain("py-2");
    expect(candidates).toContain("bg-blue-500");
    expect(candidates).toContain("bg-gray-500");
  });

  it("extracts static parts from dynamic template literals", () => {
    const candidates = extractCandidates('className={`text-${size} bg-red-500`}');
    expect(candidates).toContain("bg-red-500");
    // text-${size} won't fully extract but text- prefix might
  });

  // Arbitrary values
  it("extracts arbitrary values", () => {
    const candidates = extractCandidates(`className="aspect-[16/9] bg-[#ff0000]"`);
    expect(candidates).toContain("aspect-[16/9]");
    expect(candidates).toContain("bg-[#ff0000]");
  });

  it("extracts CSS variable arbitrary values", () => {
    const candidates = extractCandidates(`className="bg-[var(--primary)] text-[length:16px]"`);
    expect(candidates).toContain("bg-[var(--primary)]");
    expect(candidates).toContain("text-[length:16px]");
  });

  it("extracts grid arbitrary values", () => {
    const candidates = extractCandidates(`className="grid-cols-[1fr_2fr_1fr] gap-[20px]"`);
    expect(candidates).toContain("grid-cols-[1fr_2fr_1fr]");
    expect(candidates).toContain("gap-[20px]");
  });

  // Responsive / state prefixes
  it("extracts responsive prefixes", () => {
    const candidates = extractCandidates(`className="sm:text-sm md:text-base lg:text-lg"`);
    expect(candidates).toContain("sm:text-sm");
    expect(candidates).toContain("md:text-base");
    expect(candidates).toContain("lg:text-lg");
  });

  it("extracts state prefixes", () => {
    const candidates = extractCandidates(`className="hover:bg-blue-600 focus:ring-2 active:scale-95"`);
    expect(candidates).toContain("hover:bg-blue-600");
    expect(candidates).toContain("focus:ring-2");
    expect(candidates).toContain("active:scale-95");
  });

  it("extracts stacked prefixes", () => {
    const candidates = extractCandidates(`className="dark:hover:bg-gray-800 sm:focus:ring-4"`);
    expect(candidates).toContain("dark:hover:bg-gray-800");
    expect(candidates).toContain("sm:focus:ring-4");
  });

  // Edge cases
  it("handles single quotes", () => {
    const candidates = extractCandidates(`className='bg-red-500 text-white'`);
    expect(candidates).toContain("bg-red-500");
    expect(candidates).toContain("text-white");
  });

  it("handles MDX/JSX mixed content", () => {
    const candidates = extractCandidates(`
      <div className="container mx-auto">
        <Button variant="primary" className="mt-4">Click</Button>
      </div>
    `);
    expect(candidates).toContain("container");
    expect(candidates).toContain("mx-auto");
    expect(candidates).toContain("mt-4");
  });

  it("ignores non-class tokens", () => {
    const candidates = extractCandidates(`
      const x = 5;
      function handleClick() {}
      import React from "react";
    `);
    // These should be extracted but Tailwind will filter them out
    // The key is we don't crash
    expect(candidates).toBeDefined();
  });
});
```

### Integration Tests

| Test | Description |
|------|-------------|
| Preview HMR | Add class → CSS pushed via WebSocket |
| Production hash | CSS served at `/_vf/css/[hash].css` with immutable cache |
| Error recovery | Bad CSS → old CSS + error overlay |
| Plugin loading | `@plugin` directive loads from esm.sh |
| No stylesheet | Falls back to `@import "tailwindcss";` |

---

## Manual Testing Checklist

### Preview Mode
- [ ] Add `bg-red-500` → appears styled immediately (HMR push)
- [ ] Change stylesheet `@theme` → colors update
- [ ] `@plugin "@tailwindcss/typography"` → prose classes work
- [ ] `aspect-[16/9]` → works without custom code
- [ ] Bad CSS syntax → error overlay, old styles preserved

### Production Mode
- [ ] All classes from all project files styled
- [ ] CSS served at hashed URL
- [ ] `Cache-Control: immutable` header set
- [ ] Plugins work

### Edge Cases
- [ ] `cn("bg-red-500", condition && "text-white")` → both extracted
- [ ] `cva({ variants: { size: { sm: "text-sm" }}})` → extracted
- [ ] Template literal `className={\`px-${size}\`}` → px- prefix extracted

---

## Migration

**Zero breaking changes.** Projects with existing `globals.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
@theme {
  --color-primary: hsl(var(--primary));
}
```

Will work exactly the same, but faster and more reliable.
