# Chapter 001: File Adapter Divergence

## Detailed Sub-Analyses

| Document | Severity | Title |
|----------|----------|-------|
| [001.0](./001.0-unified-adapter-rfc.md) | 📋 RFC | Unified Adapter Architecture - One interface, one code path |
| [001.1](./001.1-layout-bug-critical.md) | 🔴 CRITICAL | The Layout Bug - App Router nested layouts ignored in production |
| [001.2](./001.2-unsafe-type-casting.md) | 🟠 HIGH | Unsafe Type Casting - `as unknown as { ... }` patterns |
| [001.3](./001.3-duplicated-isvirtualfilesystem.md) | 🟡 MEDIUM | Duplicated `isVirtualFilesystem()` - 3 different implementations |
| [001.4](./001.4-layout-cache-no-project-scope.md) | 🔴 CRITICAL | Layout Cache Without Project Scoping - memory leak, cross-project pollution |
| [001.5](./001.5-config-middleware-loading-divergence.md) | 🟠 HIGH | Config/Middleware Loading Divergence - esbuild vs native import |
| [001.6](./001.6-css-cache-key-divergence.md) | 🟠 HIGH | CSS Cache Key Divergence - `projectUpdatedAt` only for API adapter |

## Problem Statement

The veryfront-renderer codebase has four different filesystem adapters that behave differently in subtle but critical ways:

1. **Local Filesystem Adapter** - Direct Deno/Node filesystem access
2. **Veryfront API Adapter (branch/preview mode)** - Draft content from the API
3. **Veryfront API Adapter (production/release mode)** - Published content from the API
4. **GitHub Adapter** - GitHub API filesystem access

Instead of implementing a unified adapter interface where all adapters behave identically, the codebase contains **adapter-specific conditionals scattered throughout the business logic**. This creates:

- **Combinatorial complexity**: Each conditional doubles the number of code paths to test
- **"Works locally, breaks in production" bugs**: Local filesystem behavior differs from API adapter behavior
- **Hidden assumptions**: Code that works in one context silently fails in another
- **Maintenance burden**: Every new feature must account for all adapter types

The core anti-pattern is checking `isVeryfrontAdapter()` or `isVirtualFilesystem()` in business logic, then executing completely different code paths.

## Concrete Examples

### Example 1: Layout Collection (THE LAYOUT BUG)

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/layout-collector.ts`

```typescript
// Lines 257-268
private async collectNestedLayouts(pageInfo: EntityInfo): Promise<LayoutItem[]> {
  const pageFilePath = pageInfo.entity.path;
  const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);

  const fs = this.adapter?.fs;
  const isVeryfrontAPI = !!fs && isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter();

  if (isVeryfrontAPI && fs && isExtendedFSAdapter(fs)) {
    return await this.collectAPILayoutConfiguration(fs.getUnderlyingAdapter());
  }

  return await this.collectFilesystemLayouts(pageFilePath, useAppRouter);
}
```

This diverges into TWO completely different layout discovery implementations:

**API Path** (lines 271-343):
```typescript
private async collectAPILayoutConfiguration(wrappedAdapter: unknown): Promise<LayoutItem[]> {
  const nestedLayouts: LayoutItem[] = [];
  const configLayout = this.config?.layout;

  // Only checks config.layout and components/layout.*
  // Does NOT walk app/ or pages/ directories for nested layouts

  if (!configLayout) {
    const foundExt = await parallelFind([...LAYOUT_EXTENSIONS], async (ext) => {
      const layoutPath = join(this.projectDir, "components", `layout.${ext}`);
      return await existsFn.call(wrappedAdapter, layoutPath);
    });
    // ...
  }
}
```

**Filesystem Path** (lines 345-364):
```typescript
private async collectFilesystemLayouts(
  pageFilePath: string,
  useAppRouter: boolean,
): Promise<LayoutItem[]> {
  // Walks app/ or pages/ directories for nested layout.tsx files
  const rootDir = useAppRouter ? join(this.projectDir, "app") : join(this.projectDir, "pages");
  return await discoverNestedLayouts(pageFilePath, rootDir, this.projectDir, this.adapter);
}
```

**The Bug**: When using the API adapter, nested layouts in `app/dashboard/layout.tsx` are **completely ignored** because `collectAPILayoutConfiguration` only checks `config.layout` and `components/layout.*`. The filesystem adapter correctly walks the directory tree.

### Example 2: Config Loading

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/config/loader.ts`

```typescript
// Lines 174-181
function isVirtualFilesystem(adapter: RuntimeAdapter): boolean {
  const fs = adapter?.fs;
  if (!fs || typeof fs !== "object") return false;
  if (!isExtendedFSAdapter(fs)) return false;

  if (fs.isVeryfrontAdapter()) return true;
  return VIRTUAL_FS_ADAPTERS.has(fs.getAdapterType());
}

// Lines 273-280
async function loadAndMergeConfig(...): Promise<VeryfrontConfig> {
  if (isVirtualFilesystem(adapter)) {
    return loadConfigFromVirtualFS(configPath, cacheKey, adapter);
  }
  // ... different code path for local filesystem
}
```

Virtual filesystem config loading uses esbuild to transpile TypeScript, while local filesystem uses native import. This can cause subtle differences in how config is evaluated.

### Example 3: Middleware Loading

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/server/dev-server/middleware.ts`

```typescript
// Lines 82-86
function isVirtualFilesystem(adapter: RuntimeAdapter): boolean {
  const fs = adapter?.fs;
  if (!fs || typeof fs !== "object") return false;
  return isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter();
}

// Lines 98-107
if (isVirtualFilesystem(adapter)) {
  return await loadMiddlewareFromVirtualFS(middlewarePath, adapter);
}

const middlewareUrl = `file://${middlewarePath}?t=${Date.now()}-${crypto.randomUUID()}`;
const middlewareModule = await import(middlewareUrl);
```

Middleware is loaded via esbuild transpilation for API adapters, but via native import for local. Error messages and module resolution can differ.

### Example 4: Entity ID Resolution

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/types/entities/getEntityInfo.ts`

```typescript
// Lines 91-111
let entityId = filePath;
if (adapter) {
  try {
    const adapterFs = adapter.fs;
    if (isExtendedFSAdapter(adapterFs) && adapterFs.isVeryfrontAdapter()) {
      const underlyingAdapter = adapterFs.getUnderlyingAdapter() as {
        getEntityIdForPath?: (path: string) => string | undefined;
      };

      const getEntityIdForPath = underlyingAdapter?.getEntityIdForPath;
      if (getEntityIdForPath) {
        const relativePath = filePath
          .replace(/^.*?\/pages\//, "pages/")
          .replace(/^.*?\/components\//, "components/");
        entityId = getEntityIdForPath(relativePath) ?? entityId;
      }
    }
  } catch {
    // Ignore errors, fall back to file path
  }
}
```

Entity IDs are resolved differently for API adapters vs local filesystem.

### Example 5: Project Metadata Access

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/pipeline.ts`

```typescript
// Lines 648-655
let projectUpdatedAt: string | undefined;
const fs = this.config.adapter?.fs;
if (fs && isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter()) {
  const wrappedAdapter = fs.getUnderlyingAdapter() as {
    getProjectData?: () => { updated_at?: string } | undefined;
  };
  projectUpdatedAt = wrappedAdapter.getProjectData?.()?.updated_at;
}
```

This metadata is only available for API adapters, causing cache key computation to differ.

## All Divergence Points Found

| File | Line | Check | Description |
|------|------|-------|-------------|
| `src/rendering/layouts/layout-collector.ts` | 262 | `isVeryfrontAdapter()` | Different layout discovery |
| `src/config/loader.ts` | 179-180 | `isVeryfrontAdapter()` | Virtual FS detection |
| `src/config/loader.ts` | 278 | `isVirtualFilesystem()` | Config loading path |
| `src/server/dev-server/middleware.ts` | 85 | `isVeryfrontAdapter()` | Virtual FS detection |
| `src/server/dev-server/middleware.ts` | 101 | `isVirtualFilesystem()` | Middleware loading path |
| `src/types/entities/getEntityInfo.ts` | 95 | `isVeryfrontAdapter()` | Entity ID resolution |
| `src/rendering/orchestrator/pipeline.ts` | 650 | `isVeryfrontAdapter()` | Project metadata access |
| `src/platform/adapters/fs/wrapper.ts` | 67 | `isVeryfrontAdapter()` | Adapter type check |

## Current Behavior Summary

### Layout Feature Parity Table

| Feature                      | API Adapter          | Filesystem Adapter |
|------------------------------|----------------------|--------------------|
| `config.layout` explicit     | ✅ Works             | ✅ Works           |
| `components/layout.*` fallback | ✅ Works           | ✅ Works (fixed)   |
| App Router nested layouts    | ❌ **BROKEN**        | ✅ Works           |

### The Remaining Bug: App Router Nested Layouts

When a project uses nested layouts with the Veryfront API adapter:

```
app/
  layout.tsx           <- Root layout
  dashboard/
    layout.tsx         <- Nested layout (IGNORED by API adapter)
    page.tsx           <- Page
```

**Expected behavior**: Both `app/layout.tsx` and `app/dashboard/layout.tsx` wrap the page.

**Actual behavior with API adapter**: Only `config.layout` or `components/layout.*` is found. The nested `app/dashboard/layout.tsx` is ignored because `collectAPILayoutConfiguration()` never walks the directory tree.

**Actual behavior with local filesystem**: Both layouts are correctly discovered by `discoverNestedLayouts()` walking the `app/` directory.

### Root Cause

`collectAPILayoutConfiguration()` was written with a different mental model:
1. Check explicit `config.layout`
2. Check default `components/layout.*`
3. That's it - no directory walking

This works for simple projects but breaks nested App Router layouts, which are a core Next.js App Router feature.

### Impact

- Projects with nested App Router layouts work locally but break when deployed
- Layout hierarchy is silently incorrect in production
- Developers may not notice until users report styling/functionality issues

## What Can Go Wrong

### Scenario 1: Layout Hierarchy Breaks in Production

A developer creates a dashboard with nested layouts:

```tsx
// app/layout.tsx - Root layout with nav
export default function RootLayout({ children }) {
  return <html><Nav />{children}</html>
}

// app/dashboard/layout.tsx - Dashboard sidebar
export default function DashboardLayout({ children }) {
  return <div><Sidebar />{children}</div>
}

// app/dashboard/settings/page.tsx
export default function Settings() {
  return <h1>Settings</h1>
}
```

**Local development**: Works perfectly. Both layouts wrap the page.

**Production (API adapter)**: Dashboard layout is ignored. Settings page renders without the sidebar.

### Scenario 2: Config Evaluation Differs

A config file uses dynamic expressions:

```typescript
// veryfront.config.ts
export default {
  layout: process.env.CUSTOM_LAYOUT ? 'layouts/custom' : 'components/layout',
}
```

**Local**: Native import evaluates at runtime with current env.

**API adapter**: esbuild transpiles, then evaluates. Environment handling may differ.

### Scenario 3: Middleware Error Messages Differ

A middleware file has a syntax error:

```typescript
// middleware.ts
export function middleware(request) {
  const invalid syntax here;  // Error!
}
```

**Local**: Native import error with stack trace pointing to exact location.

**API adapter**: esbuild error with potentially different formatting.

### Scenario 4: Cache Keys Compute Differently

The `projectUpdatedAt` metadata is only available from API adapter:

```typescript
const cssCacheKey = getPageCssCacheKey(
  options?.projectId,
  options?.environment,
  slug,
  projectUpdatedAt,  // undefined for local, has value for API
);
```

**Impact**: Cache invalidation timing differs between environments.

## Success Criteria

### Measurable Outcomes

1. **Zero `isVeryfrontAdapter()` calls in business logic**
   - Metric: `grep -r "isVeryfrontAdapter" src/ | grep -v "wrapper.ts" | wc -l` = 0

2. **Zero `isVirtualFilesystem()` functions in non-adapter code**
   - Metric: Only exists in `src/platform/adapters/` directory

3. **Single layout discovery code path**
   - Metric: `collectAPILayoutConfiguration` and `collectFilesystemLayouts` merged into one

4. **Identical behavior verified by tests**
   - Metric: Integration tests run same request through all adapters, assert identical output

5. **All adapter-specific behavior encapsulated**
   - Metric: All adapter differences handled in `src/platform/adapters/` only

### Test Coverage Requirements

```typescript
// Required test pattern for all major features
describe('Layout Discovery', () => {
  for (const adapterType of ['local', 'veryfront-api-branch', 'veryfront-api-release', 'github']) {
    it(`discovers nested layouts correctly with ${adapterType}`, async () => {
      const adapter = createAdapter(adapterType);
      const layouts = await collectLayouts(pageInfo, adapter);

      expect(layouts).toEqual([
        { path: 'app/layout.tsx', kind: 'tsx' },
        { path: 'app/dashboard/layout.tsx', kind: 'tsx' },
      ]);
    });
  }
});
```

## Recommended Solution

### Phase 1: Unify the Adapter Interface

Create a `UnifiedFSAdapter` interface that all adapters implement identically:

```typescript
// src/platform/adapters/fs/unified-interface.ts
interface UnifiedFSAdapter {
  // Core operations - all adapters MUST implement identically
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  readDir(path: string): AsyncIterable<DirEntry>;

  // Directory walking - API adapters must support this
  walkDirectory(rootDir: string, filter?: (entry: DirEntry) => boolean): AsyncIterable<string>;

  // Metadata - return undefined if not available (NOT different behavior)
  getProjectMetadata?(): ProjectMetadata | undefined;
}
```

### Phase 2: Fix Layout Discovery

Merge `collectAPILayoutConfiguration` and `collectFilesystemLayouts` into a single method:

```typescript
private async collectNestedLayouts(pageInfo: EntityInfo): Promise<LayoutItem[]> {
  const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);
  const rootDir = useAppRouter
    ? join(this.projectDir, "app")
    : join(this.projectDir, "pages");

  // Single code path for ALL adapters
  return await discoverNestedLayouts(pageFilePath, rootDir, this.projectDir, this.adapter);
}
```

Ensure `discoverNestedLayouts` uses only the unified adapter interface.

### Phase 3: Move Adapter Detection to Adapter Layer

All `isVeryfrontAdapter()` checks should be removed from business logic. If behavior must differ, it should be encapsulated in the adapter itself:

```typescript
// BEFORE (scattered conditionals)
if (isVeryfrontAdapter(fs)) {
  return loadConfigFromVirtualFS(path, adapter);
}
return loadConfigFromLocalFS(path);

// AFTER (adapter handles it)
return adapter.loadConfig(path);  // Adapter decides how internally
```

### Phase 4: Add Cross-Adapter Integration Tests

```typescript
// tests/integration/cross-adapter/layout-discovery.test.ts
import { createLocalAdapter, createAPIAdapter, createGitHubAdapter } from './fixtures';

const adapters = [
  ['local', createLocalAdapter],
  ['veryfront-api', createAPIAdapter],
  ['github', createGitHubAdapter],
] as const;

describe.each(adapters)('Layout Discovery (%s adapter)', (name, createAdapter) => {
  it('discovers nested layouts in app router', async () => {
    const adapter = await createAdapter({
      files: {
        'app/layout.tsx': 'export default function Root({children}) { return children }',
        'app/dashboard/layout.tsx': 'export default function Dashboard({children}) { return children }',
        'app/dashboard/page.tsx': 'export default function Page() { return <h1>Hello</h1> }',
      }
    });

    const collector = new LayoutCollector({ adapter, projectDir: '/test' });
    const layouts = await collector.collectLayouts(pageInfo);

    expect(layouts.nestedLayouts.map(l => l.path)).toEqual([
      '/test/app/layout.tsx',
      '/test/app/dashboard/layout.tsx',
    ]);
  });
});
```

## Files to Modify

| File | Change Required |
|------|-----------------|
| `src/rendering/layouts/layout-collector.ts` | Unify `collectAPILayoutConfiguration` and `collectFilesystemLayouts` |
| `src/rendering/layouts/utils/discovery.ts` | Ensure works with all adapter types |
| `src/config/loader.ts` | Move `isVirtualFilesystem` logic into adapter |
| `src/server/dev-server/middleware.ts` | Move `isVirtualFilesystem` logic into adapter |
| `src/types/entities/getEntityInfo.ts` | Make entity ID resolution adapter-agnostic |
| `src/rendering/orchestrator/pipeline.ts` | Make metadata access adapter-agnostic |
| `src/platform/adapters/fs/wrapper.ts` | Enhance to provide unified interface |
| `src/platform/adapters/fs/veryfront/adapter.ts` | Implement `walkDirectory` |
| `src/platform/adapters/fs/github/adapter.ts` | Implement `walkDirectory` |

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Interface Design | 2-3 days | Low |
| Phase 2: Layout Fix | 3-5 days | Medium |
| Phase 3: Conditional Removal | 5-7 days | Medium |
| Phase 4: Test Coverage | 3-4 days | Low |
| **Total** | **13-19 days** | **Medium** |

## References

- Main restructure plan: `/Users/mattboon/Sites/veryfront-renderer/plans/restructure/report.md`
- Layout collector: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/layout-collector.ts`
- VeryfrontFSAdapter: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/veryfront/adapter.ts`
- GitHubFSAdapter: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/github/adapter.ts`
- Wrapper interface: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/wrapper.ts`
