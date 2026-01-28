# Cache Inventory

Complete inventory of all caches in the veryfront-renderer codebase.

---

## Cache Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CACHE ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    DISTRIBUTED (Redis/API)                          │    │
│  │                   Shared across all pods                            │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │ transform   │ │ ssr-module  │ │ http-module │ │ project-css │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │ file        │ │ module      │ │ render      │ │ snippet     │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐                                   │    │
│  │  │ css         │ │ css-inputs  │                                   │    │
│  │  └─────────────┘ └─────────────┘                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    IN-MEMORY LRU (Per Pod)                          │    │
│  │                  Lost on pod restart/scale                          │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │globalModule │ │ crossProj   │ │ tmpDirs     │ │ httpPaths   │   │    │
│  │  │  Cache      │ │ Cache       │ │             │ │             │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │mdxModule    │ │routerDetect │ │ routeCache  │ │ vendorCache │   │    │
│  │  │  Cache      │ │  Cache      │ │   (API)     │ │             │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │snippetCache │ │ dataFetch   │ │ podModule   │ │ esmCache    │   │    │
│  │  │  (local)    │ │  Cache      │ │  Cache      │ │             │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    SIMPLE MAPS (Per Pod, NO eviction)               │    │
│  │                  ⚠️  MEMORY LEAK RISK - grows unbounded            │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │failedComps  │ │inProgress   │ │ pageCss     │ │layoutDiscov │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │configCache  │ │versionCache │ │pluginCache  │ │ domainCache │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │importMap    │ │errorPagePath│ │apiHandler   │ │manifestCache│   │    │
│  │  │  Cache      │ │  Cache      │ │  Cache      │ │             │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cache Count Summary

| Category | Count | Eviction | Shared Across Pods |
|----------|-------|----------|-------------------|
| Distributed (Redis/API) | 10 | TTL | Yes |
| In-Memory LRU | 15 | LRU + TTL | No |
| Simple Maps | 20+ | None ⚠️ | No |
| **Total** | **45+** | | |

---

## Distributed Caches (Redis/API)

These are shared across all pods via Redis or the Veryfront API.

| Cache | Key Prefix | File | Purpose | Has projectId? |
|-------|------------|------|---------|----------------|
| transform | `vf:transform:` | cache/backend.ts:653 | ESM transform results | ❌ NO |
| file | `vf:cache:` | cache/backend.ts:656 | File content cache | ✓ Yes |
| module | `vf:module:` | cache/backend.ts:659 | Module cache | ❌ NO |
| render | `vf:render:` | cache/backend.ts:662 | Render cache | ✓ Yes |
| userKv | `vf:kv:` | cache/backend.ts:665 | User KV store | ✓ Yes |
| httpModule | `vf:http-module:` | cache/backend.ts:670 | HTTP module bundles | ❌ NO |
| ssrModule | `vf:ssr-module:` | cache/backend.ts:673 | SSR modules | ✓ Yes |
| projectCSS | `vf:project-css:` | cache/backend.ts:676 | Tailwind CSS | ✓ Yes |
| css | `vf:css:` | tailwind-compiler.ts:317 | CSS output | ? |
| css-inputs | `vf:css-inputs:` | tailwind-compiler.ts:395 | CSS inputs | ? |
| snippet | `vf:snippet:` | snippet-renderer.ts:63 | Code snippets | ? |

---

## In-Memory LRU Caches

These are per-pod and have eviction policies.

| Cache | Max Entries | File:Line | Purpose | Scope |
|-------|-------------|-----------|---------|-------|
| globalModuleCache | 500 | ssr-module-loader/cache/memory.ts:27 | SSR module temp paths | Global |
| globalCrossProjectCache | 500 | ssr-module-loader/cache/memory.ts:31 | Cross-project modules | Global |
| globalTmpDirs | 100 | ssr-module-loader/cache/memory.ts:37 | Temp directories | Global |
| verifiedHttpBundlePaths | 2000 | ssr-module-loader/loader.ts:80 | Verified HTTP bundles | Global |
| snippetCache | 500 | snippet-renderer.ts:44 | Rendered snippets | Global |
| mdxModuleCache | 200 | ssr/mdx-module-loader.ts:11 | MDX modules | Global |
| routerDetectionCache | 100 | router-detection.ts:24 | App/Pages router detection | Global |
| routeCache (API) | 256 | routing/api/handler.ts:30 | API route matches | Per-instance |
| routeCache (matcher) | 256 | routing/api/api-route-matcher.ts:22 | Route match results | Per-instance |
| moduleCache | 500 | cache/module-cache.ts:67 | Pod module cache | Global |
| esmCache | 500 | cache/module-cache.ts:90 | ESM cache | Global |
| cachedPaths | 500 | transforms/esm/http-cache.ts:86 | HTTP module paths | Global |
| lastDistributedRefresh | 500 | transforms/esm/http-cache.ts:90 | Refresh timestamps | Global |
| dataFetchingCache | 100 | data/data-fetching-cache.ts:16 | Data fetch results | Per-instance |
| vendorCache | 100 | build/vendor-cache.ts:31 | Vendor bundles | Per-instance |
| rscHandlersByProject | 50 | rsc/endpoints/handler-registry.ts:19 | RSC handlers | Global |
| mdxModuleCache (transform) | 100 | transforms/mdx/index.ts:23 | MDX transform cache | Per-instance |

---

## Simple Map Caches (⚠️ No Eviction - Memory Leak Risk)

These grow unbounded and are never cleaned up!

| Cache | File:Line | Purpose | Multi-Tenant Risk |
|-------|-----------|---------|-------------------|
| failedComponents | ssr-module-loader/cache/memory.ts:41 | Failed component tracking | ⚠️ HIGH - leaks between projects |
| globalInProgress | ssr-module-loader/cache/memory.ts:35 | In-progress transforms | ⚠️ HIGH - deadlock risk |
| pageCssCache | rendering/orchestrator/pipeline.ts:55 | Page CSS | ⚠️ MEDIUM |
| layoutDiscoveryCache | rendering/layouts/utils/discovery.ts:8 | Layout discovery | ⚠️ HIGH - no projectId |
| componentHydrationCache | rendering/component-handling.ts:27 | Hydration | ⚠️ MEDIUM |
| transformCache | modules/server/module-batch-handler.ts:59 | Batch transforms | ⚠️ MEDIUM |
| componentCache | lib/spa/component-loader.ts:4 | SPA components | ⚠️ LOW |
| importMapCache | modules/import-map/preloader.ts:17 | Import maps | ⚠️ LOW |
| projectVersionCache | react/compat/version-detector/version-cache.ts:5 | React versions | ⚠️ HIGH - shared |
| pluginCache | tailwind-compiler.ts:34 | Tailwind plugins | ⚠️ MEDIUM |
| pluginErrors | tailwind-compiler.ts:35 | Plugin errors | ⚠️ HIGH - leaks between projects |
| localCssCache | tailwind-compiler.ts:41 | Local CSS | ⚠️ MEDIUM |
| localCssInputsCache | tailwind-compiler.ts:56 | CSS inputs | ⚠️ MEDIUM |
| configCacheByProject | config/loader.ts:74 | Config cache | ✓ Has projectId |
| domainCache | server/utils/domain-lookup.ts:25 | Domain lookups | ⚠️ MEDIUM |
| modulePathCaches | mdx/esm-module-loader/cache/index.ts:58 | Module paths | ⚠️ MEDIUM |
| apiHandlerCache | request/api/pages-api-handler.ts:11 | API handlers | ⚠️ MEDIUM |
| manifestCache | request/static.ts:31 | Static manifests | ⚠️ LOW |
| transpileCache | cli/discovery/index.ts:29 | Transpile results | ⚠️ LOW |
| errorPagePathCache | request/ssr/error-page-fallback.ts:79 | Error pages | ⚠️ LOW |
| moduleCache (dashboard) | handlers/dev/dashboard/ui-handler.ts:6 | Dashboard modules | ⚠️ LOW |
| moduleCache (projects) | handlers/dev/projects/ui-handler.ts:6 | Project modules | ⚠️ LOW |

---

## Local Dev vs Production

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOCAL DEV MODE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐                                                     │
│  │  Single Process     │                                                     │
│  │  ───────────────    │                                                     │
│  │  All caches in      │                                                     │
│  │  memory (no Redis)  │                                                     │
│  │                     │                                                     │
│  │  CacheBackend type: │                                                     │
│  │  → "memory"         │                                                     │
│  └─────────────────────┘                                                     │
│            │                                                                  │
│            ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  All 45+ caches live in the same process                            │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  ✓ Fast (no network)                                                 │    │
│  │  ✓ Simple (single process)                                          │    │
│  │  ✗ No sharing between restarts                                      │    │
│  │  ✗ Memory grows with project count                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRODUCTION MODE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐                  │
│  │  Pod 1   │   │  Pod 2   │   │  Pod 3   │   │  Pod N   │                  │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘                  │
│       │              │              │              │                         │
│       │   In-Memory  │   In-Memory  │   In-Memory  │                         │
│       │   LRU Caches │   LRU Caches │   LRU Caches │                         │
│       │   (isolated) │   (isolated) │   (isolated) │                         │
│       │              │              │              │                         │
│       └──────────────┴──────────────┴──────────────┘                         │
│                             │                                                │
│                             ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    REDIS (Shared)                                    │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  vf:transform:*     → ESM transform results                         │    │
│  │  vf:ssr-module:*    → SSR module code                               │    │
│  │  vf:http-module:*   → HTTP bundle code                              │    │
│  │  vf:project-css:*   → Tailwind CSS output                           │    │
│  │  vf:render:*        → Rendered HTML                                 │    │
│  │  vf:file:*          → File content                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                             │                                                │
│                             ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    PROBLEMS                                          │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  1. Pod A caches transform with file:///tmp/pod-a/...               │    │
│  │     Pod B gets cache hit but path doesn't exist → 500 error         │    │
│  │                                                                      │    │
│  │  2. In-memory caches NOT synced between pods                        │    │
│  │     failedComponents on Pod A doesn't affect Pod B                  │    │
│  │     (Actually good for isolation, bad for consistency)              │    │
│  │                                                                      │    │
│  │  3. Simple Maps grow unbounded in long-running pods                 │    │
│  │     Memory leak over time                                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Through Caches

```
Request: GET https://projectA.veryfront.com/dashboard
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. DOMAIN LOOKUP                                                             │
│    domainCache.get("projectA.veryfront.com")                                │
│    → projectSlug: "project-a"                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. CONFIG LOADING                                                            │
│    configCacheByProject.get("project-a")                                    │
│    → VeryfrontConfig { router: "app", ... }                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. ROUTER DETECTION                                                          │
│    routerDetectionCache.get("/path/to/project")                             │
│    → useAppRouter: true                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. LAYOUT DISCOVERY                                                          │
│    layoutDiscoveryCache.get("/path/to/project")                             │
│    → [layout.tsx, dashboard/layout.tsx]                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. COMPONENT TRANSFORM (for each component)                                  │
│                                                                              │
│    5a. Check transform cache (distributed)                                  │
│        getCachedTransformAsync("v42:page.tsx:abc123:browser")               │
│                                                                              │
│    5b. Check SSR module cache (distributed)                                 │
│        getFromRedis("ssr:v42:projA:draft:19.1.0:page.tsx:abc123")           │
│                                                                              │
│    5c. Check in-memory module cache                                         │
│        globalModuleCache.get("ssr:v42:projA:...")                           │
│                                                                              │
│    5d. Transform and cache                                                  │
│        → Transform with esbuild                                             │
│        → Store in Redis (distributed)                                       │
│        → Store in globalModuleCache (in-memory)                             │
│        → Write to temp file                                                 │
│                                                                              │
│    5e. Check for HTTP imports (npm packages)                                │
│        cachedPaths.get("https://esm.sh/lodash@4.17.21")                     │
│        → httpModuleCache (distributed) for code                             │
│        → Download if not cached                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. TAILWIND CSS                                                              │
│    projectCSSBackend.get("project-a:stylesheet-hash")                       │
│    → Compiled Tailwind CSS                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. RENDER                                                                    │
│    renderCache.get("project-a:/dashboard:content-hash")                     │
│    → Rendered HTML (if cache hit)                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                          Response
```

---

## Multi-Tenancy Issues by Cache

| Cache | Issue | Risk Level |
|-------|-------|------------|
| failedComponents | No projectId in key, errors leak | 🔴 CRITICAL |
| globalInProgress | Deadlock affects all projects | 🔴 CRITICAL |
| transformSemaphore | Starvation affects all projects | 🔴 CRITICAL |
| projectVersionCache | Shared React version cache | 🟠 HIGH |
| pluginErrors | Tailwind plugin errors leak | 🟠 HIGH |
| layoutDiscoveryCache | No projectId in key | 🟠 HIGH |
| routerDetectionCache | Uses path, not projectId | 🟡 MEDIUM |
| pageCssCache | No eviction | 🟡 MEDIUM |
| localCssCache | No eviction | 🟡 MEDIUM |

---

## Recommendations

1. **Convert Simple Maps to LRU**: All `new Map()` caches should be `LRUCache` with max entries
2. **Add projectId to all keys**: Especially `failedComponents`, `layoutDiscoveryCache`, `routerDetectionCache`
3. **Per-project semaphores**: Replace global `transformSemaphore` with fair per-project scheduling
4. **Portable paths in Redis**: Convert `file:///tmp/pod-a/...` to `${LOCAL_BASE}/...` before storing
5. **Add timeouts to in-progress tracking**: Prevent deadlocks from hanging transforms
