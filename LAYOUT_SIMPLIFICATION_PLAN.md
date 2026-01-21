# Layout System Simplification Plan

## TL;DR

**Two bugs to fix:**
1. **Duplicate layout** - `components/layout.tsx` rendered twice due to overlapping code paths
2. **No HMR for config/layout changes** - Module-level memoization caches persist across handler reloads

## Router-Specific Approach

| Router | Layout Detection | Memoization | HMR |
|--------|------------------|-------------|-----|
| **Pages** | Single layout (simplified) | Remove entirely | ✓ Add cache clearing |
| **App** | Nested layouts (keep as-is) | Keep, add `clearCache()` | ✓ Add cache clearing |

**Both routers**: When layout/config files change → clear caches → HMR refresh works

## Problem Summary

The layout `components/layout.tsx` is being rendered **twice** because the layout collection system has multiple overlapping code paths:

1. **`collectNamedLayoutWithPath`** processes `config.defaultLayout` and adds the layout
2. **`collectAPILayoutConfiguration`** auto-discovers `components/layout.tsx` and adds it again
3. **`processLayoutResult`** prepends the defaultLayout to nestedLayouts (line 172)

**Result**: Same layout appears twice in the `nestedLayouts` array, causing double rendering.

---

## "Magic" Auto-Registration Being Removed

### Provider System (REMOVE ENTIRELY)

**Why:** Broken projects due to magic auto-registration. Users should control their own providers in `app.tsx`.

**Current broken behavior:**
- `*Provider.tsx` files auto-registered by filename
- `/providers` and `/components` directories scanned
- `config.provider` option
- `frontmatter.isProvider` detection
- `ProviderManager` class wrapping providers around pages

**New behavior:** NO PROVIDERS - users add them in App component:
```tsx
// components/app.tsx - user controls this directly
import { ThemeProvider } from "next-themes"
import { QueryClientProvider } from "@tanstack/react-query"

export default function App({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}
```

**Files/code to remove:**
- `src/rendering/layouts/provider-manager.ts` - DELETE or gut entirely
- `getProviderEntities()` in `getEntityInfo.ts` - DELETE
- `isProvider` detection in `entities.ts` - DELETE
- `config.provider` from schema - DELETE
- Provider wrapping in `layout-applicator.ts` - REMOVE
- `providerItems` parameter passing throughout - REMOVE

---

## Nested Layouts Concept (Current)

The current system supports **Next.js App Router style nested layouts**:

```
app/
├── layout.tsx          ← Root layout (outermost wrapper)
├── page.tsx
├── blog/
│   ├── layout.tsx      ← Blog section layout
│   └── [slug]/
│       ├── layout.tsx  ← Post layout (innermost)
│       └── page.tsx
```

For a page at `app/blog/[slug]/page.tsx`, the wrapping order is:
```
RootLayout
  └─ BlogLayout
      └─ PostLayout
          └─ PageContent
```

### Why This Doesn't Apply to Pages Router

**App Router**: Each route segment can have its own layout file in the filesystem.
**Pages Router**: Single layout for the whole app, optionally overridden per-page via frontmatter.

Your project uses `router: "pages"`, so nested layout discovery is:
- Unnecessary complexity
- Source of the duplicate layout bug
- Should be removed

---

## Current Architecture (Complex)

```
┌─────────────────────────────────────────────────────────────────┐
│                     LayoutCollector.collectLayouts()            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. collectNamedLayoutWithPath()                                │
│     ├─ Check frontmatter.layout                                 │
│     ├─ Check config.defaultLayout                               │
│     └─ Calls getLayoutEntity() → returns layoutBundle           │
│                                                                 │
│  2. processLayoutResult()                                       │
│     ├─ If frontmatter layout → use that only                    │
│     └─ Else:                                                    │
│         ├─ collectNestedLayouts() → discovers components/layout │
│         └─ PREPEND defaultLayout → DUPLICATE!                   │
│                                                                 │
│  3. collectNestedLayouts()                                      │
│     ├─ collectAPILayoutConfiguration() (Veryfront API)          │
│     │   ├─ Check config.layout                                  │
│     │   └─ Auto-discover components/layout.{ext}                │
│     └─ collectFilesystemLayouts() (local filesystem)            │
│         └─ discoverNestedLayouts() (pages/app directory walk)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Config Options (Confusing)

| Config Key       | Where Used                        | Purpose                      |
|------------------|-----------------------------------|------------------------------|
| `config.app`     | app-resolver.ts, provider-manager | App component path           |
| `config.layout`  | collectAPILayoutConfiguration     | Layout file path             |
| `config.defaultLayout` | collectNamedLayoutWithPath  | Named layout (via getLayoutEntity) |
| `config.provider`| provider-manager.ts               | Provider component path      |

This causes confusion:
- `config.layout` vs `config.defaultLayout` serve similar purposes
- `config.app` is checked in both app-resolver AND provider-manager
- Multiple code paths can add the same layout

---

## Target Architecture (Simple)

```
┌─────────────────────────────────────────────────────────────────┐
│                     LayoutCollector.collectLayouts()            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Priority 1: MDX Frontmatter Layout (page-level override)       │
│  ├─ If page has `layout: "path/to/layout.tsx"` → use that       │
│  └─ If page has `layout: false` → no layout                     │
│                                                                 │
│  Priority 2: Config Layout (project-level explicit)             │
│  ├─ If config.layout is set → use that path                     │
│  └─ Skip auto-detection                                         │
│                                                                 │
│  Priority 3: Auto-Detection (convention fallback)               │
│  └─ Find components/layout.{tsx,mdx} → use if exists            │
│                                                                 │
│  ONLY ONE LAYOUT PATH IS USED - NO DUPLICATES                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     AppResolver.resolveAppPath()                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Priority 1: Config App (project-level explicit)                │
│  └─ If config.app is set → use that path                        │
│                                                                 │
│  Priority 2: Auto-Detection (convention fallback)               │
│  └─ Find components/app.{tsx,mdx} → use if exists               │
│                                                                 │
│  NO projectData references                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

### 1. `src/rendering/layouts/layout-collector.ts`
**Changes:**
- [ ] Remove `collectNamedLayoutWithPath()` - consolidate into single method
- [ ] Replace `config.defaultLayout` with `config.layout`
- [ ] Simplify `processLayoutResult()` - no prepending logic, no duplicates
- [ ] For Pages Router: single layout detection (no nested walking)
- [ ] For App Router: keep nested discovery
- [ ] Remove `collectAPILayoutConfiguration()` complexity
- [ ] New logic: check frontmatter → check config.layout → auto-detect (ONE path)

### 2. `src/rendering/layouts/utils/discovery.ts`
**Changes:**
- [ ] Remove or simplify `discoverNestedLayouts()` - we only need components/layout detection
- [ ] Remove ancestor directory walking (not needed for simple model)

### 3. `src/rendering/layouts/utils/app-resolver.ts`
**Changes:**
- [ ] Remove `projectData?.app` check (Priority 2 in current code)
- [ ] Keep only: config.app → auto-detect components/app.{ext}

### 4. `src/rendering/layouts/provider-manager.ts`
**Changes:**
- [ ] Remove `config.app` as provider alias (line 250) - App is NOT a provider
- [ ] Providers are separate from App component

### 5. `src/rendering/layouts/layout-applicator.ts`
**Changes:**
- [ ] Review `wrapWithAppComponent()` - ensure no duplicate wrapping
- [ ] Remove `hasAppProvider` check - App is NOT a provider anymore

### 6. `src/config/types.ts` and `src/config/schema.ts`
**Changes:**
- [ ] Remove `defaultLayout` entirely (breaking change)
- [ ] Use `layout` only (consistent with `app`)
- [ ] Update schema validation

### 7. `src/types/entities/getEntityInfo.ts`
**Changes:**
- [ ] Simplify `getLayoutEntity()` - may not need named layout resolution anymore
- [ ] Layout is resolved by path only, not by name

### 8. `src/types/entities.ts`
**Changes:**
- [ ] Remove `isProvider` from `EntityTypeInfo`
- [ ] Remove `isProvider` detection in `detectEntityType()`
- [ ] Remove `baseName.endsWith("Provider")` check

### 9. `src/rendering/layouts/provider-manager.ts`
**DELETE THIS FILE ENTIRELY**

### 10. `src/types/entities/getEntityInfo.ts`
**Changes:**
- [ ] Delete `getProviderEntities()` function entirely

### 11. Files that reference providers (remove `providerItems` parameter):
- [ ] `src/rendering/layouts/layout-applicator.ts`
- [ ] `src/rendering/layouts/utils/applicator.ts`
- [ ] `src/rendering/orchestrator/layout.ts`
- [ ] `src/rendering/orchestrator/pipeline.ts`

---

## New Config Schema

```typescript
export interface VeryfrontConfig {
  // Router mode
  router?: "app" | "pages";

  // App wrapper component (wraps all pages)
  // Default: auto-detect components/app.{tsx,mdx}
  app?: string;

  // Layout component (wraps page content)
  // Default: auto-detect components/layout.{tsx,mdx}
  // Can be overridden per-page via frontmatter: layout: "path/to/layout.tsx"
  layout?: string;

  // Other config...
}
```

**Removed (breaking changes):**
- `defaultLayout` - use `layout` instead (consistent with `app`)
- `provider` config option - REMOVED ENTIRELY
- `ProviderManager` - REMOVED ENTIRELY
- Auto-registration of `*Provider.tsx` files - REMOVED ENTIRELY
- `/providers` directory scanning - REMOVED ENTIRELY

**Simple model:**
```
App (components/app.tsx)      ← User adds providers HERE
  └─ Layout (components/layout.tsx)
      └─ Page content
```

**Example config:**
```typescript
// veryfront.config.ts
export default {
  router: "pages",
  app: "components/app.tsx",
  layout: "components/layout.tsx",
}
```

---

## Layout Resolution Logic (New)

```typescript
async collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult> {
  const nestedLayouts: LayoutItem[] = [];

  // 1. Check if layout is disabled
  const layoutValue = pageInfo.entity.frontmatter.layout;
  if (layoutValue === false || layoutValue === "false") {
    return { layoutBundle: undefined, nestedLayouts: [] };
  }

  // 2. Priority: Frontmatter layout (page-level override)
  if (typeof layoutValue === "string" && layoutValue.length > 0) {
    const layoutPath = await this.resolveLayoutPath(layoutValue);
    if (layoutPath) {
      nestedLayouts.push(this.createLayoutItem(layoutPath));
      return { layoutBundle: undefined, nestedLayouts };
    }
  }

  // 3. Priority: Config layout (project-level explicit)
  if (this.config?.layout) {
    const layoutPath = await this.resolveLayoutPath(this.config.layout);
    if (layoutPath) {
      nestedLayouts.push(this.createLayoutItem(layoutPath));
      return { layoutBundle: undefined, nestedLayouts };
    }
  }

  // 4. Priority: Auto-detect components/layout.{ext}
  const autoLayoutPath = await this.autoDetectLayout();
  if (autoLayoutPath) {
    nestedLayouts.push(this.createLayoutItem(autoLayoutPath));
  }

  return { layoutBundle: undefined, nestedLayouts };
}
```

---

## App Resolution Logic (New)

```typescript
async resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string | null> {
  // 1. Check config.app
  if (config?.app) {
    const appPath = join(projectDir, config.app);
    if (await adapter.fs.exists(appPath)) {
      return appPath;
    }
  }

  // 2. Auto-detect components/app.{ext}
  for (const ext of ["tsx", "jsx", "ts", "js", "mdx", "md"]) {
    const appPath = join(projectDir, `components/app.${ext}`);
    if (await adapter.fs.exists(appPath)) {
      return appPath;
    }
  }

  return null;
}
```

---

## Testing Checklist

After implementation, verify:

1. [ ] **Single layout rendering** - Layout appears once, not twice
2. [ ] **Frontmatter override** - `layout: "custom.tsx"` uses custom layout
3. [ ] **Frontmatter disable** - `layout: false` disables layout
4. [ ] **Config layout** - `layout: "components/layout.tsx"` works
5. [ ] **Auto-detect layout** - No config → finds components/layout.tsx
6. [ ] **Config app** - `app: "components/app.tsx"` works
7. [ ] **Auto-detect app** - No config → finds components/app.tsx
8. [ ] **No projectData references** - Remove API-specific app/layout logic

---

## Implementation Order

1. **First**: Fix the immediate bug in `layout-collector.ts` by removing duplicate logic
2. **Second**: Simplify `app-resolver.ts` by removing projectData references
3. **Third**: Clean up `provider-manager.ts` to not treat app as provider
4. **Fourth**: Update config schema to remove `defaultLayout`
5. **Fifth**: Remove/simplify discovery.ts and getLayoutEntity

---

---

## HMR Issue: Module-Level Memoization

### Current Problem

When you change `veryfront.config.ts` or rename/delete `components/layout.tsx`:

```
1. File watcher detects change
2. invalidateUniversalHandler() called
3. universalHandler = undefined (handler cleared)
4. BUT: discoverNestedLayouts memoization cache NOT cleared ← BUG
5. Next request creates new handler
6. Memoized function returns STALE cached result
```

### Root Cause

In `src/rendering/layouts/utils/discovery.ts`:

```typescript
// Module-level memoization - cache persists across handler instances!
export const discoverNestedLayouts = memoizeAsync(
  discoverNestedLayoutsImpl,
  (pageFilePath, rootDir) => simpleHash(pageFilePath, rootDir),
);
```

The memoization cache is created when the module is first imported and **never cleared**.

### Files with Module-Level Caches

| File | Cache | Issue |
|------|-------|-------|
| `layouts/utils/discovery.ts` | `discoverNestedLayouts` memoization | Stale layout paths |
| `layouts/provider-manager.ts` | `cache: Map<string, CacheEntry>` | Instance cache (OK) |
| `layouts/utils/component-loader.ts` | `LayoutComponentCache` | Instance cache (OK) |

### Fix Options

**Option A: Add cache clearing function**
```typescript
// discovery.ts
const layoutDiscoveryCache = new Map<string, LayoutItem[]>();

export function clearLayoutDiscoveryCache(): void {
  layoutDiscoveryCache.clear();
}

export const discoverNestedLayouts = memoizeAsync(
  discoverNestedLayoutsImpl,
  ...,
  { cache: layoutDiscoveryCache }  // Use explicit cache
);
```

Then call `clearLayoutDiscoveryCache()` from `invalidateUniversalHandler()`.

**Option B: Remove memoization entirely (Recommended)**

Since we're simplifying to single-layout detection, memoization adds complexity without benefit:
```typescript
// Just call the function directly - no caching needed
export async function discoverNestedLayouts(...): Promise<LayoutItem[]> {
  // Simple direct implementation
}
```

### File Watcher Enhancement

Add specific handling for config/component file changes:

```typescript
// file-watch-setup.ts
private async handleBatchedFileChanges(changes: string[]): Promise<void> {
  // Check if config or layout/app files changed
  const configChanged = changes.some(p => p.endsWith('veryfront.config.ts'));
  const layoutChanged = changes.some(p => /components\/(layout|app)\.(tsx|mdx)$/.test(p));

  if (configChanged || layoutChanged) {
    // Clear ALL caches - these are structural changes
    clearLayoutDiscoveryCache();  // New function
    clearAppResolverCache();      // New function
  }

  // ... rest of handler
}
```

---

## Files to Search

To verify all changes are complete, search for:

```bash
# Find all defaultLayout references
grep -r "defaultLayout" src/

# Find all projectData references for app/layout
grep -r "projectData" src/rendering/layouts/

# Find all getLayoutEntity usages
grep -r "getLayoutEntity" src/

# Find provider-manager app handling
grep -r "config.app" src/rendering/layouts/provider-manager.ts

# Find module-level memoization
grep -r "memoizeAsync" src/rendering/
```
