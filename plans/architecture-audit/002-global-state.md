# Chapter 2: Global State and Multi-Tenant Isolation

## Executive Summary

The veryfront-renderer codebase contains **critical global state issues** that can cause data leakage between tenants in multi-project deployments. This document catalogs all identified global state patterns, their risks, and remediation strategies.

**Severity**: HIGH - Production data integrity at risk

**Key Finding**: While some subsystems (like `MultiProjectFSAdapter`) correctly use `AsyncLocalStorage` for request isolation, many other components rely on module-level mutable state that is shared across all requests and projects.

---

## Sub-Analyses

| Document | Issue | Severity | Status |
|----------|-------|----------|--------|
| [002.0-request-scoped-state-rfc.md](002.0-request-scoped-state-rfc.md) | RFC: AsyncLocalStorage Migration Plan | - | RFC |
| [002.1-head-collector-leakage.md](002.1-head-collector-leakage.md) | Head Collector SSR Metadata Leakage | CRITICAL | Analysis |
| [002.2-ssr-globals-context-leakage.md](002.2-ssr-globals-context-leakage.md) | SSR Globals Domain/State Leakage | CRITICAL | Analysis |
| [002.3-react-cache-version-mismatch.md](002.3-react-cache-version-mismatch.md) | React Module Cache Version Mismatch | CRITICAL | Analysis |
| [002.4-semaphore-starvation.md](002.4-semaphore-starvation.md) | Global Semaphores Resource Starvation | HIGH | Analysis |
| [002.5-ai-registry-leakage.md](002.5-ai-registry-leakage.md) | AI Registries Cross-Project Leakage | HIGH | Analysis |
| [002.6-in-progress-deadlock.md](002.6-in-progress-deadlock.md) | In-Progress Transforms Deadlock Risk | HIGH | Analysis |
| [002.7-failed-components-collision.md](002.7-failed-components-collision.md) | Failed Components Error State Collision | HIGH | Analysis |
| [002.8-tailwind-compiler-state.md](002.8-tailwind-compiler-state.md) | Tailwind Compiler Shared State | MEDIUM | Analysis |
| [002.9-tailwind-cache-environment-scope.md](002.9-tailwind-cache-environment-scope.md) | Tailwind CSS Cache Missing Environment | HIGH | Analysis |

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [High Priority Issues](#high-priority-issues)
3. [Medium Priority Issues](#medium-priority-issues)
4. [Already Properly Isolated](#already-properly-isolated)
5. [Remediation Strategy](#remediation-strategy)
6. [Success Criteria](#success-criteria)

---

## Critical Issues

### 0. BLAST RADIUS: One Broken Project Can Take Down Others

**This is the most critical multi-tenant risk.** Several global resources are shared across ALL projects without isolation, meaning one misbehaving project can cause failures for unrelated projects.

#### A. Transform Semaphore Exhaustion

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/cache/memory.ts`
**Line**: 43

```typescript
export const transformSemaphore = new Semaphore(MAX_CONCURRENT_TRANSFORMS);
```

**What happens**: The semaphore limits concurrent transforms across ALL projects. If Project A has a complex page requiring many transforms, it can exhaust the semaphore, blocking Project B, C, D from rendering.

**Failure scenario**:
```
Project A: 50 complex MDX pages → Acquires all semaphore slots
Project B: Simple page render → BLOCKED waiting for semaphore
Project C: Simple page render → BLOCKED waiting for semaphore
User experience: "Why is my site slow? I didn't change anything!"
```

**Fix**: Per-project semaphores or fair scheduling:
```typescript
const semaphoresByProject = new Map<string, Semaphore>();
function getProjectSemaphore(projectId: string): Semaphore {
  return semaphoresByProject.get(projectId)
    ?? semaphoresByProject.set(projectId, new Semaphore(MAX_PER_PROJECT)).get(projectId)!;
}
```

---

#### B. Failed Components Map - Error State Leakage

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/cache/memory.ts`
**Line**: 41

```typescript
export const failedComponents = new Map<string, { error: Error; timestamp: number }>();
```

**What happens**: When a component fails to load, it's marked as failed in this GLOBAL map. If keys don't include project ID, one project's failed component could prevent another project from loading a component with the same path.

**Failure scenario**:
```
Project A: components/Button.tsx fails to compile (syntax error)
  → failedComponents.set("components/Button.tsx", error)

Project B: Has its own valid components/Button.tsx
  → Checks failedComponents.get("components/Button.tsx")
  → Returns Project A's error! Button won't render.
```

**Fix**: Include project ID in failure tracking:
```typescript
const failedComponents = new Map<string, { error: Error; timestamp: number }>();
// Key format: `${projectId}:${componentPath}`
```

---

#### C. Cross-Project Cache - Intentional But Risky

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/cache/memory.ts`
**Line**: 31

```typescript
export const globalCrossProjectCache = new LRUCache<string, CachedModule>({
  maxEntries: 200,
  ttlMs: 5 * 60 * 1000,
});
```

**What it is**: Intentionally shared cache for modules that are identical across projects (React, lodash, etc.).

**Risk**: If a corrupted module enters this cache, ALL projects serve the corruption.

**Failure scenario**:
```
Network glitch: React module fetch returns partial/corrupted JavaScript
  → globalCrossProjectCache.set("react@19.1.1", corruptedModule)

ALL PROJECTS: Import React → Get corrupted module → SSR crashes
```

**Mitigation needed**: Content hash validation before caching:
```typescript
async function cacheIfValid(key: string, module: CachedModule): Promise<void> {
  const hash = await computeHash(module.code);
  if (hash !== module.expectedHash) {
    logger.error("Module corruption detected, not caching", { key, hash });
    return;
  }
  globalCrossProjectCache.set(key, module);
}
```

---

#### D. In-Progress Transform Tracking - Deadlock Risk

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/cache/memory.ts`
**Line**: 39

```typescript
export const globalInProgress = new Map<string, Promise<void>>();
```

**What happens**: Tracks in-flight transforms to deduplicate work. If a transform hangs indefinitely, other requests waiting for it also hang.

**Failure scenario**:
```
Project A: Transform of huge-file.tsx hangs (infinite loop in user code)
  → globalInProgress.set("huge-file.tsx", hangingPromise)

Project B: Also needs huge-file.tsx (same npm package)
  → await globalInProgress.get("huge-file.tsx") // Hangs forever!
```

**Fix**: Add timeout to in-progress waits:
```typescript
const inProgressPromise = globalInProgress.get(key);
if (inProgressPromise) {
  const result = await Promise.race([
    inProgressPromise,
    timeout(TRANSFORM_TIMEOUT_MS).then(() => { throw new TimeoutError(); })
  ]);
}
```

---

#### E. Circuit Breaker - One Project Trips All

**Risk**: If error handling uses a global circuit breaker pattern, one project experiencing API errors can trip the breaker for all projects.

**Example pattern to avoid**:
```typescript
// BAD: Global circuit breaker
const circuitBreaker = new CircuitBreaker({ failureThreshold: 5 });

async function fetchFromAPI(url: string) {
  return circuitBreaker.execute(() => fetch(url));
}
// Project A: 5 failures → Circuit opens
// Project B: Blocked by open circuit even though its API is healthy
```

**Fix**: Per-project circuit breakers or per-endpoint breakers.

---

### Summary: Blast Radius Issues

| Global Resource | Location | Failure Mode | Blast Radius |
|----------------|----------|--------------|--------------|
| `transformSemaphore` | memory.ts:43 | Exhaustion | All projects blocked |
| `failedComponents` | memory.ts:41 | Key collision | Wrong errors shown |
| `globalCrossProjectCache` | memory.ts:31 | Corruption | All projects crash |
| `globalInProgress` | memory.ts:39 | Hanging promise | Deadlock spreads |
| Circuit breakers | Various | Trips | Healthy projects blocked |

---

### 1. Head Collector - SSR Metadata Leakage

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/react/head-collector.ts`
**Lines**: 37

```typescript
let collected: CollectedHead = createEmpty();
```

**What it holds**: Title, description, meta tags, links, and styles collected during SSR rendering of a page.

**What can go wrong**:
- If two requests render concurrently, one project's `<Head>` metadata (title, description, OG tags) can leak into another project's HTML
- Race condition: Request A calls `resetHeadCollector()`, Request B starts rendering, Request A finishes and calls `flushHeadCollector()` - Request B's metadata is lost or incomplete

**Example scenario**:
```
Request A (project-alpha): Rendering page with title "Alpha Dashboard"
Request B (project-beta): Rendering page with title "Beta Analytics"

If interleaved:
1. A: resetHeadCollector()
2. B: resetHeadCollector()
3. A: collectHead({ title: "Alpha Dashboard" })
4. B: collectHead({ title: "Beta Analytics" })  // Overwrites A's title!
5. A: flushHeadCollector() -> Returns { title: "Beta Analytics" }  // WRONG!
```

**Fix**: Convert to `AsyncLocalStorage`-based pattern:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

const headStorage = new AsyncLocalStorage<CollectedHead>();

export function runWithHeadCollector<T>(fn: () => T): { result: T; head: CollectedHead } {
  const collected = createEmpty();
  const result = headStorage.run(collected, fn);
  return { result, head: collected };
}

export function collectHead(data: Partial<CollectedHead>): void {
  const collected = headStorage.getStore();
  if (!collected) return; // Not in SSR context
  // ... merge data into collected
}
```

---

### 2. React Module Cache - Version Mismatch

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/react/compat/ssr-adapter/server-loader.ts`
**Lines**: 11-12, 14-15

```typescript
let projectReactCache: typeof import("react") | null = null;
let reactDOMServerCache: ReactDOMServer | null = null;

const reactLoadFlight = new Singleflight<typeof import("react")>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();
```

**What it holds**: Cached React and ReactDOM/server module instances, plus singleflight deduplication for loading.

**What can go wrong**:
- If Project A uses React 18 and Project B uses React 19, the first project to render caches its React version
- All subsequent projects use the wrong React version, causing:
  - Runtime errors from API mismatches
  - Hydration mismatches on the client
  - Broken hooks or features (e.g., React 19's `use()` hook)

**Example scenario**:
```
Project A (React 18): Renders first, caches React 18
Project B (React 19): Uses cached React 18 instead of 19
  -> "use() is not a function" error
  -> Suspense boundaries behave differently
```

**Fix**: Project-scoped React caching:

```typescript
const reactCacheByProject = new Map<string, typeof import("react")>();

export async function getProjectReact(projectSlug: string): Promise<typeof import("react")> {
  let cached = reactCacheByProject.get(projectSlug);
  if (cached) return cached;

  const projectVersion = await getReactVersionInfoForProject(projectSlug);
  // Load React matching the project's version
  cached = await loadReactVersion(projectVersion);
  reactCacheByProject.set(projectSlug, cached);
  return cached;
}
```

---

### 3. React Version Detection Cache

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/react/compat/version-detector/version-cache.ts`
**Lines**: 4-5

```typescript
let defaultVersionInfo: ReactVersionInfo | null = null;
const projectVersionCache = new Map<string, ReactVersionInfo>();
```

**What it holds**: Detected React version info (isReact18, isReact19, features).

**What can go wrong**:
- `defaultVersionInfo` is set once and never changes - if the first request is a single-project deployment, this becomes the "default" for all projects
- The `getReactVersionInfo()` function (without project parameter) always returns this stale default

**Fix**: Remove `defaultVersionInfo` singleton, always require project context:

```typescript
// Remove defaultVersionInfo entirely
// const projectVersionCache = new Map<string, ReactVersionInfo>(); // Keep this

export async function getReactVersionInfo(projectSlug: string): Promise<ReactVersionInfo> {
  const cached = projectVersionCache.get(projectSlug);
  if (cached) return cached;

  const info = await detectReactVersionFromProject(projectSlug);
  projectVersionCache.set(projectSlug, info);
  return info;
}
```

---

### 4. SSR Globals Context - Port/Domain Leakage

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/ssr-globals/context.ts`
**Lines**: 6-9

```typescript
let ssrGlobalsInitialized = false;
let ssrServerPort: number | null = null;
let ssrProjectDomain: string | null = null;
let ssrClientOnlyFetching = false;
```

**What it holds**: Server port, project domain, and SSR state flags used during server-side rendering.

**What can go wrong**:
- `ssrProjectDomain` is global - if Project A sets it to "alpha.veryfront.com", Project B may generate URLs pointing to the wrong domain
- `ssrClientOnlyFetching` flag leaks between requests - one project enabling client-only mode affects others
- API calls during SSR may be routed to the wrong project's API endpoints

**Example scenario**:
```
Project A: setSSRProjectDomain("alpha.veryfront.com")
Project B: getSSRProjectDomain() -> Returns "alpha.veryfront.com" (WRONG!)
  -> fetch("/api/users") resolves to alpha.veryfront.com instead of beta.veryfront.com
```

**Fix**: Use `AsyncLocalStorage` for SSR context:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

interface SSRContext {
  port: number;
  domain: string;
  clientOnlyFetching: boolean;
}

const ssrContextStorage = new AsyncLocalStorage<SSRContext>();

export function runWithSSRContext<T>(
  context: SSRContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return ssrContextStorage.run(context, fn);
}

export function getSSRProjectDomain(): string | null {
  return ssrContextStorage.getStore()?.domain ?? null;
}
```

---

## High Priority Issues

### 5. Renderer Singleton

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/renderer.ts`
**Line**: 434

```typescript
let renderer: Renderer | null = null;
```

**What it holds**: The main Renderer instance containing:
- Element validator
- Compiler service
- MDX compile function
- Internal state

**Risk**: Medium-High. The Renderer class itself is designed to be stateless per-request, but sharing one instance means:
- Any accumulated state in the Renderer leaks between projects
- If `clearRendererCaches()` is called, ALL projects' caches are cleared

**Fix**: The Renderer is intentionally a singleton for performance. Ensure all internal state is either:
1. Content-addressed (same input = same output, safe to share)
2. Project-scoped via key prefixes

---

### 6. Shared Services

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/shared/shared-services.ts`
**Lines**: 32-33

```typescript
let sharedServices: SharedServices | null = null;
let initializationPromise: Promise<SharedServices> | null = null;
```

**What it holds**: `ElementValidator` and `CompilerService` instances.

**Risk**: Medium. The comment claims these are "stateless (pure functions) or use content-addressed caching". This is acceptable IF:
- ElementValidator maintains no per-project state
- CompilerService's MDX compilation is deterministic

**Verification needed**: Audit `CompilerService` for any project-specific state.

---

### 7. Tailwind Compiler State

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/html/styles-builder/tailwind-compiler.ts`
**Lines**: 30-72

```typescript
let tailwindBaseCSS: string | null = null;
let compiler: Awaited<ReturnType<typeof compile>> | null = null;
let lastStylesheetHash = "";

const pluginCache = new Map<string, unknown>();
const pluginErrors = new Map<string, string>();

let cssCache: CacheBackend | null = null;
let cssCacheInitPromise: Promise<CacheBackend> | null = null;
const localCssCache = new Map<string, string>();
const localCssInputsCache = new Map<string, CSSInputsCacheEntry>();

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;
const projectCSSLocalFallback = new Map<string, ProjectCSSLocalEntry>();
```

**What it holds**: Tailwind compiler instance, CSS caches, plugin caches.

**Risk**: Medium. Most caches use project-scoped keys (`${projectSlug}:${stylesheetHash}`), which is good. However:
- `compiler` and `lastStylesheetHash` are global - if projects have different Tailwind configs, the compiler may be wrong
- `pluginCache` and `pluginErrors` are global - plugin loading errors from one project affect others

**Partial Fix**: The project CSS cache is already project-scoped. The compiler singleton needs attention:

```typescript
// Compiler should be keyed by stylesheet hash
const compilersByStylesheet = new Map<string, Awaited<ReturnType<typeof compile>>>();

async function getCompiler(stylesheet: string): Promise<...> {
  const hash = hashString(stylesheet);
  let cached = compilersByStylesheet.get(hash);
  if (cached) return cached;
  // ... create and cache
}
```

---

### 8. Global Registries (Tools, Prompts, Workflows, Agents, Resources)

**Files**:
- `/Users/mattboon/Sites/veryfront-renderer/src/tool/registry.ts` (line 49)
- `/Users/mattboon/Sites/veryfront-renderer/src/prompt/registry.ts` (line 65-66)
- `/Users/mattboon/Sites/veryfront-renderer/src/workflow/registry.ts` (line 318-320)
- `/Users/mattboon/Sites/veryfront-renderer/src/agent/composition/composition.ts` (line 158-159)
- `/Users/mattboon/Sites/veryfront-renderer/src/resource/registry.ts` (line 63-64)

All use the same pattern:
```typescript
const REGISTRY_KEY = "__veryfront_X_registry__";
const globalWithRegistry = globalThis as GlobalWithRegistry;
export const registry = (globalWithRegistry[REGISTRY_KEY] ??= new RegistryClass());
```

**What they hold**: Registered tools, prompts, workflows, agents, and resources for AI functionality.

**What can go wrong**:
- Project A registers a tool "search-users" with its own implementation
- Project B's agent uses "search-users" expecting its own implementation but gets Project A's
- Sensitive data could be exposed through cross-project tool access
- Workflow definitions from one project could execute in another project's context

**Fix**: Project-scoped registries:

```typescript
class RegistryManager {
  private registriesByProject = new Map<string, RegistryClass>();

  getRegistry(projectSlug: string): RegistryClass {
    let registry = this.registriesByProject.get(projectSlug);
    if (!registry) {
      registry = new RegistryClass();
      this.registriesByProject.set(projectSlug, registry);
    }
    return registry;
  }
}

// Access via request context
export function getToolRegistry(): RegistryClass {
  const projectSlug = getCurrentProjectSlug(); // From AsyncLocalStorage
  return registryManager.getRegistry(projectSlug);
}
```

---

## Medium Priority Issues

### 9. Module Cache Singletons

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/cache/module-cache.ts`
**Lines**: 33, 41

```typescript
let moduleCache: LRUCache<string, string> | null = null;
let esmCache: LRUCache<string, string> | null = null;
```

**Risk**: Low-Medium. The comment says keys use format `{projectId}:{filePath}`, which provides isolation. However:
- `clearModuleCaches()` clears ALL projects' modules
- No per-project LRU eviction - one busy project could evict another's entries

**Acceptable IF**: Entry keys always include project identifier.

---

### 10. Transform Cache

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/transform-cache.ts`
**Lines**: 15-19

```typescript
let cacheBackend: CacheBackend | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;
const localFallback = new Map<string, TransformCacheEntry>();
```

**Risk**: Low. Uses `buildTransformCacheKey()` which includes file path and content hash. The same content always produces the same transform, so sharing is safe (content-addressed).

---

### 11. Domain Lookup Cache

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/server/utils/domain-lookup.ts`
**Lines**: 25-26

```typescript
const domainCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<DomainLookupResult | null>>();
```

**Risk**: Low. Domain->Project mapping is inherently global. Caching this is correct and necessary.

---

### 12. Page CSS Cache

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/pipeline.ts`
**Line**: 55

```typescript
const pageCssCache = new Map<string, string>();
```

**Risk**: Low-Medium. Key includes `projectId:environment:slug:contentVersion`, providing isolation. However, a global LRU limit could cause cross-project eviction.

---

### 13. Route Module Manifest

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/manifest/route-module-manifest.ts`
**Lines**: 51, 57

```typescript
const manifestStore = new Map<string, RouteManifest>();
const pendingCollections = new Map<string, Set<string>>();
```

**Risk**: Low. Key format is `${projectSlug}:${route}`, providing project isolation.

---

### 14. RSC Handler Registry

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/rsc/endpoints/handler-registry.ts`
**Lines**: 13-14

```typescript
let rscHandlersByProject: LRUCache<string, RSCDevServerHandler> | null = null;
let cacheRegistered = false;
```

**Risk**: Low. Keyed by `projectDir`, so handlers are project-specific. This is correct.

---

### 15. State Bridge Singleton

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/client/state-bridge.ts`
**Line**: 144

```typescript
let bridgeInstance: StateBridge | null = null;
```

**Risk**: Low. This is client-side state bridging, running in browser context where only one project exists per page.

---

### 16. Redis Client Singleton

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/utils/redis-client.ts`
**Lines**: 34-38

```typescript
let sharedClient: RedisClient | null = null;
let connectionPromise: Promise<RedisClient> | null = null;
let isConnecting = false;
let connectionFailed = false;
let lastConnectionAttempt = 0;
```

**Risk**: None. A shared Redis connection is correct - all projects should use the same Redis instance. Key isolation is handled at the key level, not the connection level.

---

### 17. Invalidation State

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/veryfront/invalidation-state.ts`
**Lines**: 28, 31, 34

```typescript
let lastCleanupTime = 0;
let totalBlockedReads = 0;
const pendingInvalidations = new Map<string, number>();
```

**Risk**: Low-Medium. The cache key prefixes include project context, so invalidations are project-scoped. The global counters (`totalBlockedReads`) are for metrics only.

---

### 18. Error Collector and Log Buffer (MCP Tools)

**Files**:
- `/Users/mattboon/Sites/veryfront-renderer/src/cli/mcp/error-collector.ts` (line 203)
- `/Users/mattboon/Sites/veryfront-renderer/src/cli/mcp/log-buffer.ts` (line 161)

```typescript
let globalCollector: ErrorCollector | null = null;
let globalBuffer: LogBuffer | null = null;
```

**Risk**: Low in production (MCP tools are dev-only). In multi-project dev scenarios, errors and logs from different projects would mix together, making debugging confusing.

---

## Already Properly Isolated

The following components correctly use `AsyncLocalStorage` for request/project isolation:

### 1. MultiProjectFSAdapter

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/veryfront/multi-project-adapter.ts`

```typescript
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// Proper isolation via runWithContext()
runWithContext(projectSlug, token, fn, projectId, options)
```

### 2. Request Cache Batcher

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/cache/request-cache-batcher.ts`

```typescript
const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();

// Per-request cache batching
runWithCacheBatching(fn)
```

### 3. Cache Key Builder

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/cache/cache-key-builder.ts`

```typescript
const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext>();
```

### 4. Cache Directory (Test Isolation)

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/utils/cache-dir.ts`

```typescript
const cacheStorage = new AsyncLocalStorage<string>();
```

---

## Remediation Strategy

### Phase 1: Critical Fixes (Immediate)

1. **Head Collector** - Convert to AsyncLocalStorage
2. **SSR Globals Context** - Convert to AsyncLocalStorage
3. **React Module Cache** - Add project-scoped caching

### Phase 2: High Priority (1-2 weeks)

4. **Global Registries** - Add project scoping to tool/prompt/workflow/agent/resource registries
5. **React Version Cache** - Remove default singleton, require project context
6. **Tailwind Compiler** - Scope compiler instances by stylesheet hash

### Phase 3: Validation (Ongoing)

7. Audit all `new Map()` usages for proper key scoping
8. Audit all `let` module-level variables for statefulness
9. Add integration tests for multi-tenant isolation

---

## Success Criteria

### Measurable Outcomes

1. **Zero Cross-Project Data Leakage**
   - [ ] No SSR metadata from Project A appears in Project B's HTML
   - [ ] No React version mismatches between projects
   - [ ] No tool/agent/prompt registration conflicts
   - Test: Run concurrent requests to different projects, verify complete isolation

2. **AsyncLocalStorage Coverage**
   - [ ] Head collector uses AsyncLocalStorage
   - [ ] SSR globals use AsyncLocalStorage
   - [ ] All registries are project-scoped
   - Metric: 100% of request-scoped state uses AsyncLocalStorage

3. **Cache Key Validation**
   - [ ] All shared cache keys include project identifier
   - [ ] Audit script passes for all cache key usages
   - Test: Grep for `new Map<string, ` and verify key format includes project

4. **Regression Tests**
   - [ ] Add test: `test-multi-tenant-ssr-isolation.ts`
   - [ ] Add test: `test-react-version-isolation.ts`
   - [ ] Add test: `test-registry-isolation.ts`
   - Metric: All isolation tests pass in CI

5. **No Global Mutable State (outside allowed list)**
   - [ ] `grep "^let " src/` returns only approved entries
   - [ ] Approved list: cache backends, singleflight instances, initialized flags
   - [ ] All other module-level `let` converted to AsyncLocalStorage or project-scoped

### Verification Checklist

- [ ] Deploy to staging with 2+ projects
- [ ] Run load test with concurrent requests to different projects
- [ ] Monitor for any cross-project errors or data leakage
- [ ] Run full test suite with `--parallel` to catch race conditions
- [ ] Memory profile to ensure no unbounded growth in project-scoped caches
