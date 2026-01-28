# Target State Diagrams

Visual overview of architectural changes for each subsystem.

---

## 1. Request Flow / Singleton / AsyncLocalStorage

### CURRENT STATE (Broken)
```
Request A ─┬─▶ GLOBAL headCollector ◀─┬─ Request B
           │   GLOBAL ssrContext    ◀─┤
           │   GLOBAL reactCache    ◀─┤
           │   GLOBAL semaphores    ◀─┘
           │
           ▼
     ┌─────────────────────────────────┐
     │  One broken project crashes ALL │
     │  Data leaks between projects    │
     └─────────────────────────────────┘
```

### TARGET STATE
```
┌───────────────────────────────────────────────────────────┐
│                   SINGLETON RENDERER                       │
│               (one process, all projects)                  │
├───────────────────────────────────────────────────────────┤
│                                                            │
│  Request A              Request B              Request C   │
│      │                      │                      │       │
│      ▼                      ▼                      ▼       │
│ ┌──────────┐          ┌──────────┐          ┌──────────┐  │
│ │AsyncLocal│          │AsyncLocal│          │AsyncLocal│  │
│ │ Storage  │          │ Storage  │          │ Storage  │  │
│ ├──────────┤          ├──────────┤          ├──────────┤  │
│ │projectId │          │projectId │          │projectId │  │
│ │head      │          │head      │          │head      │  │
│ │ssrCtx    │          │ssrCtx    │          │ssrCtx    │  │
│ │errors    │          │errors    │          │errors    │  │
│ └──────────┘          └──────────┘          └──────────┘  │
│      │                      │                      │       │
│      └──────────────────────┼──────────────────────┘       │
│                             │                              │
│                             ▼                              │
│                  SHARED (Content-Addressed)                │
│                  ────────────────────────                  │
│                  HTTP bundles (by hash)                    │
│                  React versions (by semver)                │
│                  Connection pools                          │
└───────────────────────────────────────────────────────────┘
```

**Key Invariant**: Request-scoped state in AsyncLocalStorage. Content-addressed caches shared safely.

---

## 2. Files Fetching (Adapter Interface)

### CURRENT STATE (Broken)
```
                    Business Logic
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
   isLocalFS()?    isVeryfrontAPI()?  isGitHub()?
          │               │               │
          ▼               ▼               ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ Walk dir │    │ List API │    │ GH API   │
   │ Native   │    │ No walk! │    │ No walk! │
   └──────────┘    └──────────┘    └──────────┘
                         │
                         ▼
            Nested layouts MISSING!
```

### TARGET STATE
```
┌─────────────────────────────────────────────────────────┐
│                     Business Logic                       │
│             (ONE code path, no conditionals)             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  discoverLayouts(adapter, page)                         │
│  evaluateModule(adapter, path)                          │
│  buildCacheKey(adapter, slug)                           │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  UnifiedFSAdapter      │
              │  ─────────────────     │
              │  readFile()            │
              │  exists()              │
              │  walkDirectory() ◀──── NEW! All adapters
              │  getMetadata?()        │
              └────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │ Local FS │     │ VF API   │     │ GitHub   │
   │ Adapter  │     │ Adapter  │     │ Adapter  │
   └──────────┘     └──────────┘     └──────────┘
```

**Key Invariant**: `grep -r "isVeryfrontAdapter" src/ | grep -v adapters/` = 0

---

## 3. Config Normalization

### CURRENT STATE (Broken)
```
User Config                       Runtime Code
───────────                       ────────────
router: "app"         ─┐
generate.preferredRouter: ─┼──▶   Scattered normalization
  "app-router"        ─┘          Different checks in each file
                                       │
cors: true            ─┐               │
cors: { origin: "*" } ─┼──▶   runtime/schema mismatch
cors: ["*.com"]       ─┘               │
                                       ▼
layout: "components/layout" ─┐   Some code handles one
layout: false              ─┼──▶ format, other code handles
layout: undefined          ─┘   different format
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │ Shared DEFAULT_CONFIG│
                            │ (mutation risk!)     │
                            └──────────────────────┘
```

### TARGET STATE
```
User Config          Validation        Normalization       Internal
(liberal)            (schema.ts)       (normalize.ts)      (strict)
───────────          ──────────        ─────────────       ────────

"app"                     │                 │
"app-router"    ─────────▶├─────────────────▶ router: "app" | "pages"
"pages-router"            │                 │

true                      │                 │
{ origin: "*" } ─────────▶├─────────────────▶ NormalizedCorsConfig
["*.com"]                 │                 │  (strict interface)

"path"                    │                 │
false           ─────────▶├─────────────────▶ { enabled, path }
undefined                 │                 │

                          ▼                 ▼
                    ┌─────────────────────────────────┐
                    │ Deep clone per request          │
                    │ No shared mutable state         │
                    │ Object.freeze() on all configs  │
                    └─────────────────────────────────┘
```

**Key Invariant**: Config normalized ONCE at boundary. Internal code uses strict types.

---

## 4. Layout Discovery

### CURRENT STATE (Broken)
```
Local FS                          API Adapter
────────                          ───────────
     │                                 │
     ▼                                 ▼
Walk from page ──▶ app/             Check config.layout
to root, collect:   dashboard/         │
                      layout.tsx ◀──┐  ▼
                    settings/       │ Check components/layout.*
                      layout.tsx ◀──┤      │
                    layout.tsx ◀────┘      ▼
     │                              NO DIRECTORY WALK!
     ▼                                     │
All layouts found                          ▼
     ✓                              Nested layouts MISSING!
                                           ✗
```

### TARGET STATE
```
┌─────────────────────────────────────────────────────────┐
│              discoverLayouts(adapter, page)              │
│                    SINGLE FUNCTION                       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
          for await (file of adapter.walkDirectory(
            rootDir,
            f => f.name === "layout.tsx"
          ))
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│   Works identically for Local FS, API, and GitHub       │
│                                                          │
│   app/                                                   │
│   ├── layout.tsx         ◀── Found                      │
│   ├── dashboard/                                         │
│   │   └── layout.tsx     ◀── Found                      │
│   └── settings/                                          │
│       └── layout.tsx     ◀── Found                      │
└─────────────────────────────────────────────────────────┘
```

**Key Invariant**: Same layouts discovered regardless of adapter type.

---

## 5. App vs Pages Router

### CURRENT STATE (Broken)
```
detectAppRouter()
       │
       ├──────▶ routerDetectionCache (GLOBAL!)
       │
       ▼
   useAppRouter?
       │
   ┌───┴────┐
   │        │
   ▼        ▼
App Path  Pages Path
   │        │
   ▼        ▼
┌─────┐  ┌─────┐
│Route│  │Route│   ◀── Different discovery
│Disc.│  │Disc.│       Different param extraction
└─────┘  └─────┘       Different SSG behavior
   │        │
   ▼        ▼
┌─────┐  ┌─────┐
│Param│  │Param│   ◀── extractAppRouteParams()
│Extr.│  │Extr.│       vs extractPagesRouteParams()
└─────┘  └─────┘
```

### TARGET STATE
```
┌────────────────────────────────────────────────────────┐
│                    RouteRegistry                        │
│                (project-scoped, not global)             │
├────────────────────────────────────────────────────────┤
│  routes: UnifiedRoute[]                                 │
│  projectDir: string                                     │
│  primaryRouter: "app" | "pages"  ◀── Informational only │
└────────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│                   UnifiedRoute                          │
├────────────────────────────────────────────────────────┤
│  pattern: "/blog/[id]"                                  │
│  filePath: "/project/app/blog/[id]/page.tsx"           │
│  source: "app" | "pages"  ◀── Metadata, NOT branching  │
│  isDynamic: true                                        │
│  paramNames: ["id"]                                     │
│  layouts: ["/app/layout.tsx", "/app/blog/layout.tsx"]  │
└────────────────────────────────────────────────────────┘
                         │
                         ▼
              SINGLE resolution function
              SINGLE param extraction
              SINGLE SSG discovery
```

**Key Invariant**: Route source is metadata, not branching condition.

---

## 6. Bundling / Dependency Tracking

### CURRENT STATE (Broken)
```
page.tsx imports helper.tsx
        │
        ▼
Build cache key:
  v1:page.tsx:{hash(page.tsx)}  ◀── Dependencies NOT included!
        │
        ▼
Cache hit? Return stale bundle
        │
        ▼
User changes helper.tsx
        │
        ▼
page.tsx hash unchanged → cache hit → OLD helper.tsx served!
```

### TARGET STATE
```
page.tsx imports helper.tsx
        │
        ▼
Build dependency graph:
  ┌───────────────────────┐
  │ page.tsx              │
  │ ├── helper.tsx        │
  │ ├── utils/format.ts   │
  │ └── @lib/component    │
  └───────────────────────┘
        │
        ▼
Compute hashes:
  contentHash = hash(page.tsx)
  depsHash = hash(helper.tsx + format.ts + component)
  configHash = hash(relevant config)
        │
        ▼
Cache key:
  v1:{projectId}:page.tsx:{contentHash}:{depsHash}:{configHash}
        │
        ▼
Any dep changes → new key → fresh bundle
```

**Key Invariant**: `cache.get(key)` returns identical result to fresh compute.

---

## 7. TailwindCSS Compiler

### CURRENT STATE (Broken)
```
┌─────────────────────────────────────────────────────────┐
│                    GLOBAL STATE                          │
├─────────────────────────────────────────────────────────┤
│  let compiler = null      ◀── One compiler, all projects │
│  let lastStylesheetHash   ◀── Hash collision risk        │
│  pluginCache: Map         ◀── Wrong versions possible    │
│  pluginErrors: Map        ◀── Phantom errors from proj A │
└─────────────────────────────────────────────────────────┘
                        │
    Project A stylesheet (v1 typography plugin)
    Project B stylesheet (v2 typography plugin)
                        │
                        ▼
              Compiler configured for A
              B gets wrong plugin version
```

### TARGET STATE
```
┌─────────────────────────────────────────────────────────┐
│              Compilers by Stylesheet CONTENT             │
│              (not hash - no collision risk)              │
├─────────────────────────────────────────────────────────┤
│  Map<stylesheetContent, Compiler>                        │
│                                                          │
│  Same stylesheet → shared compiler (safe)                │
│  Different stylesheet → different compiler               │
│                                                          │
│  Plugins keyed by: projectId + pluginName + version      │
│  Errors NOT cached globally                              │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
              Project isolation guaranteed
              Content-addressed sharing (safe)
```

**Key Invariant**: Projects with different stylesheets get different compilers.

---

## 8. Caching

### CURRENT STATE (Broken)
```
Cache Miss Path                Cache Hit Path
───────────────                ──────────────
      │                              │
      ▼                              ▼
Fetch content                  Get from cache
      │                              │
      ▼                              ▼
Validate paths exist           SKIP validation!
      │                              │
      ▼                              ▼
Check dependencies             SKIP dep check!
      │                              │
      ▼                              ▼
Verify env matches             SKIP env check!
      │                              │
      ▼                              ▼
Store in cache                 Return directly
      │                              │
      ▼                              ▼
Return result                  STALE/INVALID result!

Also:
- Cache keys missing projectId → cross-project pollution
- Absolute paths stored → fail on different pod
- TTLs inconsistent → stale cascades
```

### TARGET STATE
```
┌────────────────────────────────────────────────────────────┐
│                    ConsistentCache<T>                       │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  get(key, validators?)                                      │
│      │                                                      │
│      ├──▶ Check TTL                                         │
│      ├──▶ Check validators (file_exists, content_hash, etc)│
│      ├──▶ Convert portable paths to local                   │
│      └──▶ Return value OR null (triggers miss path)         │
│                                                             │
│  set(key, value, options)                                   │
│      │                                                      │
│      ├──▶ Convert absolute paths to portable                │
│      ├──▶ Store with validators                             │
│      └──▶ Store with TTL                                    │
│                                                             │
│  buildKey(params)                                           │
│      │                                                      │
│      └──▶ v{VERSION}:{projectId}:{type}:{id}:{hash}        │
│                           ↑                                 │
│                   Always included!                          │
└────────────────────────────────────────────────────────────┘

Cache Entry:
┌────────────────────────────┐
│ value: T                   │
│ storedAt: number           │
│ validators: [              │
│   { type: "file_exists",   │
│     target: "${LOCAL}/..." │
│     expected: true }       │
│ ]                          │
│ portable: true             │
│ pathMappings: {...}        │
└────────────────────────────┘
```

**Key Invariant**: `cache.get(key)` produces identical result to cache miss, or returns null.

---

## 9. Module Evaluation (Config/Middleware)

### CURRENT STATE (Broken)
```
Config/Middleware Loading
         │
         ├──────▶ isVirtualFilesystem()?
         │               │
         │        ┌──────┴──────┐
         │        │             │
         │        ▼             ▼
         │   esbuild         Native import
         │   transpile       dynamic import
         │        │             │
         │        ▼             ▼
         │   Different      Different
         │   error msgs     resolution
         │        │             │
         └────────┴─────────────┘
                  │
                  ▼
         "Works locally, breaks in prod"
```

### TARGET STATE
```
┌─────────────────────────────────────────────────────────┐
│              evaluateModule(adapter, path)               │
│                   SINGLE FUNCTION                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Read content via adapter.readFile()                  │
│  2. Create temp file via adapter.makeTempDir()           │
│  3. Transpile with esbuild (ALL adapters)                │
│  4. Dynamic import from temp                             │
│  5. Cleanup temp                                         │
│                                                          │
│  Same error handling                                     │
│  Same resolution                                         │
│  Same behavior                                           │
└─────────────────────────────────────────────────────────┘
```

**Key Invariant**: Module evaluation identical for all adapter types.

---

## Summary: The Five Must-Haves

```
┌────────────────────────────────────────────────────────────┐
│                    MUST HAVES                               │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. ZERO SIDE EFFECTS ON STARTUP                            │
│     └─ deno task start = clean slate                        │
│                                                             │
│  2. COMPLETE PROJECT ISOLATION                              │
│     └─ AsyncLocalStorage for request-scoped state           │
│     └─ One project cannot affect another                    │
│                                                             │
│  3. LOCAL MIRRORS REMOTE                                    │
│     └─ Same rendering in dev, preview, production           │
│     └─ If it works locally, it works deployed               │
│                                                             │
│  4. ADAPTER PARITY                                          │
│     └─ Local FS = API = GitHub behavior                     │
│     └─ Single code path, no conditionals                    │
│                                                             │
│  5. CACHE CONSISTENCY                                       │
│     └─ cache.get(key) = fresh compute OR null               │
│     └─ No stale data, no "clear cache to fix"               │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **AsyncLocalStorage Performance**: What's the overhead of ALS context propagation across async boundaries?

2. **Cache Invalidation Strategy**: Should we implement inverse dependency tracking for targeted invalidation, or rely on TTL + content-addressed keys?

3. **Tailwind Plugin Versions**: How do we handle projects with conflicting plugin version requirements?

4. **Router Migration Path**: Should projects be able to use both app/ and pages/ simultaneously during migration?

5. **Config Freeze Timing**: When exactly in the request lifecycle should config be frozen?
