# Chapter 005: App Router vs Pages Router Divergence

## Overview

**Risk Level**: MEDIUM
**Files Affected**: ~10 core files
**Dependencies**: Benefits from Chapter 001 (Adapter Interface Unification)

The veryfront-renderer supports two routing paradigms borrowed from Next.js:
- **App Router**: Uses `app/` directory with `page.tsx` convention
- **Pages Router**: Uses `pages/` directory with filename-based routing

These two routers have evolved into parallel implementations with subtle differences, creating maintenance burden and occasional bugs where behavior diverges unexpectedly.

---

## 1. The Problem

### 1.1 Two Parallel Implementations

Every routing operation has two code paths based on router detection:

```
                    ┌─────────────────────────────────────────┐
                    │           INCOMING REQUEST              │
                    │              /blog/post                 │
                    └─────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌────────────────┐
                              │ detectAppRouter│
                              │   (cached)     │
                              └────────────────┘
                                       │
              ┌────────────────────────┴────────────────────────┐
              │                                                  │
              ▼                                                  ▼
    ┌──────────────────┐                              ┌──────────────────┐
    │   APP ROUTER     │                              │  PAGES ROUTER    │
    │                  │                              │                  │
    │ app/blog/post/   │                              │ pages/blog/      │
    │   page.tsx       │                              │   post.tsx       │
    │                  │                              │                  │
    │ Different:       │                              │ Different:       │
    │ - Discovery      │                              │ - Discovery      │
    │ - Path gen       │                              │ - Path gen       │
    │ - Layout walk    │                              │ - Layout walk    │
    │ - Reserved files │                              │ - _app.tsx       │
    └──────────────────┘                              └──────────────────┘
```

### 1.2 Why This Matters

1. **Duplicated Logic**: Route discovery, path generation, and layout collection are implemented twice
2. **Subtle Differences**: The two implementations handle edge cases differently
3. **SSG Bug**: The `getAllPages()` method only scans `pages/` directory, missing App Router pages
4. **Maintenance Burden**: Changes must be applied to both code paths

---

## 2. Discovery Functions

### 2.1 Router Detection

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/router-detection.ts`

```typescript
// Lines 48-71: Main detection function
export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  // Fast path: explicit config
  if (config?.router === "app") return true;
  if (config?.router === "pages") return false;

  // Cache check
  const cached = routerDetectionCache.get(projectDir);
  if (cached !== undefined) return cached;

  // Filesystem-based detection
  return await withSpan(
    SpanNames.ROUTER_DETECT_APP,
    async () => {
      const result = await detectAppRouterImpl(projectDir, config, adapter);
      routerDetectionCache.set(projectDir, result);
      return result;
    },
    { ... },
  );
}

// Lines 73-95: Implementation
async function detectAppRouterImpl(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const appDirName = config?.directories?.app ?? "app";
  const pagesDirName = config?.directories?.pages ?? "pages";

  const appDir = join(projectDir, appDirName);
  const pagesDir = join(projectDir, pagesDirName);

  const appStat = await statWithFallback(appDir, adapter);
  const pagesStat = await statWithFallback(pagesDir, adapter);

  const hasAppDir = Boolean(appStat?.isDirectory);
  const hasPagesDir = Boolean(pagesStat?.isDirectory);

  // Priority: app/ with route files > pages/ with route files > default
  if (hasAppDir && (await hasRouteFiles(appDir, adapter))) return true;
  if (hasPagesDir && (await hasRouteFiles(pagesDir, adapter))) return false;

  if (hasPagesDir && !hasAppDir) return false;
  return true;  // Default to app router
}
```

**Problem**: Detection runs per-request (cached for 60s). Projects with both directories can behave unpredictably.

### 2.2 Route Discovery for Dev Server

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/server/dev-server/route-discovery.ts`

```typescript
// Lines 44-78: Main discovery loop
async discoverRoutes(): Promise<void> {
  this.router.clear();
  this.router.clearCache();

  const routeDirs = await this.resolveRouteDirectories();

  for (const routeDir of routeDirs) {
    if (routeDir.type === "app") {
      await this.discoverAppRoutes(routeDir.path);  // App-specific
      continue;
    }
    await this.discoverPagesRoutes(routeDir.path, "");  // Pages-specific
  }
}

// Lines 159-195: Pages Router Discovery
private async discoverPagesRoutes(dir: string, prefix: string): Promise<void> {
  for await (const entry of this.adapter.fs.readDir(dir)) {
    if (shouldSkipEntry(entry.name, dir)) continue;

    const fullPath = join(dir, entry.name);
    // Pattern: /prefix/filename (without extension)
    const routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx)$/, "")}`;

    if (entry.isDirectory) {
      await this.discoverPagesRoutes(fullPath, routePath);
      continue;
    }

    let pattern = routePath.replace(/\/index$/, "") || "/";
    this.router.addRoute(pattern, relativePath);
  }
}

// Lines 197-227: App Router Discovery
private async discoverAppRoutesRecursive(dir: string, segments: string[]): Promise<void> {
  for await (const entry of this.adapter.fs.readDir(dir)) {
    if (shouldSkipEntry(entry.name, dir)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory) {
      // Skip route groups like (marketing) and parallel routes @modal
      const normalizedSegment = this.normalizeAppPathSegment(entry.name);
      const nextSegments = normalizedSegment ? [...segments, normalizedSegment] : segments;
      await this.discoverAppRoutesRecursive(fullPath, nextSegments);
      continue;
    }

    // Only page.* files create routes
    if (!/^page\.(tsx?|ts|jsx?|js|mdx)$/.test(entry.name)) continue;

    const pattern = this.buildAppRoutePattern(segments);
    this.router.addRoute(pattern, relativePath);
  }
}
```

**Key Differences**:
| Aspect | Pages Router | App Router |
|--------|-------------|------------|
| File naming | `about.tsx` -> `/about` | `about/page.tsx` -> `/about` |
| Index route | `index.tsx` -> `/` | `page.tsx` in root -> `/` |
| Route groups | Not supported | `(group)` directories ignored |
| Parallel routes | Not supported | `@slot` directories skipped |

---

## 3. Path Generation

### 3.1 Candidate Path Generator

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/routing/slug-mapper/path-candidate-generator.ts`

```typescript
// Lines 14-28: App Router candidates
export function generateAppRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
  const appBase = join(projectDir, "app");

  // Root route
  if (!normalizedSlug) return withExtensions(appBase, "page");

  const slugBase = join(appBase, normalizedSlug);

  return [
    ...withExtensions(slugBase, "page"),          // /app/about/page.tsx
    ...SUPPORTED_EXTENSIONS.map((ext) => `${slugBase}${ext}`),  // /app/about.tsx
  ];
}

// Lines 30-49: Pages Router candidates
export function generatePagesRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
  const pagesBase = join(projectDir, "pages");
  const isIndex = normalizedSlug === "" || normalizedSlug === "index";

  if (isIndex) {
    return [
      ...withExtensions(pagesBase, "index"),      // /pages/index.tsx
      ...withExtensions(projectDir, "index"),     // /index.tsx (legacy)
    ];
  }

  return [
    ...withJoinedExtensions(pagesBase, normalizedSlug),     // /pages/about.tsx
    ...withExtensions(join(pagesBase, normalizedSlug), "index"),  // /pages/about/index.tsx
    ...withJoinedExtensions(projectDir, normalizedSlug),    // /about.tsx (legacy)
  ];
}

// Lines 51-58: Returns both sets
export function getPathCandidates(projectDir: string, slug: string): PathCandidates {
  const normalizedSlug = slug ?? "";

  return {
    appRouter: generateAppRouterCandidates(projectDir, normalizedSlug),
    pagesRouter: generatePagesRouterCandidates(projectDir, normalizedSlug),
  };
}
```

**Key Differences**:
- App Router: Always looks for `page.*` in directories
- Pages Router: Looks for `filename.*` OR `filename/index.*`
- Pages Router: Also checks project root (legacy support)

---

## 4. Handler Differences

### 4.1 Page Resolver

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/page-resolution/page-resolver.ts`

```typescript
// Lines 39-87: resolvePage with router branching
resolvePage(slug: string): Promise<EntityInfo> {
  return withSpan(
    "routing.resolve_page",
    async () => {
      const useAppRouter = await detectAppRouter(
        this.projectDir,
        this.config,
        this.adapter,
      );

      let pageInfo: EntityInfo | null | undefined;

      if (useAppRouter) {
        // App Router: Use dedicated resolver
        pageInfo = await getAppRouteEntity(
          this.projectDir,
          slug,
          this.adapter,
          appDirName,
        );

        // Fallback to Pages Router if not found
        if (!pageInfo) {
          logger.debug("App Router resolution failed, falling back to Pages Router");
          pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
        }
      } else {
        // Pages Router: Use generic entity resolver
        pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
      }

      if (!pageInfo) {
        throw new VeryfrontError(`Page not found: ${slug}`, ErrorCode.FILE_NOT_FOUND);
      }

      return pageInfo;
    },
  );
}
```

### 4.2 Entity Resolvers

**App Router** (`/Users/mattboon/Sites/veryfront-renderer/src/rendering/app-route-resolver.ts`):

```typescript
// Lines 16-26: Main resolver
export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  // Try exact match first
  const exactMatch = await tryExactMatch(projectDir, slug, adapter, appDirName);
  if (exactMatch) return exactMatch;

  // Then try dynamic segments
  return tryDynamicMatch(projectDir, slug, adapter, appDirName);
}

// Lines 28-68: Exact match - checks page.* files
async function tryExactMatch(...): Promise<EntityInfo | null> {
  const base = slug ? join(projectDir, appDirName, slug) : join(projectDir, appDirName);

  const candidates = [
    `${base}/page.mdx`,
    `${base}/page.md`,
    `${base}/page.tsx`,
    `${base}/page.jsx`,
    `${base}/page.ts`,
    `${base}/page.js`,
    `${base}.mdx`,  // Also checks direct file (for backwards compat?)
    `${base}.md`,
    ...
  ];
  ...
}
```

**Pages Router** (`/Users/mattboon/Sites/veryfront-renderer/src/types/entities/getEntityInfo.ts`):

```typescript
// Lines 142-342: getEntityBySlug - complex branching based on adapter
export async function getEntityBySlug(
  projectDir: string,
  slug: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  // Branch 1: If adapter has resolveFile
  if (resolveFile) {
    const basePaths = [pathHelper.join(projectDir, "pages", slug)];
    // ... complex resolution logic
  }

  // Branch 2: Static path list
  const possiblePaths = [
    pathHelper.join(projectDir, "pages", `${slug}.mdx`),
    pathHelper.join(projectDir, "pages", `${slug}.md`),
    pathHelper.join(projectDir, "pages", `${slug}.tsx`),
    pathHelper.join(projectDir, "pages", `${slug}/index.mdx`),
    ...
  ];
  // ... iteration and dynamic segment fallback
}
```

---

## 5. Layout Handling Differences

### 5.1 Layout Collector

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/layout-collector.ts`

```typescript
// Lines 345-351: Root directory differs by router
private async collectFilesystemLayouts(
  pageFilePath: string,
  useAppRouter: boolean,
): Promise<LayoutItem[]> {
  // Different root directories
  const rootDir = useAppRouter
    ? join(this.projectDir, "app")
    : join(this.projectDir, "pages");

  return await discoverNestedLayouts(pageFilePath, rootDir, this.projectDir, this.adapter);
}
```

### 5.2 Layout Applicator

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/layout-applicator.ts`

```typescript
// Lines 73-106: Different wrapping behavior
async applyLayouts(...): Promise<BundledReact.ReactElement> {
  return await withSpan(
    SpanNames.LAYOUT_APPLY,
    async () => {
      let wrappedElement = await this.applyLayoutsOnly(...);

      const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);

      // Pages Router: Wrap with _app.tsx component
      if (!useAppRouter && !isDotPath) {
        wrappedElement = await this.wrapWithAppComponent(wrappedElement);
      }

      // App Router: Wrap with reserved components (loading.tsx, error.tsx)
      if (useAppRouter) {
        wrappedElement = await this.wrapWithReservedComponents(wrappedElement, pageFilePath);
      }

      // Both: Add PageContextProvider and RouterProvider
      ...
    },
  );
}
```

**Key Differences**:
| Feature | Pages Router | App Router |
|---------|-------------|------------|
| App wrapper | `_app.tsx` | None (use layout.tsx) |
| Error boundary | Manual | `error.tsx` reserved file |
| Loading state | Manual | `loading.tsx` reserved file |
| Layout location | `_app.tsx` or `components/Layout.tsx` | `layout.tsx` at any level |

---

## 6. Known Bugs

### 6.1 SSG getAllPages() Bug

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/page-resolution/page-resolver.ts`

```typescript
// Lines 89-113: ONLY scans pages/ directory
async getAllPages(): Promise<string[]> {
  const pages = new Set<string>();
  const pagesDirName = this.config.directories?.pages ?? "pages";

  // BUG: Only looks in pages/ directory
  const pagesDir = join(this.projectDir, pagesDirName);
  if (await this.adapter.fs.exists(pagesDir)) {
    for await (const entry of this.adapter.fs.readDir(pagesDir)) {
      if (entry.isFile && isPageFile(entry.name)) {
        pages.add(fileToSlug(entry.name));
      }
    }
  }

  // Also checks project root (legacy)
  for await (const entry of this.adapter.fs.readDir(this.projectDir)) {
    if (!entry.isFile || !isPageFile(entry.name) || entry.name.includes("config")) {
      continue;
    }
    pages.add(fileToSlug(entry.name));
  }

  // MISSING: App Router page discovery!
  // Should also scan app/ for page.tsx files

  return Array.from(pages);
}
```

**Impact**: SSG builds miss App Router pages. They're only built if explicitly included via `ssg.include` config.

### 6.2 Build Route Collector

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/server/build-routes.ts`

The build system correctly collects from both routers:

```typescript
// Lines 32-36: Correct - collects both
const [pages, app] = await Promise.all([
  collectPagesRoutes(adapter, projectDir, include, exclude),
  collectAppRoutes(adapter, projectDir, include, exclude),
]);
```

But the implementations differ in how they handle dynamic routes:

```typescript
// Lines 92-121: App Router - skips dynamic segments entirely
async function walkAppSSG(...): Promise<void> {
  const baseName = dir.split("/").pop() ?? "";
  if (isDynamicSegment(baseName)) return;  // Skip [id] directories
  ...
}

// Lines 34-60: Pages Router - includes dynamic routes
export async function collectPagesRoutes(...): Promise<RouteInfo[]> {
  // Includes [id].tsx files in the route list
  // (relies on getStaticPaths at runtime)
}
```

---

## 7. Duplication Analysis

### 7.1 Duplicated Code Patterns

| Pattern | Files | Estimated Lines |
|---------|-------|-----------------|
| Router detection calls | 6 | ~60 |
| Path candidate generation | 2 | ~80 |
| Entity resolution | 2 | ~200 |
| Route params extraction | 1 | ~150 |
| Layout root calculation | 2 | ~20 |
| Route discovery | 1 | ~100 |

**Total**: ~610 lines of partially duplicated logic

### 7.2 Shared Code

The following is properly shared:
- `isDynamicSegment()` utility
- `extractParamName()` utility
- `withExtensions()` helper
- Frontmatter extraction

---

## 8. Success Criteria

After refactoring, the codebase should have:

1. **Single Route Discovery Function**: One function that handles both `app/` and `pages/` directories
2. **Unified Entity Resolution**: One code path that resolves pages regardless of router type
3. **Router-Agnostic Layout Collection**: Layout discovery that works the same for both routers
4. **Fixed getAllPages()**: Method that correctly discovers all routes for SSG
5. **Single Params Extractor**: One function for route parameter extraction
6. **Consistent Dynamic Route Handling**: Same behavior for `[id]` in both routers

---

## 9. Recommended Solution

### 9.1 Unified Route Model

Create a router-agnostic route model:

```typescript
interface UnifiedRoute {
  // Normalized route pattern (e.g., "/blog/[id]")
  pattern: string;

  // Resolved file path (e.g., "/project/app/blog/[id]/page.tsx")
  filePath: string;

  // Detected source (for debugging)
  source: "app" | "pages";

  // Whether route has dynamic segments
  isDynamic: boolean;

  // Layout chain (already resolved)
  layouts: string[];
}
```

### 9.2 Unified Discovery

```typescript
async function discoverAllRoutes(
  projectDir: string,
  adapter: RuntimeAdapter,
  config: VeryfrontConfig,
): Promise<UnifiedRoute[]> {
  const routes: UnifiedRoute[] = [];

  // Check both directories
  const appDir = join(projectDir, config.directories?.app ?? "app");
  const pagesDir = join(projectDir, config.directories?.pages ?? "pages");

  // Discover from app/ if exists
  if (await directoryExists(appDir, adapter)) {
    routes.push(...await discoverAppRoutes(appDir, adapter));
  }

  // Discover from pages/ if exists
  if (await directoryExists(pagesDir, adapter)) {
    routes.push(...await discoverPagesRoutes(pagesDir, adapter));
  }

  // Deduplicate (app/ takes priority for same pattern)
  return deduplicateRoutes(routes);
}
```

### 9.3 Unified Resolution

```typescript
async function resolveRoute(
  slug: string,
  routes: UnifiedRoute[],
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  // Find matching route (handles dynamic segments)
  const match = findMatchingRoute(slug, routes);
  if (!match) return null;

  // Load entity (same for both router types)
  return await loadEntityFromFile(match.filePath, slug, adapter);
}
```

### 9.4 Migration Path

1. **Phase 1**: Create `UnifiedRoute` model and adapters
2. **Phase 2**: Add unified discovery alongside existing code
3. **Phase 3**: Route resolution through unified model
4. **Phase 4**: Fix `getAllPages()` to use unified discovery
5. **Phase 5**: Remove router-specific code paths
6. **Phase 6**: Remove `detectAppRouter()` from business logic

---

## 10. Files to Modify

| File | Changes |
|------|---------|
| `src/rendering/router-detection.ts` | Keep for backwards compat, mark deprecated |
| `src/rendering/page-resolution/page-resolver.ts` | Use unified discovery, fix getAllPages() |
| `src/rendering/app-route-resolver.ts` | Merge into unified resolver |
| `src/types/entities/getEntityInfo.ts` | Simplify, remove pages-specific logic |
| `src/routing/slug-mapper/path-candidate-generator.ts` | Consolidate into single generator |
| `src/rendering/route-params-extractor.ts` | Merge App/Pages extractors |
| `src/rendering/layouts/layout-collector.ts` | Remove router branching |
| `src/rendering/layouts/layout-applicator.ts` | Unify wrapping logic |
| `src/server/dev-server/route-discovery.ts` | Use unified discovery |
| `src/server/build-routes.ts` | Use unified discovery |

---

## 11. Testing Strategy

1. **Create router-agnostic test fixtures** with both `app/` and `pages/` directories
2. **Test route precedence** when same pattern exists in both routers
3. **Test mixed projects** with some routes in app/ and some in pages/
4. **Test SSG with App Router** to verify getAllPages() fix
5. **Test dynamic routes** work identically in both routers
6. **Test layout resolution** produces same results regardless of router

---

## 12. References

- Next.js App Router: https://nextjs.org/docs/app
- Next.js Pages Router: https://nextjs.org/docs/pages
- Router Detection Tests: `tests/integration/routing/router-detection.test.ts`
- Parent RFC: Chapter 001 (Adapter Interface Unification)
